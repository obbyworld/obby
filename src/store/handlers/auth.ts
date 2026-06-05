import { t } from "@lingui/core/macro";
import { v4 as uuidv4 } from "uuid";
import type { StoreApi } from "zustand";
import ircClient from "../../lib/ircClient";
import {
  type ScramState,
  sasl as saslChunk,
  scramFinal,
  scramStart,
  scramVerifyServerFinal,
} from "../../lib/sasl/scram";
import {
  b64StdDecode,
  bytesToB64Std,
  isWebAuthnAvailable,
  webauthnAssert,
} from "../../lib/sasl/webauthn";
import {
  buildIrcv3BearerPayload,
  buildOauthBearerPayload,
  chunkSaslPayload,
} from "../../lib/saslFrames";
import type { Message, ServerConfig, ServerOAuthConfig } from "../../types";
import { normalizeHost } from "../helpers";
import type { AppState } from "../index";
import * as storage from "../localStorage";

type SaslMech =
  | "PLAIN"
  | "SCRAM-SHA-256"
  | "DRAFT-WEBAUTHN-BIO"
  | "EXTERNAL"
  | "IRCV3BEARER"
  | "OAUTHBEARER";

interface SaslSession {
  mech: SaslMech;
  username: string;
  password?: string;
  scram?: ScramState;
  step: number;
  // IRCV3BEARER / OAUTHBEARER state: the bearer token + framing hints
  // we'll emit when the server says AUTHENTICATE +.
  oauthBearer?: string;
  oauthTokenKind?: "jwt" | "opaque";
  oauthProvider?: string;
  // OAUTHBEARER (RFC 7628) optional gs2-header host/port hints. Captured
  // from the active server config at SASL start.
  oauthHost?: string;
  oauthPort?: number;
  // Set once the server has prompted for 2FA step-up. Used by the
  // delayed SCRAM-completion ack so we don't send "AUTHENTICATE +"
  // (which UnrealIRCd's saslserv would read as an empty TOTP code).
  stepupStarted?: boolean;
  // Marker the delayed-ack timer reads to decide whether to fire.
  // Incremented every time the session enters a state that should
  // make the timer abort.
  pendingAckEpoch?: number;
}

// OAuth path is active when the server has oauth.enabled AND we hold any
// bearer token. We don't gate on local expiry: the server is the
// authority, surfaces a useful 904 if the token is bad.
function getActiveOauth(
  serv: ServerConfig | undefined,
): ServerOAuthConfig | undefined {
  if (!serv?.oauth?.enabled) return undefined;
  if (!serv.oauth.accessToken && !serv.oauth.idToken) return undefined;
  return serv.oauth;
}

function pickBearer(oauth: ServerOAuthConfig): string | undefined {
  if (oauth.tokenKind === "opaque") return oauth.accessToken;
  return oauth.idToken ?? oauth.accessToken;
}

const sessions = new Map<string, SaslSession>();

function chooseMechanism(
  available: string[],
  pref:
    | "auto"
    | "PLAIN"
    | "SCRAM-SHA-256"
    | "DRAFT-WEBAUTHN-BIO"
    | "EXTERNAL"
    | undefined,
): SaslMech {
  // EXTERNAL is a deliberate user choice (the cert is on this device,
  // typically) -- never picked under "auto".
  if (pref === "EXTERNAL" && available.includes("EXTERNAL")) return "EXTERNAL";
  if (pref === "DRAFT-WEBAUTHN-BIO" && available.includes("DRAFT-WEBAUTHN-BIO"))
    return "DRAFT-WEBAUTHN-BIO";
  if (pref === "PLAIN") return "PLAIN";
  if (pref === "SCRAM-SHA-256" && available.includes("SCRAM-SHA-256"))
    return "SCRAM-SHA-256";
  // auto: prefer SCRAM-SHA-256 over PLAIN.
  if (available.includes("SCRAM-SHA-256")) return "SCRAM-SHA-256";
  return "PLAIN";
}

