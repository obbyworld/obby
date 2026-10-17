import QRCode from "qrcode";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import {
  beginOauthLogin,
  getBuiltinOAuthConfig,
  OAUTH_PRESETS,
} from "../../lib/oauth";
import {
  b64StdDecode,
  bytesToB64Std,
  isWebAuthnAvailable,
  webauthnRegister,
} from "../../lib/sasl/webauthn";
import useStore, { loadSavedServers } from "../../store";

const TYPE_LABELS: Record<string, string> = {
  totp: "Authenticator app (TOTP)",
  webauthn: "Biometric / security key",
  oauth: "OAuth identity",
  external: "TLS certificate fingerprint",
};

function decodeChallenge(blob: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(b64StdDecode(blob)));
  } catch {
    return null;
  }
}

interface Props {
  serverId: string;
  onClose: () => void;
}

export const TwoFactorSettingsModal: React.FC<Props> = ({
  serverId,
  onClose,
}) => {
  const status = useStore((s) => s.twofaStatus[serverId] ?? "unknown") as
    | "enabled"
    | "disabled"
    | "unknown";
  const credentials = useStore((s) => s.twofaCredentials[serverId] ?? []);
  const challenge = useStore((s) => s.pendingTwofaChallenge);
  const server = useStore((s) => s.servers.find((srv) => srv.id === serverId));

  const twofaStatusQuery = useStore((s) => s.twofaStatusQuery);
  const twofaListQuery = useStore((s) => s.twofaListQuery);
  const twofaChallenge = useStore((s) => s.twofaChallenge);
  const twofaAdd = useStore((s) => s.twofaAdd);
  const twofaRemove = useStore((s) => s.twofaRemove);
  const twofaEnable = useStore((s) => s.twofaEnable);
  const twofaDisable = useStore((s) => s.twofaDisable);
  const linkOauthCredential = useStore((s) => s.linkOauthCredential);

  // OAuth identity providers the admin has surfaced. In a build with
  // VITE_HIDE_SERVER_LIST + VITE_DEFAULT_OAUTH_* set, there's exactly
  // one (the deployer's pinned provider). In a multi-server build we
  // pull the per-server config from localStorage. Either way the shape
  // we need is just `{ providerLabel, serverProvider, ... }`.
  const oauthProviders = useMemo(() => {
    const builtin = __HIDE_SERVER_LIST__ ? getBuiltinOAuthConfig() : undefined;
    if (builtin) return [builtin];
    const saved = loadSavedServers().find((s) => s.id === serverId);
    if (saved?.oauth?.enabled && saved.oauth.issuer && saved.oauth.clientId) {
      return [saved.oauth];
    }
    return [];
  }, [serverId]);
  const [oauthBusy, setOauthBusy] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

  // The server advertises which 2FA factors it supports in the CAP LS
  // value for draft/account-2fa (e.g. "totp,webauthn,oauth"). CAP ACK
  // only echoes the cap name, so we read from `capabilityValues` --
  // populated from CAP LS in src/store/handlers/auth.ts.
  const supportsWebAuthn = (() => {
    if (!server?.capabilities?.includes("draft/account-2fa")) return false;
    const factors = server.capabilityValues?.["draft/account-2fa"];
    // If the cap is acked but no value was seen in CAP LS, assume the
    // server supports the standard factor set rather than silently
    // disabling enrolment.
    if (!factors) return true;
    return factors
      .split(",")
      .map((f) => f.trim().toLowerCase())
      .includes("webauthn");
  })();

  const [enrollName, setEnrollName] = useState("");
  const [enrollCode, setEnrollCode] = useState("");
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: store actions have unstable refs
  useEffect(() => {
    twofaStatusQuery(serverId);
    twofaListQuery(serverId);
  }, [serverId]);

  // Render QR for the active TOTP enrolment challenge.
  useEffect(() => {
    if (
      !challenge ||
      challenge.serverId !== serverId ||
      challenge.type !== "totp"
    ) {
      setQrSvg(null);
      return;
    }
    const decoded = decodeChallenge(challenge.blob);
    const uri =
      decoded &&
      typeof decoded === "object" &&
      decoded !== null &&
      "uri" in decoded &&
      typeof (decoded as { uri: unknown }).uri === "string"
        ? (decoded as { uri: string }).uri
        : null;
    if (!uri) {
      setQrSvg(null);
      return;
    }
    QRCode.toString(uri, { type: "svg", margin: 2, width: 220 })
      .then(setQrSvg)
      .catch(() => setQrSvg(null));
  }, [challenge, serverId]);

  const onAddTotp = () => {
    setEnrollError(null);
    setEnrollName("");
    setEnrollCode("");
    twofaChallenge(serverId, "totp");
  };

  // "Link with <provider>" -- runs the popup OAuth flow to grab a fresh
  // bearer, then fires the /2FA CHALLENGE oauth + /2FA TOKEN + /2FA ADD
  // sequence so the server stores the resulting (provider, subject) row
  // against this account.
  const onLinkOauth = async (
    provider: (typeof oauthProviders)[number],
    name: string,
  ) => {
    setOauthError(null);
    const tag = provider.serverProvider || provider.providerLabel;
    setOauthBusy(tag);
    try {
      const result = await beginOauthLogin({
        issuer: provider.issuer,
        clientId: provider.clientId,
        scopes: provider.scopes || undefined,
        redirectUri: provider.redirectUri || undefined,
        authorizeEndpoint: provider.authorizeEndpoint || undefined,
        tokenEndpoint: provider.tokenEndpoint || undefined,
      });
      const isOpaque = provider.tokenKind === "opaque";
      const bearer = isOpaque
        ? result.accessToken
        : (result.idToken ?? result.accessToken);
      if (!bearer) throw new Error("Provider returned no bearer token.");
      const serverProvider =
        provider.serverProvider ||
        // Fall back to the preset id (e.g. "github") so the obbyircd
        // oauth-provider {} block name lines up with what the user
        // probably typed on the server.
        OAUTH_PRESETS.find(
          (p) => p.label.toLowerCase() === provider.providerLabel.toLowerCase(),
        )?.id ||
        provider.providerLabel.toLowerCase();
      linkOauthCredential(serverId, serverProvider, bearer, name);
    } catch (err) {
      setOauthError(err instanceof Error ? err.message : String(err));
    } finally {
      setOauthBusy(null);
    }
  };

  const onAddWebAuthn = async () => {
    if (!isWebAuthnAvailable()) {
      setEnrollError("WebAuthn is not available in this environment.");
      return;
    }
    setEnrollError(null);
    twofaChallenge(serverId, "webauthn");
  };

  // When a webauthn challenge arrives, run the create() ceremony immediately.
  // biome-ignore lint/correctness/useExhaustiveDependencies: store actions have unstable refs
  useEffect(() => {
    if (
      !challenge ||
      challenge.serverId !== serverId ||
      challenge.type !== "webauthn" ||
      enrollBusy
    )
      return;
    const decoded = decodeChallenge(challenge.blob);
    if (!decoded || typeof decoded !== "object") {
      setEnrollError("Server returned an invalid WebAuthn challenge.");
      return;
    }
    const name = enrollName.trim() || `Device-${Date.now()}`;
    setEnrollBusy(true);
    webauthnRegister(decoded as Parameters<typeof webauthnRegister>[0])
      .then((result) => {
        const payload = bytesToB64Std(
          new TextEncoder().encode(JSON.stringify(result)),
        );
        twofaAdd(serverId, "webauthn", name, payload);
        setEnrollBusy(false);
      })
      .catch((err) => {
        setEnrollError(err instanceof Error ? err.message : String(err));
        setEnrollBusy(false);
      });
  }, [challenge?.blob, challenge?.type, challenge?.serverId, serverId]);

  const onSubmitTotp = (e: React.FormEvent) => {
    e.preventDefault();
    setEnrollError(null);
    const name = enrollName.trim();
    if (!name || /\s/.test(name)) {
      setEnrollError("Pick a single-word name (no spaces).");
      return;
    }
    if (!/^\d{6}$/.test(enrollCode.trim())) {
      setEnrollError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    twofaAdd(serverId, "totp", name, enrollCode.trim());
    setEnrollName("");
    setEnrollCode("");
  };

  const onDisable = () => {
    setEnrollError(null);
    if (!/^\d{6}$/.test(disableCode.trim())) {
      setEnrollError(
        "Enter a 6-digit code from any of your authenticator apps to disable 2FA.",
      );
      return;
    }
    twofaDisable(serverId, "totp", disableCode.trim());
    setDisableCode("");
  };

  const inflightTotp = useMemo(
    () =>
      challenge?.serverId === serverId && challenge?.type === "totp" && !!qrSvg,
    [challenge, qrSvg, serverId],
  );

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[100002]"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-discord-dark-200 rounded-lg w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-white">
            Two-factor authentication
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-discord-text-muted hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 p-3 rounded bg-discord-dark-300">
          <div className="text-sm text-white">
            Status:{" "}
            <span
              className={
                status === "enabled"
                  ? "text-discord-green"
                  : "text-discord-text-muted"
              }
            >
              {status === "enabled"
                ? "Enabled"
                : status === "disabled"
                  ? "Disabled"
                  : "Loading…"}
            </span>
          </div>
        </div>

        <h3 className="text-sm font-semibold text-white mb-2">
          Registered credentials
        </h3>
        {credentials.length === 0 ? (
          <p className="text-sm text-discord-text-muted mb-4">
            You have no 2FA credentials registered.
          </p>
        ) : (
          <ul className="mb-4 space-y-2">
            {credentials.map((c) => {
              // Mirror the server-side REMOVE_LAST_CREDENTIAL guard locally
              // so we never even send the request: with 2FA enforcement on,
              // removing the last credential would either be rejected by
              // the server or, worse on a buggy server, lock the account
              // out of login entirely (see account-2fa.md "Account With No
              // Registered Credentials").
              const isLastWhileEnabled =
                status === "enabled" && credentials.length === 1;
              const isPendingRemoval = removingId === c.id;
              return (
                <li
                  key={c.id}
                  className="p-2 rounded bg-discord-dark-300 space-y-2"
                >
                  <div className="flex justify-between items-center">
                    <div className="text-sm">
                      <div className="text-white font-medium">{c.name}</div>
                      <div className="text-xs text-discord-text-muted">
                        {TYPE_LABELS[c.type] ?? c.type}
                        {c.createdAt ? ` · added ${c.createdAt}` : ""}
                      </div>
                    </div>
                    {!isPendingRemoval && (
                      <button
                        type="button"
                        onClick={() => setRemovingId(c.id)}
                        className="text-xs text-discord-red hover:text-white"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  {isPendingRemoval && isLastWhileEnabled && (
                    <div className="text-xs bg-discord-dark-400 p-2 rounded">
                      <p className="text-discord-yellow font-medium mb-1">
                        Can't remove your last 2FA credential
                      </p>
                      <p className="text-discord-text-muted mb-2">
                        2FA is currently enforced on this account. Removing the
                        only registered credential would lock you out of login.
                        Add another credential first, or disable 2FA below.
                      </p>
                      <button
                        type="button"
                        onClick={() => setRemovingId(null)}
                        className="px-2 py-1 rounded bg-discord-dark-100 text-white"
                      >
                        OK
                      </button>
                    </div>
                  )}
                  {isPendingRemoval && !isLastWhileEnabled && (
                    <div className="text-xs bg-discord-dark-400 p-2 rounded">
                      <p className="text-white mb-2">
                        Remove "{c.name}"? You will no longer be able to use it
                        as a second factor.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            twofaRemove(serverId, c.id);
                            setRemovingId(null);
                          }}
                          className="px-2 py-1 rounded bg-discord-red text-white"
                        >
                          Confirm remove
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemovingId(null)}
                          className="px-2 py-1 rounded bg-discord-dark-100 text-white"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            type="button"
            onClick={onAddTotp}
            className="px-3 py-2 rounded bg-discord-blue text-white text-sm font-medium hover:bg-discord-blue-hover"
          >
            Add authenticator app
          </button>
          <button
            type="button"
            onClick={onAddWebAuthn}
            disabled={!supportsWebAuthn || !isWebAuthnAvailable()}
            className="px-3 py-2 rounded bg-discord-dark-100 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              !supportsWebAuthn
                ? "Server does not advertise WebAuthn support"
                : !isWebAuthnAvailable()
                  ? "Browser does not expose WebAuthn"
                  : ""
            }
          >
            Add biometric / security key
          </button>
        </div>

        {oauthProviders.length > 0 && (
          <div className="mb-4 p-3 rounded bg-discord-dark-300 space-y-2">
            <div className="text-sm text-white font-medium">
              Link an OAuth identity
            </div>
            <p className="text-xs text-discord-text-muted">
              Sign in with the provider, then we'll bind the resulting identity
              to your account so SASL OAUTHBEARER / IRCV3BEARER works on
              subsequent connections.
            </p>
            {oauthProviders.map((p) => {
              const tag = p.serverProvider || p.providerLabel;
              const busy = oauthBusy === tag;
              return (
                <button
                  key={tag}
                  type="button"
                  disabled={busy}
                  onClick={() => onLinkOauth(p, p.providerLabel.toLowerCase())}
                  className={`w-full px-3 py-2 rounded text-white text-sm font-medium ${
                    busy
                      ? "bg-gray-600 cursor-not-allowed"
                      : "bg-discord-primary hover:bg-opacity-80"
                  }`}
                >
                  {busy
                    ? "Waiting for sign-in..."
                    : `Link with ${p.providerLabel}`}
                </button>
              );
            })}
            {oauthError && (
              <p className="text-discord-red text-xs">{oauthError}</p>
            )}
          </div>
        )}

        {inflightTotp && qrSvg && (
          <form
            onSubmit={onSubmitTotp}
            className="mb-4 p-3 rounded bg-discord-dark-300"
          >
            <p className="text-sm text-white mb-2">
              Scan this QR code with your authenticator app, then confirm with
              the 6-digit code it shows.
            </p>
            <div
              className="bg-white p-2 rounded inline-block mb-2"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: QR SVG is generated by qrcode lib from a known otpauth URI
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <div className="flex flex-col gap-2 mt-2">
              <input
                type="text"
                placeholder="Name (e.g. iPhone)"
                value={enrollName}
                onChange={(e) => setEnrollName(e.target.value)}
                className="w-full px-3 py-2 rounded bg-discord-dark-200 text-white"
              />
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                pattern="\d{6}"
                placeholder="6-digit code"
                value={enrollCode}
                onChange={(e) =>
                  setEnrollCode(e.target.value.replace(/\D/g, ""))
                }
                className="w-full px-3 py-2 rounded bg-discord-dark-200 text-white tracking-[0.4em] text-center font-mono"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded bg-discord-green text-white text-sm font-medium"
              >
                Confirm enrolment
              </button>
            </div>
          </form>
        )}

        {enrollError && (
          <p className="text-discord-red text-xs mb-3">{enrollError}</p>
        )}
        {enrollBusy && (
          <p className="text-discord-text-muted text-xs mb-3">
            Waiting for biometric prompt…
          </p>
        )}

        <hr className="border-discord-dark-100 my-3" />

        {status === "enabled" ? (
          <div className="p-3 rounded bg-discord-dark-300">
            <p className="text-sm text-white mb-2">
              Disable 2FA. Enter a 6-digit code from any of your registered
              authenticator apps to confirm.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                pattern="\d{6}"
                placeholder="000000"
                value={disableCode}
                onChange={(e) =>
                  setDisableCode(e.target.value.replace(/\D/g, ""))
                }
                className="flex-1 px-3 py-2 rounded bg-discord-dark-200 text-white tracking-[0.4em] text-center font-mono"
              />
              <button
                type="button"
                onClick={onDisable}
                className="px-3 py-2 rounded bg-discord-red text-white text-sm font-medium"
              >
                Disable
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => twofaEnable(serverId)}
            disabled={credentials.length === 0}
            className="w-full px-3 py-2 rounded bg-discord-green text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {credentials.length === 0
              ? "Add a credential to enable 2FA"
              : "Enable 2FA"}
          </button>
        )}
      </div>
    </div>
  );
};

export default TwoFactorSettingsModal;