function loadCreds(
  serverId: string,
): { user: string; pass: string; mech: SaslMech } | null {
  const servers = storage.servers.load();
  const serv = servers.find((s) => s.id === serverId);
  if (!serv?.saslEnabled) return null;
  const user = serv.saslAccountName?.length
    ? serv.saslAccountName
    : serv.nickname;
  const pass = serv.saslPassword ? atob(serv.saslPassword) : undefined;
  // EXTERNAL has no password -- the TLS cert is the proof.
  if (!user || (serv.saslMechanism !== "EXTERNAL" && !pass)) return null;
  const available = ircClient.getSaslMechanisms(serverId);
  const mech = chooseMechanism(available, serv.saslMechanism);
  return { user, pass: pass ?? "", mech };
}

function clearSession(serverId: string) {
  sessions.delete(serverId);
}

export function registerAuthHandlers(store: StoreApi<AppState>): void {
  ircClient.on("CAP_ACKNOWLEDGED", ({ serverId, key, capabilities }) => {
    if (capabilities?.startsWith("draft/metadata")) {
      const currentSubs =
        store.getState().metadataSubscriptions[serverId] || [];
      if (currentSubs.length === 0) {
        const defaultKeys = [
          "url",
          "website",
          "status",
          "location",
          "avatar",
          "color",
          "display-name",
          "bot",
          // draft/custom-emoji: channel-scoped pack URL.  Subscribing
          // here so we get notified when a channel ops sets a new pack.
          "draft/emoji",
        ];
        store.getState().metadataSub(serverId, defaultKeys);
      }
    }
    if (key !== "sasl") return;

    // Pick mechanism up-front so the AUTHENTICATE event handler knows what
    // to do when the server says "+".
    const servers = storage.servers.load();
    const serv = servers.find((s) => s.id === serverId);
    const oauth = getActiveOauth(serv);
    const bearer = oauth ? pickBearer(oauth) : undefined;
    const available = ircClient.getSaslMechanisms(serverId);

    // Pick the primary mech. Policy:
    //   1. If a SASL password is configured AND an OAuth bearer is held,
    //      use the password as primary (PLAIN/SCRAM) and let OAuth become
    //      the second factor for the 2FA-REQUIRED step-up.
    //   2. Else if only OAuth is configured, use IRCV3BEARER primary.
    //   3. Else fall through to the existing PLAIN/SCRAM/WebAuthn path.
    const hasPassword =
      !!serv?.saslEnabled &&
      Boolean(serv.saslAccountName?.length || serv.nickname) &&
      Boolean(serv.saslPassword);
    // Prefer IRCV3BEARER (richer: carries token_type + provider, used for
    // 2FA step-up) when the server advertises it. Fall back to OAUTHBEARER
    // (RFC 7628 standard, bearer-only) for networks that only ship the
    // SASL-WG mech.
    const oauthMech: SaslMech | undefined =
      oauth && bearer
        ? available.includes("IRCV3BEARER")
          ? "IRCV3BEARER"
          : available.includes("OAUTHBEARER")
            ? "OAUTHBEARER"
            : undefined
        : undefined;
    const hasOauth = !!oauthMech;

    if (oauth && oauthMech && !hasPassword) {
      ircClient.setSaslEnabled(serverId, true);
      sessions.set(serverId, {
        mech: oauthMech,
        username: serv?.nickname ?? "",
        step: 0,
        oauthBearer: bearer,
        oauthTokenKind: oauth.tokenKind === "opaque" ? "opaque" : "jwt",
        oauthProvider: oauth.serverProvider,
        oauthHost: serv?.host,
        oauthPort: serv?.port,
      });
      ircClient.sendRaw(serverId, `AUTHENTICATE ${oauthMech}`);
      return;
    }

    if (!serv?.saslEnabled) return;

    const mech = chooseMechanism(available, serv.saslMechanism);
    const username = serv.saslAccountName?.length
      ? serv.saslAccountName
      : serv.nickname;
    const password = serv.saslPassword ? atob(serv.saslPassword) : undefined;

    // Stash OAuth context on the session so the 2FA-REQUIRED handler
    // can autopilot the step-up without us having to re-read storage.
    sessions.set(serverId, {
      mech,
      username,
      password,
      step: 0,
      oauthBearer: oauth && hasOauth ? bearer : undefined,
      oauthTokenKind:
        oauth && hasOauth
          ? oauth.tokenKind === "opaque"
            ? "opaque"
            : "jwt"
          : undefined,
      oauthProvider: oauth && hasOauth ? oauth.serverProvider : undefined,
    });
    ircClient.sendRaw(serverId, `AUTHENTICATE ${mech}`);
  });

  ircClient.on("AUTHENTICATE", async ({ serverId, param }) => {
    if (ircClient.isCapNegotiationComplete(serverId)) return;

    // Synthetic step-up signal from the server (draft/account-2fa).
    if (param === "2FA-REQUIRED") {
      const session = sessions.get(serverId);
      if (session) session.stepupStarted = true;
      // If primary was IRCV3BEARER, the OAuth bearer is already spent
      // as the first factor -- replaying it for step-up is exactly
      // the "same proof twice" failure the server rejects. Pop the
      // TOTP/WebAuthn modal instead.
      const bearer = session?.oauthBearer;
      if (bearer && session.mech !== "IRCV3BEARER") {
        // Step-up via IRCV3BEARER (the actual SASL mech name -- step-up
        // and primary share the same mechanism, the server just routes
        // by whether a stepup is in flight).
        const isOpaque = session.oauthTokenKind === "opaque";
        const b64 = buildIrcv3BearerPayload({
          token: bearer,
          tokenType: isOpaque ? "opaque" : "jwt",
          authzid: isOpaque ? session.oauthProvider : undefined,
        });
        ircClient.sendRaw(serverId, "AUTHENTICATE IRCV3BEARER");
        for (const chunk of chunkSaslPayload(b64)) {
          ircClient.sendRaw(serverId, `AUTHENTICATE ${chunk}`);
        }
        return;
      }
      // Otherwise pop the existing modal so the user can type a TOTP
      // code or pick a different factor.
      const acct = session?.username ?? "";
      store.setState({ pendingTotpStepUp: { serverId, account: acct } });
      return;
    }

    const session = sessions.get(serverId);
    if (!session) {
      // Either no SASL is in flight or a fresh PLAIN exchange started before
      // our session was set up.  Fall back to the legacy PLAIN behaviour so
      // older test fixtures still work.
      if (param !== "+") return;
      const creds = loadCreds(serverId);
      if (!creds || creds.mech !== "PLAIN") return;
      ircClient.sendRaw(
        serverId,
        `AUTHENTICATE ${btoa(`${creds.user}\x00${creds.user}\x00${creds.pass}`)}`,
      );
      return;
    }

    try {
      if (session.mech === "EXTERNAL") {
        // SASL EXTERNAL: server sends `+` to acknowledge the mechanism,
        // we reply with `+` to mean "use the identity already
        // established by the TLS cert".  No further frames.
        if (param === "+") ircClient.sendRaw(serverId, "AUTHENTICATE +");
        return;
      }

      if (session.mech === "IRCV3BEARER") {
        if (param !== "+") return;
        if (!session.oauthBearer) return;
        const isOpaque = session.oauthTokenKind === "opaque";
        const b64 = buildIrcv3BearerPayload({
          token: session.oauthBearer,
          tokenType: isOpaque ? "opaque" : "jwt",
          authzid: isOpaque ? session.oauthProvider : undefined,
        });
        for (const chunk of chunkSaslPayload(b64)) {
          ircClient.sendRaw(serverId, `AUTHENTICATE ${chunk}`);
        }
        return;
      }

      if (session.mech === "OAUTHBEARER") {
        if (param !== "+") return;
        if (!session.oauthBearer) return;
        // RFC 7628: send the GS2-framed bearer + optional host/port,
        // chunked into 400-byte AUTHENTICATE blocks like every other
        // multi-line SASL mech.
        const b64 = buildOauthBearerPayload({
          token: session.oauthBearer,
          authzid: session.username || undefined,
          host: session.oauthHost,
          port: session.oauthPort,
        });
        for (const chunk of chunkSaslPayload(b64)) {
          ircClient.sendRaw(serverId, `AUTHENTICATE ${chunk}`);
        }
        return;
      }

      if (session.mech === "PLAIN") {
        if (param !== "+") return;
        if (!session.password) return;
        ircClient.sendRaw(
          serverId,
          `AUTHENTICATE ${btoa(`${session.username}\x00${session.username}\x00${session.password}`)}`,
        );
        return;
      }

      if (session.mech === "SCRAM-SHA-256") {
        if (session.step === 0 && param === "+") {
          if (!session.password) return;
          const { state, message } = scramStart(
            session.username,
            session.password,
          );
          session.scram = state;
          session.step = 1;
          ircClient.sendRaw(
            serverId,
            `AUTHENTICATE ${saslChunk.encodeUtf8(message)}`,
          );
          return;
        }
        if (session.step === 1 && session.scram) {
          const serverFirst = saslChunk.decodeUtf8(param);
          const clientFinal = await scramFinal(session.scram, serverFirst);
          session.step = 2;
          ircClient.sendRaw(
            serverId,
            `AUTHENTICATE ${saslChunk.encodeUtf8(clientFinal)}`,
          );
          return;
        }
        if (session.step === 2 && session.scram) {
          const serverFinal = saslChunk.decodeUtf8(param);
          const ok = scramVerifyServerFinal(session.scram, serverFinal);
          if (!ok) {
            ircClient.sendRaw(serverId, "AUTHENTICATE *");
            session.step = 3;
            return;
          }
          session.step = 3;
          // Per IRCv3 SASL-3.1, after the server's last data message
          // the client should send "AUTHENTICATE +" to indicate it has
          // no more data. Ergo follows this strictly and waits for the
          // ack before emitting 903. UnrealIRCd's saslserv, on the
          // other hand, immediately follows server-final with either
          // 903 OR "AUTHENTICATE 2FA-REQUIRED"; if the latter, sending
          // "+" would be read as an empty TOTP code and trip 904.
          //
          // So schedule the ack for ~750 ms later and skip if either
          // happens before the timer fires:
          //   - CAP negotiation completed (903 arrived and CAP END was sent)
          //   - The 2FA step-up handler marked stepupStarted on the session
          // Epoch handshake guards against a fresh session reusing the
          // serverId before the timer fires.
          const epoch = (session.pendingAckEpoch ?? 0) + 1;
          session.pendingAckEpoch = epoch;
          setTimeout(() => {
            const cur = sessions.get(serverId);
            if (!cur || cur.pendingAckEpoch !== epoch) return;
            if (cur.stepupStarted) return;
            if (ircClient.isCapNegotiationComplete(serverId)) return;
            ircClient.sendRaw(serverId, "AUTHENTICATE +");
          }, 750);
          return;
        }
        return;
      }

      if (session.mech === "DRAFT-WEBAUTHN-BIO") {
        if (session.step === 0 && param === "+") {
          // Send hello identifying the account; the server will reply with
          // a challenge JSON in the next AUTHENTICATE message.
          const hello = JSON.stringify({ username: session.username });
          session.step = 1;
          ircClient.sendRaw(serverId, `AUTHENTICATE ${btoa(hello)}`);
          return;
        }
        if (session.step === 1) {
          if (!isWebAuthnAvailable()) {
            ircClient.sendRaw(serverId, "AUTHENTICATE *");
            return;
          }
          const challengeJson = JSON.parse(
            new TextDecoder().decode(b64StdDecode(param)),
          );
          const assertion = await webauthnAssert(challengeJson);
          const reply = JSON.stringify(assertion);
          session.step = 2;
          ircClient.sendRaw(
            serverId,
            `AUTHENTICATE ${bytesToB64Std(new TextEncoder().encode(reply))}`,
          );
          return;
        }
        return;
      }
    } catch (err) {
      console.error("[SASL] error:", err);
      ircClient.sendRaw(serverId, "AUTHENTICATE *");
      clearSession(serverId);
    }
  });

  // 2FA replies: server uses NOTE 2FA <code> <args...> :<desc>.
  // `args` here is everything after the code; the trailing description is
  // the LAST entry (parsed by the IRC layer as a single trailing param).
  ircClient.on("TWOFA_NOTE", ({ serverId, code, args }) => {
    // args[0..len-2] are positional, args[len-1] is the description.
    const positional = args.slice(0, Math.max(0, args.length - 1));
    if (code === "ENABLED") {
      store.setState((s) => ({
        twofaStatus: { ...s.twofaStatus, [serverId]: "enabled" },
      }));
    } else if (code === "DISABLED") {
      store.setState((s) => ({
        twofaStatus: { ...s.twofaStatus, [serverId]: "disabled" },
      }));
    } else if (code === "REGISTRATION_CHALLENGE") {
      const type = positional[0] ?? "";
      const blob = positional[1] ?? "";
      store.setState({
        pendingTwofaChallenge: { serverId, type, blob },
      });
    } else if (code === "CREDENTIAL") {
      const id = positional[0] ?? "";
      const credType = positional[1] ?? "";
      const name = positional[2] ?? "";
      const ts = positional[3] ?? "";
      store.setState((s) => ({
        twofaCredentials: {
          ...s.twofaCredentials,
          [serverId]: [
            ...(s.twofaCredentials[serverId] ?? []),
            { id, type: credType, name, createdAt: ts },
          ],
        },
      }));
    } else if (code === "NO_CREDENTIALS") {
      store.setState((s) => ({
        twofaCredentials: { ...s.twofaCredentials, [serverId]: [] },
      }));
    }
  });

  // `2FA <subcommand> SUCCESS ...` lands in the dedicated TWOFA event.
  ircClient.on("TWOFA", ({ serverId, subcommand, status, args }) => {
    if (status !== "SUCCESS") return;
    if (subcommand === "ADD") {
      // Args: <type> <id> :<description>
      // We don't know the name from the success line alone; the LIST query
      // below refreshes the table.
      store.getState().twofaListQuery(serverId);
      store.setState({ pendingTwofaChallenge: null });
    } else if (subcommand === "REMOVE") {
      const id = args[0] ?? "";
      store.setState((s) => ({
        twofaCredentials: {
          ...s.twofaCredentials,
          [serverId]: (s.twofaCredentials[serverId] ?? []).filter(
            (c) => c.id !== id,
          ),
        },
      }));
    } else if (subcommand === "ENABLE") {
      store.setState((s) => ({
        twofaStatus: { ...s.twofaStatus, [serverId]: "enabled" },
      }));
    } else if (subcommand === "DISABLE") {
      store.setState((s) => ({
        twofaStatus: { ...s.twofaStatus, [serverId]: "disabled" },
      }));
    }
  });

  // Handle CAP LS to get informational capabilities like unrealircd.org/link-security
  ircClient.on("CAP LS", ({ serverId, cliCaps }) => {
    // Capture per-cap value strings. CAP ACK only echoes the names so
    // anything that wants to know "is webauthn one of the 2FA factors
    // this server supports" needs to consult what was advertised in
    // CAP LS. Drop the special unrealircd.org/link-security entry --
    // it has its own typed field below.
    const advertised: Record<string, string> = {};
    for (const tok of cliCaps.split(/\s+/)) {
      if (!tok) continue;
      const eq = tok.indexOf("=");
      if (eq <= 0) continue;
      const name = tok.slice(0, eq);
      const value = tok.slice(eq + 1);
      if (name === "unrealircd.org/link-security") continue;
      advertised[name] = value;
    }
    if (Object.keys(advertised).length) {
      store.setState((state) => ({
        servers: state.servers.map((server) =>
          server.id === serverId
            ? {
                ...server,
                capabilityValues: {
                  ...(server.capabilityValues ?? {}),
                  ...advertised,
                },
              }
            : server,
        ),
      }));
    }

    if (cliCaps.includes("unrealircd.org/link-security=")) {
      const match = cliCaps.match(/unrealircd\.org\/link-security=(\d+)/);
      if (match) {
        const linkSecurityValue = Number.parseInt(match[1], 10) || 0;
        store.setState((state) => {
          const updatedServers = state.servers.map((server) =>
            server.id === serverId
              ? { ...server, linkSecurity: linkSecurityValue }
              : server,
          );
          return { servers: updatedServers };
        });

        const currentState = store.getState();
        const currentServer = currentState.servers.find(
          (s) => s.id === serverId,
        );
        const hasLowLinkSecurity = linkSecurityValue < 2;
        const savedServers = storage.servers.load();
        const serverConfig = currentServer
          ? savedServers.find(
              (s) =>
                normalizeHost(s.host) === normalizeHost(currentServer.host) &&
                s.port === currentServer.port,
            )
          : undefined;
        const shouldWarnLinkSecurity =
          hasLowLinkSecurity && !serverConfig?.skipLinkSecurityWarning;

        if (shouldWarnLinkSecurity) {
          store.setState((state) => {
            const existingWarning = state.ui.linkSecurityWarnings.find(
              (w) => w.serverId === serverId,
            );
            if (existingWarning) return state;
            return {
              ui: {
                ...state.ui,
                linkSecurityWarnings: [
                  ...state.ui.linkSecurityWarnings,
                  { serverId, timestamp: Date.now() },
                ],
              },
            };
          });
        }
      }
    }
  });

  ircClient.on("CAP ACK", ({ serverId, cliCaps }) => {
    const caps = cliCaps.split(" ");

    for (const cap of caps) {
      const tok = cap.split("=");
      const capName = tok[0];
      const capValue = tok[1];
      ircClient.capAck(serverId, capName, capValue ?? null);
    }

    store.setState((state) => {
      const updatedServers = state.servers.map((server) => {
        if (server.id === serverId) {
          const existing = server.capabilities ?? [];
          const newCaps = cliCaps.split(" ");
          const merged = [...existing];
          for (const cap of newCaps) {
            if (!merged.includes(cap)) merged.push(cap);
          }
          return { ...server, capabilities: merged };
        }
        return server;
      });
      return { servers: updatedServers };
    });

    const state = store.getState();
    const server = state.servers.find((s) => s.id === serverId);
    let preventCapEnd = false;

    if (caps.some((cap) => cap.startsWith("sasl"))) {
      const servers = storage.servers.load();
      const savedServer = servers.find((s) => s.id === serverId);
      const hasPlain =
        savedServer?.saslEnabled && Boolean(savedServer?.saslPassword);
      const hasOauth =
        savedServer?.oauth?.enabled &&
        Boolean(savedServer?.oauth?.accessToken || savedServer?.oauth?.idToken);
      if (hasPlain || hasOauth) {
        preventCapEnd = true;
      }
    }

    const pendingReg = state.pendingRegistration;
    if (pendingReg && pendingReg.serverId === serverId) {
      preventCapEnd = true;
      if (server?.capabilities?.includes("draft/account-registration")) {
        store
          .getState()
          .registerAccount(
            serverId,
            pendingReg.account,
            pendingReg.email,
            pendingReg.password,
          );
        store.setState({ pendingRegistration: null });
      } else {
        store.setState({ pendingRegistration: null });
        preventCapEnd = false;
      }
    }

    if (state.ui.linkSecurityWarnings.some((w) => w.serverId === serverId)) {
      preventCapEnd = true;
    }

    if (!preventCapEnd) {
      ircClient.sendCapEnd(serverId);
      ircClient.userOnConnect(serverId);
    }
  });

  // Account registration event handlers
  ircClient.on("REGISTER_SUCCESS", ({ serverId, account, message }) => {
    const state = store.getState();
    const server = state.servers.find((s) => s.id === serverId);
    if (!server) return;
    const channel = server.channels[0];
    if (!channel) return;
    const notificationMessage: Message = {
      id: uuidv4(),
      type: "system",
      content: t`Account registration successful for ${account}: ${message}`,
      timestamp: new Date(),
      userId: "system",
      channelId: channel.id,
      serverId: serverId,
      reactions: [],
      replyMessage: null,
      mentioned: [],
    };
    const key = `${serverId}-${channel.id}`;
    store.setState((s) => ({
      messages: {
        ...s.messages,
        [key]: [...(s.messages[key] || []), notificationMessage],
      },
    }));
  });

  ircClient.on(
    "REGISTER_VERIFICATION_REQUIRED",
    ({ serverId, account, message }) => {
      const state = store.getState();
      const server = state.servers.find((s) => s.id === serverId);
      if (!server) return;
      const channel = server.channels[0];
      if (!channel) return;
      const notificationMessage: Message = {
        id: uuidv4(),
        type: "system",
        content: t`Account registration for ${account} requires verification: ${message}`,
        timestamp: new Date(),
        userId: "system",
        channelId: channel.id,
        serverId: serverId,
        reactions: [],
        replyMessage: null,
        mentioned: [],
      };
      const key = `${serverId}-${channel.id}`;
      store.setState((s) => ({
        messages: {
          ...s.messages,
          [key]: [...(s.messages[key] || []), notificationMessage],
        },
      }));
    },
  );

  ircClient.on("VERIFY_SUCCESS", ({ serverId, account, message }) => {
    const state = store.getState();
    const server = state.servers.find((s) => s.id === serverId);
    if (!server) return;
    const channel = server.channels[0];
    if (!channel) return;
    const notificationMessage: Message = {
      id: uuidv4(),
      type: "system",
      content: t`Account verification successful for ${account}: ${message}`,
      timestamp: new Date(),
      userId: "system",
      channelId: channel.id,
      serverId: serverId,
      reactions: [],
      replyMessage: null,
      mentioned: [],
    };
    const key = `${serverId}-${channel.id}`;
    store.setState((s) => ({
      messages: {
        ...s.messages,
        [key]: [...(s.messages[key] || []), notificationMessage],
      },
    }));
  });

  // draft/authtoken: cache the bearer token + bound URL on the server
  // record.  Components wait on `authToken` to flip from undefined to a
  // string after they call requestToken().
  ircClient.on("TOKEN_GENERATE", ({ serverId, service, url, token }) => {
    store.setState((state) => ({
      servers: state.servers.map((server) =>
        server.id === serverId
          ? {
              ...server,
              authToken: token,
              authTokenUrl: url,
              authTokenService: service,
            }
          : server,
      ),
    }));
  });

  ircClient.on(
    "EXTJWT",
    ({ serverId, requestedTarget, serviceName, jwtToken }) => {
      console.log("🔑 EXTJWT received:", {
        serverId,
        requestedTarget,
        serviceName,
        jwtToken: jwtToken ? "present" : "missing",
      });
      store.setState((state) => {
        const updatedServers = state.servers.map((server) =>
          server.id === serverId ? { ...server, jwtToken } : server,
        );
        return { servers: updatedServers };
      });
    },
  );

  // draft/persistence: cache the server's reported preference + effective
  // setting so the UI can render a tri-state toggle without re-querying
  // the server every time the panel opens.
  ircClient.on("PERSISTENCE_STATUS", ({ serverId, preference, effective }) => {
    store.setState((state) => ({
      servers: state.servers.map((server) =>
        server.id === serverId
          ? {
              ...server,
              persistencePreference: preference,
              persistenceEffective: effective,
            }
          : server,
      ),
    }));
  });

  // After CAP ACK we know whether the server supports draft/persistence.
  // Issue an initial PERSISTENCE GET so the settings panel has fresh
  // state by the time the user opens it.  We only do this once per
  // (serverId, account) login -- the spec gates the command on
  // IsLoggedIn, so we wait for the SASL success path to mark the
  // session complete.
  ircClient.on("CAP_ACKNOWLEDGED", ({ serverId, key }) => {
    if (key !== "draft/persistence") return;
    // Defer the GET until a tick later so SASL has had a chance to
    // complete; the server returns ACCOUNT_REQUIRED otherwise and
    // we'd just have to retry.
    setTimeout(() => {
      const state = store.getState();
      const server = state.servers.find((s) => s.id === serverId);
      if (!server?.isConnected) return;
      ircClient.persistenceGet(serverId);
    }, 1500);
  });
  // obsidianirc/cmdslist: maintain a lowercase set of invocable
  // commands per server.  Additions and removals can arrive in the
  // same wire line, so apply both atomically.
  ircClient.on("CMDSLIST", ({ serverId, additions, removals }) => {
    store.setState((state) => ({
      servers: state.servers.map((server) => {
        if (server.id !== serverId) return server;
        const next = new Set(server.cmdsAvailable ?? []);
        for (const cmd of additions) next.add(cmd.toLowerCase());
        for (const cmd of removals) next.delete(cmd.toLowerCase());
        return { ...server, cmdsAvailable: Array.from(next).sort() };
      }),
    }));
  });
}
