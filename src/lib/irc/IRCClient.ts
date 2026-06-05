import { i18n } from "@lingui/core";
import { v4 as uuidv4, v5 as uuidv5 } from "uuid";
import type {
  BaseIRCEvent,
  BaseMessageEvent,
  BaseMetadataEvent,
  BaseUserActionEvent,
  Channel,
  ConnectionState,
  EventWithTags,
  MetadataValueEvent,
  Server,
  User,
} from "../../types";
import { parseIrcUrl } from "../ircUrlParser";
import { isChannelTarget, parseMessageTags } from "../ircUtils";
import { createSocket, type ISocket } from "../socket";
import { IRC_DISPATCH } from "./handlers";
import type { IRCClientContext } from "./IRCClientContext";

// Namespace UUID for generating deterministic channel/chat IDs
const CHANNEL_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

/**
 * Generate a deterministic UUID for a channel or private chat
 * based on the server ID and channel/chat name
 */
function generateDeterministicId(serverId: string, name: string): string {
  return uuidv5(`${serverId}:${name}`, CHANNEL_NAMESPACE);
}

export interface EventMap {
  ready: BaseIRCEvent & { serverName: string; nickname: string };
  connectionStateChange: BaseIRCEvent & {
    serverId: string;
    connectionState: ConnectionState;
  };
  NICK: EventWithTags & {
    oldNick: string;
    newNick: string;
    batchTag?: string;
  };
  QUIT: BaseUserActionEvent & {
    reason: string;
    batchTag?: string;
    time?: string;
  };
  JOIN: BaseUserActionEvent & {
    channelName: string;
    batchTag?: string;
    time?: string;
    account?: string; // From extended-join
    realname?: string; // From extended-join
  };
  PART: BaseUserActionEvent & {
    channelName: string;
    reason?: string;
    batchTag?: string;
    time?: string;
  };
  KICK: EventWithTags & {
    username: string;
    channelName: string;
    target: string;
    reason: string;
  };
  MODE: EventWithTags & {
    sender: string;
    target: string;
    modestring: string;
    modeargs: string[];
  };
  RPL_CHANNELMODEIS: BaseIRCEvent & {
    channelName: string;
    modestring: string;
    modeargs: string[];
  };
  CHANMSG: BaseMessageEvent & {
    channelName: string;
  };
  USERMSG: BaseMessageEvent & {
    target: string; // The recipient of the PRIVMSG (for whispers)
  };
  CHANNNOTICE: BaseMessageEvent & {
    channelName: string;
  };
  USERNOTICE: BaseMessageEvent;
  TAGMSG: EventWithTags & {
    sender: string;
    channelName: string;
    timestamp: Date;
  };
  REDACT: EventWithTags & {
    target: string;
    msgid: string;
    reason: string;
    sender: string;
  };
  NAMES: BaseIRCEvent & { channelName: string; users: User[] };
  "CAP LS": BaseIRCEvent & { cliCaps: string };
  "CAP ACK": BaseIRCEvent & { cliCaps: string };
  ISUPPORT: BaseIRCEvent & { key: string; value: string };
  CAP_ACKNOWLEDGED: BaseIRCEvent & { key: string; capabilities: string };
  CAP_END: BaseIRCEvent;
  AUTHENTICATE: BaseIRCEvent & { param: string };
  METADATA: MetadataValueEvent;
  METADATA_WHOIS: MetadataValueEvent;
  METADATA_KEYVALUE: MetadataValueEvent;
  METADATA_KEYNOTSET: BaseMetadataEvent;
  METADATA_SUBOK: BaseIRCEvent & { keys: string[] };
  METADATA_UNSUBOK: BaseIRCEvent & { keys: string[] };
  METADATA_SUBS: BaseIRCEvent & { keys: string[] };
  METADATA_SYNCLATER: BaseIRCEvent & { target: string; retryAfter?: number };
  // soju.im/bouncer-networks
  BOUNCER_NETWORK: BaseIRCEvent & {
    netid: string;
    deleted: boolean;
    attributes: Record<string, string>;
    batchTag?: string;
  };
  BOUNCER_ADDNETWORK_OK: BaseIRCEvent & { netid: string };
  BOUNCER_CHANGENETWORK_OK: BaseIRCEvent & { netid: string };
  BOUNCER_DELNETWORK_OK: BaseIRCEvent & { netid: string };
  BOUNCER_FAIL: BaseIRCEvent & {
    code: string;
    subcommand: string;
    netid?: string;
    attribute?: string;
    context: string[];
    description: string;
  };
  BATCH_START: BaseIRCEvent & {
    batchId: string;
    type: string;
    parameters?: string[];
  };
  BATCH_END: BaseIRCEvent & { batchId: string };
  MULTILINE_MESSAGE: BaseMessageEvent & {
    channelName?: string;
    target: string; // raw BATCH recipient (channel name or username)
    lines: string[];
    messageIds: string[]; // All message IDs that make up this multiline message
  };
  METADATA_FAIL: BaseIRCEvent & {
    subcommand: string;
    code: string;
    target?: string;
    key?: string;
    retryAfter?: number;
  };
  LIST_CHANNEL: {
    serverId: string;
    channel: string;
    userCount: number;
    topic: string;
  };
  LIST_END: { serverId: string };
  RENAME: {
    serverId: string;
    oldName: string;
    newName: string;
    reason: string;
    user: string;
  };
  SETNAME: {
    serverId: string;
    user: string;
    realname: string;
    ident?: string;
    host?: string;
  };
  INVITE: EventWithTags & {
    inviter: string;
    target: string;
    channel: string;
  };
  INVITE_SENT: {
    serverId: string;
    target: string;
    channel: string;
  };
  FAIL: EventWithTags & {
    command: string;
    code: string;
    target?: string;
    context: string[];
    message: string;
  };
  WARN: EventWithTags & {
    command: string;
    code: string;
    target?: string;
    context: string[];
    message: string;
  };
  NOTE: EventWithTags & {
    command: string;
    code: string;
    target?: string;
    context: string[];
    message: string;
  };
  SUCCESS: EventWithTags & {
    command: string;
    code: string;
    target?: string;
    context: string[];
    message: string;
  };
  REGISTER_SUCCESS: EventWithTags & {
    account: string;
    message: string;
  };
  REGISTER_VERIFICATION_REQUIRED: EventWithTags & {
    account: string;
    message: string;
  };
  VERIFY_SUCCESS: EventWithTags & {
    account: string;
    message: string;
  };
  WHO_REPLY: {
    serverId: string;
    channel: string;
    username: string;
    host: string;
    server: string;
    nick: string;
    flags: string;
    hopcount: string;
    realname: string;
  };
  WHOX_REPLY: {
    serverId: string;
    channel: string;
    username: string;
    host: string;
    nick: string;
    account: string;
    flags: string;
    realname: string;
    isAway: boolean;
    opLevel: string;
  };
  WHO_END: { serverId: string; mask: string };
  RPL_AWAY: {
    serverId: string;
    nick: string;
    awayMessage: string;
  };
  RPL_YOUREOPER: BaseIRCEvent & {
    message: string;
  };
  RPL_YOURHOST: BaseIRCEvent & {
    serverName: string;
    version: string;
  };
  MONONLINE: BaseIRCEvent & {
    targets: Array<{ nick: string; user?: string; host?: string }>;
  };
  MONOFFLINE: BaseIRCEvent & {
    targets: string[]; // Just nicknames
  };
  MONLIST: BaseIRCEvent & {
    targets: string[];
  };
  ENDOFMONLIST: BaseIRCEvent;
  MONLISTFULL: BaseIRCEvent & {
    limit: number;
    targets: string[];
  };
  // draft/authtoken: server reply to TOKEN GENERATE.
  TOKEN_GENERATE: BaseIRCEvent & {
    service: string;
    url: string;
    token: string;
  };
  // draft/authtoken: TOKEN SERVICE entry inside a draft/authtoken BATCH
  // (sent in reply to TOKEN SERVICELIST). One event per service.
  TOKEN_SERVICE: BaseIRCEvent & {
    service: string;
    url: string;
    description: string;
  };
  // IRCv3 draft/named-modes (PROP command + RPL_CHMODELIST etc.).
  // The "registry" events (CHANMODE_LIST / UMODE_LIST) carry the
  // server's long-form mode name table; the "mode change" event
  // (PROP) carries an actual mode change; the rest pair with the
  // listing forms of PROP <chan> [<listmode>].
  NAMED_MODES_CHANMODE_LIST: BaseIRCEvent & {
    entries: Array<{
      type: 1 | 2 | 3 | 4 | 5;
      name: string;
      letter?: string;
    }>;
    isFinal: boolean;
  };
  NAMED_MODES_UMODE_LIST: BaseIRCEvent & {
    entries: Array<{
      type: 1 | 2 | 3 | 4 | 5;
      name: string;
      letter?: string;
    }>;
    isFinal: boolean;
  };
  NAMED_MODES_PROPLIST: BaseIRCEvent & {
    channel: string;
    items: string[];
  };
  NAMED_MODES_PROPLIST_END: BaseIRCEvent & { channel: string };
  NAMED_MODES_LISTPROPLIST: BaseIRCEvent & {
    channel: string;
    modeName: string;
    mask: string;
    setter: string;
    settime: number;
  };
  NAMED_MODES_LISTPROPLIST_END: BaseIRCEvent & {
    channel: string;
    modeName: string;
  };
  NAMED_MODES_PROP: EventWithTags & {
    sender: string;
    target: string;
    items: Array<{ sign: "+" | "-"; name: string; param?: string }>;
    timestamp: Date;
  };
  TWOFA: EventWithTags & {
    subcommand: string;
    status: string;
    args: string[];
  };
  TWOFA_NOTE: EventWithTags & {
    code: string;
    args: string[];
  };
  // draft/account-recovery: convenient typed projection of the
  // generic NOTE/FAIL events for the RECOVER + SETPASS commands.
  // The dispatch in handlers/auth.ts emits these alongside the
  // generic NOTE/FAIL.
  RECOVER_NOTE: EventWithTags & { code: string; args: string[] };
  RECOVER_FAIL: EventWithTags & { code: string; message: string };
  SETPASS_NOTE: EventWithTags & { code: string; args: string[] };
  SETPASS_FAIL: EventWithTags & { code: string; message: string };
  // draft/persistence: server reply
  // `:server PERSISTENCE STATUS <client-setting> <effective-setting>`
  // where each is one of ON | OFF | DEFAULT (effective is always ON|OFF).
  PERSISTENCE_STATUS: BaseIRCEvent & {
    preference: "ON" | "OFF" | "DEFAULT";
    effective: "ON" | "OFF";
  };
  PERSISTENCE_FAIL: EventWithTags & { code: string; message: string };
  // draft/read-marker: server reply
  // `:server MARKREAD <target> {timestamp=<ts>|*}`.  `timestamp` is null
  // when the server reports "*" (no marker on file yet).
  MARKREAD: BaseIRCEvent & {
    target: string;
    timestamp: string | null;
  };
  MARKREAD_FAIL: EventWithTags & {
    code: string;
    target?: string;
    message: string;
  };
  // obsidianirc/cmdslist: server is reporting an add/remove delta of
  // commands the user can invoke right now.  Ops are individual
  // tokens of the form "+cmd" or "-cmd" (multiple per wire line).
  CMDSLIST: BaseIRCEvent & {
    additions: string[];
    removals: string[];
  };
  EXTJWT: BaseIRCEvent & {
    requestedTarget: string;
    serviceName: string;
    jwtToken: string;
  };
  WHOIS_BOT: {
    serverId: string;
    nick: string;
    target: string;
    message: string;
  };
  AWAY: {
    serverId: string;
    username: string;
    awayMessage?: string;
  };
  CHGHOST: {
    serverId: string;
    username: string;
    newUser: string;
    newHost: string;
  };
  RPL_NOWAWAY: {
    serverId: string;
    message: string;
  };
  RPL_UNAWAY: {
    serverId: string;
    message: string;
  };
  NICK_ERROR: {
    serverId: string;
    code: string;
    error: string;
    nick?: string;
    message: string;
  };
  CHATHISTORY_LOADING: {
    serverId: string;
    channelName: string;
    isLoading: boolean;
  };
  RPL_BANLIST: {
    serverId: string;
    channel: string;
    mask: string;
    setter: string;
    timestamp: number;
  };
  RPL_INVITELIST: {
    serverId: string;
    channel: string;
    mask: string;
    setter: string;
    timestamp: number;
  };
  RPL_EXCEPTLIST: {
    serverId: string;
    channel: string;
    mask: string;
    setter: string;
    timestamp: number;
  };
  RPL_ENDOFBANLIST: {
    serverId: string;
    channel: string;
  };
  RPL_ENDOFINVITELIST: {
    serverId: string;
    channel: string;
  };
  RPL_ENDOFEXCEPTLIST: {
    serverId: string;
    channel: string;
  };
  TOPIC: {
    serverId: string;
    channelName: string;
    topic: string;
    sender: string;
  };
  RPL_TOPIC: {
    serverId: string;
    channelName: string;
    topic: string;
  };
  RPL_TOPICWHOTIME: {
    serverId: string;
    channelName: string;
    setter: string;
    timestamp: number;
  };
  RPL_NOTOPIC: {
    serverId: string;
    channelName: string;
  };
  WHOIS_USER: {
    serverId: string;
    nick: string;
    username: string;
    host: string;
    realname: string;
  };
  WHOIS_SERVER: {
    serverId: string;
    nick: string;
    server: string;
    serverInfo: string;
  };
  WHOIS_IDLE: {
    serverId: string;
    nick: string;
    idle: number;
    signon: number;
  };
  WHOIS_CHANNELS: {
    serverId: string;
    nick: string;
    channels: string;
  };
  WHOIS_SPECIAL: {
    serverId: string;
    nick: string;
    message: string;
  };
  WHOIS_ACCOUNT: {
    serverId: string;
    nick: string;
    account: string;
  };
  WHOIS_SECURE: {
    serverId: string;
    nick: string;
    message: string;
  };
  WHOIS_END: {
    serverId: string;
    nick: string;
  };
  rateLimited: {
    serverId: string;
    message: string;
    retryAfter: number;
  };
}

type EventKey = keyof EventMap;
type EventCallback<K extends EventKey> = (data: EventMap[K]) => void;

export class IRCClient implements IRCClientContext {
  private sockets: Map<string, ISocket> = new Map();
  servers: Map<string, Server> = new Map();
  nicks: Map<string, string> = new Map();
  myIdents: Map<string, string> = new Map(); // Our own ident per server, populated by draft/whoami SETNAME burst and CHGHOST
  myHosts: Map<string, string> = new Map(); // Our own hostname per server, populated by draft/whoami SETNAME burst and CHGHOST
  currentUsers: Map<string, User | null> = new Map(); // Per-server current users
  private saslMechanisms: Map<string, string[]> = new Map();
  private capLsAccumulated: Map<string, Set<string>> = new Map();
  private saslEnabled: Map<string, boolean> = new Map();
  private saslCredentials: Map<string, { username: string; password: string }> =
    new Map();
  private pendingConnections: Map<string, Promise<Server>> = new Map();
  private pendingCapReqs: Map<string, number> = new Map(); // Track how many CAP REQ batches are pending ACK
  // soju.im/bouncer-networks BIND: when a serverId is mapped here, the
  // next CAP END for that server is preceded by a `BOUNCER BIND <netid>`
  // line so the connection lands inside the named upstream network's
  // session rather than the bouncer's control channel.
  private pendingBouncerBind: Map<string, string> = new Map();
  capNegotiationComplete: Map<string, boolean> = new Map(); // Track if CAP negotiation is complete
  private reconnectionAttempts: Map<string, number> = new Map(); // Track reconnection attempts per server
  reconnectionTimeouts: Map<string, NodeJS.Timeout> = new Map(); // Track reconnection timeouts per server
  rateLimitedServers: Map<string, number> = new Map(); // Track rate-limited servers (serverId -> timestamp)
  private pingTimers: Map<string, NodeJS.Timeout> = new Map(); // Track ping timers per server
  pongTimeouts: Map<string, NodeJS.Timeout> = new Map(); // Track pong timeouts per server
  private serverConnectParams: Map<
    string,
    {
      name: string;
      host: string;
      port: number;
      nickname: string;
      password?: string;
      saslAccountName?: string;
      saslPassword?: string;
    }
  > = new Map();
  private lastWakeReconnect: Map<string, number> = new Map();
  activeBatches: Map<
    string,
    Map<
      string,
      {
        type: string;
        parameters?: string[];
        messages: string[];
        concatFlags?: boolean[];
        sender?: string;
        messageIds?: string[];
        timestamps?: Date[];
        batchMsgId?: string;
        batchTime?: Date;
        batchTags?: Record<string, string>;
      }
    >
  > = new Map(); // Track active batches per server

  private ourCaps: string[] = [
    "multi-prefix",
    "message-tags",
    "server-time",
    "echo-message",
    "userhost-in-names",
    // We populate the member list from WHO/WHOX on JOIN (see
    // store/handlers/messages.ts and store/index.ts), so we don't need
    // -- and don't want -- the implicit RPL_NAMREPLY burst the server
    // would otherwise emit. The ratified `no-implicit-names` cap tells
    // the server to skip it; we also REQ the original draft name for
    // back-compat with servers that haven't moved to the ratified form.
    "no-implicit-names",
    "draft/no-implicit-names",
    "draft/chathistory",
    "draft/event-playback",
    "draft/extended-isupport",
    "sasl",
    "cap-notify",
    "draft/channel-rename",
    "setname",
    "account-notify",
    "account-tag",
    "extended-join",
    "away-notify",
    "chghost",
    "draft/whoami",
    "draft/metadata-2",
    "draft/message-redaction",
    "draft/account-registration",
    "draft/account-2fa",
    "batch",
    "draft/multiline",
    "draft/typing",
    "channel-context",
    "draft/channel-context",
    "znc.in/playback",
    "unrealircd.org/json-log",
    "invite-notify",
    "monitor",
    "extended-monitor",
    "obsidianirc/voice",
    "draft/named-modes",
    "labeled-response",
    "draft/read-marker",
    "obsidianirc/cmdslist",
    // soju.im/bouncer-networks: multi-network bouncer discovery. The
    // -notify variant gives us live add/change/del pushes without
    // polling LISTNETWORKS.
    "soju.im/bouncer-networks",
    "soju.im/bouncer-networks-notify",
    // Note: unrealircd.org/link-security is informational only, don't request it
  ];

  private eventCallbacks: {
    [K in EventKey]?: EventCallback<K>[];
  } = {};

  public version = __APP_VERSION__;

  connect(
    name: string,
    host: string,
    port: number,
    nickname: string,
    password?: string,
    _saslAccountName?: string,
    _saslPassword?: string,
    serverId?: string,
    oauthBearerEnabled?: boolean,
  ): Promise<Server> {
    // Bouncer child connections share host:port with the control
    // connection (and with each other). Scope the pending-connection
    // dedup by serverId when one is provided so each child gets its
    // own promise rather than landing on a sibling's.
    const connectionKey = serverId ?? `${host}:${port}`;

    // Check if there's already a pending connection to this server
    const existingConnection = this.pendingConnections.get(connectionKey);
    if (existingConnection) {
      return existingConnection;
    }

    // Check if already connected to this server (but allow reconnection if serverId is provided)
    if (!serverId) {
      const existingServer = Array.from(this.servers.values()).find(
        (server) => server.host === host && server.port === port,
      );
      if (existingServer) {
        return Promise.resolve(existingServer);
      }
    }

    // Create a new connection promise and store it
    const connectionPromise = new Promise<Server>((resolve, reject) => {
      let protocol: "wss" | "ircs" | "irc" = "wss";
      let actualHost = host;
      let actualPort = port;
      let actualPath = "";

      if (host.startsWith("irc://") || host.startsWith("ircs://")) {
        // Parse the IRC URL using centralized parser (Android-compatible)
        const parsed = parseIrcUrl(host);

        protocol = parsed.scheme;
        actualHost = parsed.host;
        actualPort = parsed.port;
      } else if (host.startsWith("wss://")) {
        // Use URL constructor to preserve path/query (e.g. wss://host/websocket?token=...)
        try {
          const parsed = new URL(host);
          actualHost = parsed.hostname;
          actualPort = parsed.port ? Number.parseInt(parsed.port, 10) : port;
          actualPath =
            parsed.pathname !== "/"
              ? parsed.pathname + parsed.search
              : parsed.search;
        } catch {
          // malformed URL — leave actualHost/Port from the default
        }
      } else if (host.startsWith("ws://")) {
        // Upgrade legacy ws:// to wss:// — unencrypted WebSockets are no longer supported
        try {
          const parsed = new URL(host);
          actualHost = parsed.hostname;
          actualPort = parsed.port ? Number.parseInt(parsed.port, 10) : port;
          actualPath =
            parsed.pathname !== "/"
              ? parsed.pathname + parsed.search
              : parsed.search;
        } catch {
          // malformed URL — leave actualHost/Port from the default
        }
      }

      const url = `${protocol}://${actualHost}:${actualPort}${actualPath}`;
      const socket = createSocket(url);

      // Create server object immediately and add to servers map
      // Use provided name, default to actualHost if name is empty
      const finalName = name?.trim() || actualHost;

      // Check if we're reconnecting to an existing server
      let server: Server;
      if (serverId && this.servers.has(serverId)) {
        // Reuse existing server object for reconnection
        const existingServer = this.servers.get(serverId);
        if (existingServer) {
          server = existingServer;
          // Update connection state
          server.connectionState = "connecting";
          server.isConnected = false;
          // Reset CAP negotiation state for reconnection
          this.capNegotiationComplete.delete(serverId);
        } else {
          throw new Error(`Server ${serverId} not found despite has() check`);
        }
      } else {
        // Create new server object
        server = {
          id: serverId || uuidv4(),
          name: finalName,
          host: actualHost,
          port,
          channels: [],
          privateChats: [],
          isConnected: false, // Not connected yet
          connectionState: "connecting",
          users: [],
        };
        this.servers.set(server.id, server);
      }
      this.sockets.set(server.id, socket);
      this.serverConnectParams.set(server.id, {
        name,
        host,
        port,
        nickname,
        password,
        saslAccountName: _saslAccountName,
        saslPassword: _saslPassword,
      });
      // Enable SASL if we have either PLAIN credentials or an OAuth bearer
      // path. OAuth path is signaled by the caller; tokens themselves are
      // read from storage by the auth handler at AUTHENTICATE time. On
      // internal reconnect (oauthBearerEnabled === undefined) preserve the
      // previously-set value so the OAuth flag survives reconnects.
      const priorSaslEnabled = this.saslEnabled.get(server.id) ?? false;
      const wantOauth =
        oauthBearerEnabled === undefined
          ? priorSaslEnabled
          : !!oauthBearerEnabled;
      this.saslEnabled.set(
        server.id,
        !!(_saslAccountName && _saslPassword) || wantOauth,
      );

      // Store SASL credentials if provided
      if (_saslAccountName && _saslPassword) {
        this.saslCredentials.set(server.id, {
          username: _saslAccountName,
          password: _saslPassword,
        });
      }

      this.currentUsers.set(server.id, {
        id: uuidv4(),
        username: nickname,
        isOnline: true,
        status: "online",
      });
      this.nicks.set(server.id, nickname);

      socket.onopen = () => {
        //registerAllProtocolHandlers(this);

        socket.send("CAP LS 302");

        // Send password if provided (before CAP negotiation completes)
        if (password) {
          socket.send(`PASS ${password}`);
        }

        // Send NICK command (can be sent during CAP negotiation)
        socket.send(`NICK ${nickname}`);

        // Update server to mark as connected
        server.isConnected = true;
        server.connectionState = "connected";
        this.triggerEvent("connectionStateChange", {
          serverId: server.id,
          connectionState: "connected",
        });

        // Rejoin channels if this is a reconnection
        if (server.channels.length > 0) {
          for (const channel of server.channels) {
            if (serverId) {
              this.sendRaw(serverId, `JOIN ${channel.name}`);
            }
          }
        }

        // Don't start ping timer here - wait for 001 welcome message
        // to ensure connection is fully established before sending PINGs

        socket.onclose = () => {
          if (!this.servers.has(server.id)) {
            return;
          }

          this.stopWebSocketPing(server.id);
          this.sockets.delete(server.id);
          server.isConnected = false;
          const wasReconnecting = server.connectionState === "reconnecting";
          server.connectionState = "disconnected";
          this.triggerEvent("connectionStateChange", {
            serverId: server.id,
            connectionState: "disconnected",
          });
          this.pendingConnections.delete(connectionKey);
          if (!wasReconnecting) {
            this.startReconnection(
              server.id,
              name,
              host,
              port,
              nickname,
              password,
              _saslAccountName,
              _saslPassword,
            );
          }
        };

        resolve(server);
      };

      socket.onerror = (error) => {
        // Mark server as disconnected but keep it in the map
        server.isConnected = false;
        server.connectionState = "disconnected";
        this.sockets.delete(server.id);
        this.pendingConnections.delete(connectionKey);
        reject(new Error(`Failed to connect to ${actualHost}:${actualPort}`));
      };

      socket.onmessage = (event) => {
        const serverId = Array.from(this.servers.keys()).find(
          (id) => this.sockets.get(id) === socket,
        );
        if (serverId) {
          this.handleMessage(event.data, serverId);
        }
      };
    });

    // Store the pending connection
    this.pendingConnections.set(connectionKey, connectionPromise);

    // Clean up the pending connection when it resolves or rejects
    connectionPromise.finally(() => {
      this.pendingConnections.delete(connectionKey);
    });

    return connectionPromise;
  }

  disconnect(serverId: string, quitMessage?: string): void {
    const socket = this.sockets.get(serverId);
    if (socket) {
      const message =
        quitMessage ||
        i18n._({ id: "ObsidianIRC - Bringing IRC to the future" });
      socket.send(`QUIT :${message}`);
      socket.close();
      this.sockets.delete(serverId);
    }
    const server = this.servers.get(serverId);
    if (server) {
      server.isConnected = false;
      server.connectionState = "disconnected";
      this.triggerEvent("connectionStateChange", {
        serverId: server.id,
        connectionState: "disconnected",
      });
      const connectionKey = `${server.host}:${server.port}`;
      this.pendingConnections.delete(connectionKey);
    }
    // Clear reconnection state
    this.reconnectionAttempts.delete(serverId);
    const timeout = this.reconnectionTimeouts.get(serverId);
    if (timeout) {
      clearTimeout(timeout);
      this.reconnectionTimeouts.delete(serverId);
    }
    // Stop WebSocket ping timers
    this.stopWebSocketPing(serverId);
  }

  removeServer(serverId: string): void {
    this.disconnect(serverId);
    this.servers.delete(serverId);
    this.capNegotiationComplete.delete(serverId);
    this.pendingCapReqs.delete(serverId);
    this.capLsAccumulated.delete(serverId);
    this.saslMechanisms.delete(serverId);
    this.myIdents.delete(serverId);
    this.myHosts.delete(serverId);
  }

  private startReconnection(
    serverId: string,
    name: string,
    host: string,
    port: number,
    nickname: string,
    password?: string,
    saslAccountName?: string,
    saslPassword?: string,
  ): void {
    console.log(`Starting reconnection for server ${serverId}`);
    const server = this.servers.get(serverId);
    if (!server) return;

    const rateLimitTime = this.rateLimitedServers.get(serverId);
    if (rateLimitTime) {
      const waitTime = 600000;
      const elapsed = Date.now() - rateLimitTime;
      if (elapsed < waitTime) {
        console.log(
          `Server ${serverId} is rate-limited. ${Math.ceil((waitTime - elapsed) / 1000)}s remaining.`,
        );
        return;
      }
      this.rateLimitedServers.delete(serverId);
    }

    const existingTimeout = this.reconnectionTimeouts.get(serverId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const attempts = this.reconnectionAttempts.get(serverId) || 0;
    this.reconnectionAttempts.set(serverId, attempts + 1);

    const maxAttempts = 100;
    if (attempts >= maxAttempts) {
      server.connectionState = "disconnected";
      this.triggerEvent("connectionStateChange", {
        serverId: server.id,
        connectionState: "disconnected",
      });
      return;
    }

    const baseDelay = 2000;
    const maxDelay = 300000;
    const delay = Math.min(baseDelay * 2 ** attempts, maxDelay);
    const jitter = Math.random() * 1000;
    const finalDelay = delay + jitter;

    server.connectionState = "reconnecting";
    this.triggerEvent("connectionStateChange", {
      serverId: server.id,
      connectionState: "reconnecting",
    });

    this.reconnectionTimeouts.set(
      serverId,
      setTimeout(() => {
        this.attemptReconnection(
          serverId,
          name,
          host,
          port,
          nickname,
          password,
          saslAccountName,
          saslPassword,
        );
      }, finalDelay),
    );
  }

  private async attemptReconnection(
    serverId: string,
    name: string,
    host: string,
    port: number,
    nickname: string,
    password?: string,
    saslAccountName?: string,
    saslPassword?: string,
  ): Promise<void> {
    const server = this.servers.get(serverId);
    if (!server) return;

    try {
      server.connectionState = "connecting";
      this.triggerEvent("connectionStateChange", {
        serverId: server.id,
        connectionState: "connecting",
      });
      await this.connect(
        name,
        host,
        port,
        nickname,
        password,
        saslAccountName,
        saslPassword,
        serverId,
      );
      console.log(`Reconnection successful for server ${serverId}`);
      // Success - reset reconnection attempts
      this.reconnectionAttempts.delete(serverId);
      this.reconnectionTimeouts.delete(serverId);
    } catch (error) {
      console.log(`Reconnection failed for server ${serverId}:`, error);
      // Failed - try again
      this.startReconnection(
        serverId,
        name,
        host,
        port,
        nickname,
        password,
        saslAccountName,
        saslPassword,
      );
    }
  }

  sendRaw(serverId: string, command: string): void {
    const socket = this.sockets.get(serverId);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(command);
    } else {
      console.error(`Socket for server ${serverId} is not open`);
    }
  }

  startWebSocketPing(serverId: string): void {
    // Clear any existing ping timer
    this.stopWebSocketPing(serverId);

    // Send ping every 30 seconds
    const pingTimer = setInterval(() => {
      const socket = this.sockets.get(serverId);
      if (socket && socket.readyState === WebSocket.OPEN) {
        try {
          // Send WebSocket ping frame (opcode 0x9)
          // Since we can't send ping frames directly in JS, we'll send an IRC PING
          // which serves as both IRC keepalive and WebSocket activity
          const timestamp = Date.now().toString();
          this.sendRaw(serverId, `PING :${timestamp}`);

          // Clear any previous pong timeout before starting a new one — otherwise
          // a missed PONG from the prior cycle would close the socket mid-interval.
          const oldPongTimeout = this.pongTimeouts.get(serverId);
          if (oldPongTimeout) clearTimeout(oldPongTimeout);

          const pongTimeout = setTimeout(() => {
            console.warn(
              `WebSocket ping timeout for server ${serverId}, closing connection`,
            );
            socket.close();
          }, 10000);

          this.pongTimeouts.set(serverId, pongTimeout);
        } catch (error) {
          console.error(`Failed to send ping for server ${serverId}:`, error);
        }
      }
    }, 30000); // 30 seconds

    this.pingTimers.set(serverId, pingTimer);
  }

  private stopWebSocketPing(serverId: string): void {
    const pingTimer = this.pingTimers.get(serverId);
    if (pingTimer) {
      clearInterval(pingTimer);
      this.pingTimers.delete(serverId);
    }

    const pongTimeout = this.pongTimeouts.get(serverId);
    if (pongTimeout) {
      clearTimeout(pongTimeout);
      this.pongTimeouts.delete(serverId);
    }
  }

  isRateLimitError(message: string): boolean {
    const rateLimitPatterns = [
      /too many.*connect/i,
      /connect.*too many/i,
      /throttled/i,
      /rate limit/i,
      /wait.*while/i,
      /try again later/i,
    ];
    return rateLimitPatterns.some((pattern) => pattern.test(message));
  }

  joinChannel(serverId: string, channelName: string): Channel {
    const server = this.servers.get(serverId);
    if (server) {
      const existing = server.channels.find((c) => c.name === channelName);
      if (existing) {
        // The cached entry persists across reconnects and through ircd
        // restarts, but the server-side membership doesn't. Re-send the
        // JOIN: the ircd treats already-in users as a no-op and stale
        // memberships (e.g. cached `$test` from before a server restart)
        // self-heal. Without this, PRIVMSG/TAGMSG to the cached channel
        // returns 401 No such nick/channel because the server forgot.
        this.sendRaw(serverId, `JOIN ${channelName}`);
        return existing;
      }

      this.sendRaw(serverId, `JOIN ${channelName}`);

      // Only request CHATHISTORY if the server supports it
      if (server.capabilities?.includes("draft/chathistory")) {
        this.sendRaw(serverId, `CHATHISTORY LATEST ${channelName} * 50`);
      }

      const channel: Channel = {
        id: generateDeterministicId(serverId, channelName),
        name: channelName,
        topic: "",
        isPrivate: false,
        serverId,
        unreadCount: 0,
        isMentioned: false,
        messages: [],
        users: [],
        isLoadingHistory: !!server.capabilities?.includes("draft/chathistory"), // Only loading if we requested history
        hasMoreHistory: !!server.capabilities?.includes("draft/chathistory"), // Assume there's history until proven otherwise
        needsWhoRequest: true, // Need to request WHO after CHATHISTORY completes (or immediately if no CHATHISTORY)
        chathistoryRequested:
          !!server.capabilities?.includes("draft/chathistory"), // Mark that we've requested CHATHISTORY only if supported
      };
      server.channels.push(channel);

      // Trigger event to notify store that history loading started (only if we actually requested it)
      if (server.capabilities?.includes("draft/chathistory")) {
        this.triggerEvent("CHATHISTORY_LOADING", {
          serverId,
          channelName,
          isLoading: true,
        });
      }

      return channel;
    }
    throw new Error(`Server with ID ${serverId} not found`);
  }

  requestChathistoryBefore(
    serverId: string,
    channelName: string,
    beforeTimestamp: string,
  ): void {
    const server = this.servers.get(serverId);
    if (!server?.capabilities?.includes("draft/chathistory")) return;
    // Fire isLoading:true so the store sets isLoadingHistory=true for the whole batch.
    // The React component uses isLoadingMore to keep messages in DOM (no full-screen spinner)
    // and restores scroll position once isLoadingHistory goes false (batch end).
    this.triggerEvent("CHATHISTORY_LOADING", {
      serverId,
      channelName,
      isLoading: true,
    });
    this.sendRaw(
      serverId,
      `CHATHISTORY BEFORE ${channelName} timestamp=${beforeTimestamp} 50`,
    );
  }

  leaveChannel(serverId: string, channelName: string): void {
    const server = this.servers.get(serverId);
    if (server) {
      this.sendRaw(serverId, `PART ${channelName}`);
      server.channels = server.channels.filter((c) => c.name !== channelName);
    }
  }

  sendMessage(serverId: string, channelId: string, content: string): void {
    const server = this.servers.get(serverId);
    if (!server) throw new Error(`Server ${serverId} not found`);
    const channel = server.channels.find((c) => c.id === channelId);
    if (!channel) throw new Error(`Channel ${channelId} not found`);

    // Phantom-channel guard: if our local cache shows zero members
    // for a non-private channel, the ircd doesn't actually have us
    // in this channel (either the channel was destroyed when the
    // last person left, or the ircd was restarted and we haven't
    // re-JOINed). Send JOIN first so the PRIVMSG that follows lands
    // somewhere instead of returning 401 No such nick/channel.
    if (
      !channel.isPrivate &&
      (channel.users?.length ?? 0) === 0 &&
      this.isCapNegotiationComplete(serverId)
    ) {
      this.sendRaw(serverId, `JOIN ${channel.name}`);
    }

    // Check if server supports multiline and message has newlines
    // Note: We'll check server capabilities from the store later via helper function
    const lines = content.split("\n");

    if (lines.length > 1 && this.hasCapability(serverId, "draft/multiline")) {
      this.sendMultilineMessage(serverId, channel.name, lines);
    } else if (lines.length > 1) {
      // Server didn't negotiate draft/multiline — degrade to separate PRIVMSGs
      for (const line of lines) {
        this.sendRaw(serverId, `PRIVMSG ${channel.name} :${line}`);
      }
    } else {
      this.sendRaw(serverId, `PRIVMSG ${channel.name} :${content}`);
    }
  }

  sendWhisper(
    serverId: string,
    targetUser: string,
    channelName: string,
    content: string,
  ): void {
    // Send a whisper with both the ratified and draft channel-context tags for backwards compat
    this.sendRaw(
      serverId,
      `@+channel-context=${channelName};+draft/channel-context=${channelName} PRIVMSG ${targetUser} :${content}`,
    );
  }

  setTopic(serverId: string, channelName: string, topic: string): void {
    // Send TOPIC command to set the channel topic
    // Format: TOPIC #channel :New topic text
    this.sendRaw(serverId, `TOPIC ${channelName} :${topic}`);
  }

  getTopic(serverId: string, channelName: string): void {
    // Send TOPIC command without parameters to get current topic
    // Format: TOPIC #channel
    this.sendRaw(serverId, `TOPIC ${channelName}`);
  }

  whois(serverId: string, nickname: string): void {
    // Send WHOIS command to get user information
    // Format: WHOIS nickname
    this.sendRaw(serverId, `WHOIS ${nickname}`);
  }

  sendMultilineMessage(
    serverId: string,
    target: string,
    lines: string[],
  ): void {
    const batchId = `ml_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Start multiline batch
    this.sendRaw(serverId, `BATCH +${batchId} draft/multiline ${target}`);

    // Send each line as a separate PRIVMSG with batch tag
    // Handle long lines by splitting them if needed
    for (const line of lines) {
      const splitLines = this.splitLongLine(line);
      for (const splitLine of splitLines) {
        this.sendRaw(
          serverId,
          `@batch=${batchId} PRIVMSG ${target} :${splitLine}`,
        );
      }
    }

    // End batch
    this.sendRaw(serverId, `BATCH -${batchId}`);
  }

  // Split long lines to respect IRC message length limits (512 bytes)
  private splitLongLine(text: string, maxLength = 450): string[] {
    if (!text) return [""];

    // Account for IRC overhead (PRIVMSG + target + formatting)
    // Conservative limit to account for formatting codes and IRC overhead
    const lines: string[] = [];
    let remaining = text;

    while (remaining.length > maxLength) {
      // Try to split at word boundaries
      let splitIndex = maxLength;
      const lastSpace = remaining.lastIndexOf(" ", maxLength);
      if (lastSpace > maxLength * 0.7) {
        // Don't split too early
        splitIndex = lastSpace;
      }

      lines.push(remaining.substring(0, splitIndex));
      remaining = remaining.substring(splitIndex).trim();
    }

    if (remaining) {
      lines.push(remaining);
    }

    return lines.length > 0 ? lines : [""];
  }

  sendTyping(serverId: string, target: string, isActive: boolean): void {
    // Same phantom-channel guard as sendMessage: if we're typing into
    // a channel whose local cache is empty (ircd doesn't actually
    // have us in it), JOIN first so the typing TAGMSG lands instead
    // of getting bounced with 401.
    const server = this.servers.get(serverId);
    if (server && isChannelTarget(target)) {
      const ch = server.channels.find((c) => c.name === target);
      if (
        ch &&
        !ch.isPrivate &&
        (ch.users?.length ?? 0) === 0 &&
        this.isCapNegotiationComplete(serverId)
      ) {
        this.sendRaw(serverId, `JOIN ${target}`);
      }
    }
    const typingState = isActive ? "active" : "done";
    this.sendRaw(serverId, `@+typing=${typingState} TAGMSG ${target}`);
  }

  sendRedact(
    serverId: string,
    target: string,
    msgid: string,
    reason?: string,
  ): void {
    const command = reason
      ? `REDACT ${target} ${msgid} :${reason}`
      : `REDACT ${target} ${msgid}`;
    this.sendRaw(serverId, command);
  }

  registerAccount(
    serverId: string,
    account: string,
    email: string,
    password: string,
  ): void {
    this.sendRaw(serverId, `REGISTER ${account} ${email} ${password}`);
  }

  verifyAccount(serverId: string, account: string, code: string): void {
    this.sendRaw(serverId, `VERIFY ${account} ${code}`);
  }

  listChannels(
    serverId: string,
    elist?: string,
    filters?: {
      minUsers?: number;
      maxUsers?: number;
      minCreationTime?: number; // minutes ago
      maxCreationTime?: number; // minutes ago
      minTopicTime?: number; // minutes ago
      maxTopicTime?: number; // minutes ago
      mask?: string;
      notMask?: string;
    },
  ): void {
    let command = "LIST";

    if (elist && filters) {
      // Build LIST parameters based on filters and available ELIST capabilities
      const elistTokens = elist.toUpperCase().split("");
      const params: string[] = [];

      // User count filtering (U extension)
      if (elistTokens.includes("U")) {
        if (filters.minUsers && filters.minUsers > 0) {
          params.push(`>${filters.minUsers}`);
        }
        if (filters.maxUsers && filters.maxUsers > 0) {
          params.push(`<${filters.maxUsers}`);
        }
      }

      // Creation time filtering (C extension)
      if (elistTokens.includes("C")) {
        if (filters.minCreationTime && filters.minCreationTime > 0) {
          params.push(`C>${filters.minCreationTime}`);
        }
        if (filters.maxCreationTime && filters.maxCreationTime > 0) {
          params.push(`C<${filters.maxCreationTime}`);
        }
      }

      // Topic time filtering (T extension)
      if (elistTokens.includes("T")) {
        if (filters.minTopicTime && filters.minTopicTime > 0) {
          params.push(`T>${filters.minTopicTime}`);
        }
        if (filters.maxTopicTime && filters.maxTopicTime > 0) {
          params.push(`T<${filters.maxTopicTime}`);
        }
      }

      // Mask filtering (M extension)
      if (elistTokens.includes("M") && filters.mask) {
        params.push(filters.mask);
      }

      // Non-matching mask filtering (N extension)
      if (elistTokens.includes("N") && filters.notMask) {
        params.push(`!${filters.notMask}`);
      }

      if (params.length > 0) {
        command = `LIST ${params.join(" ")}`;
      }
    }

    this.sendRaw(serverId, command);
  }

  renameChannel(
    serverId: string,
    oldName: string,
    newName: string,
    reason?: string,
  ): void {
    const command = reason
      ? `RENAME ${oldName} ${newName} :${reason}`
      : `RENAME ${oldName} ${newName}`;
    this.sendRaw(serverId, command);
  }

  setName(serverId: string, realname: string): void {
    this.sendRaw(serverId, `SETNAME :${realname}`);
  }

  changeNick(serverId: string, newNick: string): void {
    this.sendRaw(serverId, `NICK ${newNick}`);
  }

  // Metadata commands
  metadataGet(serverId: string, target: string, keys: string[]): void {
    const keysStr = keys.join(" ");
    this.sendRaw(serverId, `METADATA ${target} GET ${keysStr}`);
  }

  metadataList(serverId: string, target: string): void {
    this.sendRaw(serverId, `METADATA ${target} LIST`);
  }

  metadataSet(
    serverId: string,
    target: string,
    key: string,
    value?: string,
    visibility?: string,
  ): void {
    // Use the provided target. If it's "*" or the current user's nickname, use "*"
    // Otherwise use the provided target (for channels, other users if admin, etc.)
    const currentNick = this.getNick(serverId);
    const actualTarget =
      target === "*" || target === currentNick ? "*" : target;
    const command =
      value !== undefined && value !== ""
        ? `METADATA ${actualTarget} SET ${key} :${value}`
        : `METADATA ${actualTarget} SET ${key}`;
    this.sendRaw(serverId, command);
  }

  metadataClear(serverId: string, target: string): void {
    this.sendRaw(serverId, `METADATA ${target} CLEAR`);
  }

  metadataSub(serverId: string, keys: string[]): void {
    // Send individual SUB commands for each key to avoid parsing issues
    keys.forEach((key) => {
      const command = `METADATA * SUB ${key}`;
      this.sendRaw(serverId, command);
    });
  }

  metadataUnsub(serverId: string, keys: string[]): void {
    const keysStr = keys.join(" ");
    this.sendRaw(serverId, `METADATA * UNSUB ${keysStr}`);
  }

  metadataSubs(serverId: string): void {
    this.sendRaw(serverId, "METADATA * SUBS");
  }

  metadataSync(serverId: string, target: string): void {
    this.sendRaw(serverId, `METADATA ${target} SYNC`);
  }

  // soju.im/bouncer-networks commands. The attribute payload must
  // already be encoded with bouncerAttrs.encodeBouncerAttrs() to handle
  // the message-tag-style escapes for `;`, ` `, etc.
  bouncerListNetworks(serverId: string): void {
    this.sendRaw(serverId, "BOUNCER LISTNETWORKS");
  }
  // BIND must run before CAP END -- the bouncer ties this connection to
  // the upstream identified by netid for the rest of its lifetime.
  bouncerBind(serverId: string, netid: string): void {
    this.sendRaw(serverId, `BOUNCER BIND ${netid}`);
  }
  // Mark a server connection as a bouncer-child for the upcoming CAP
  // negotiation. The next sendCapEnd() will emit `BOUNCER BIND <netid>`
  // immediately before `CAP END`. Call this BEFORE the WS opens (or at
  // least before CAP LS arrives) so we never miss the bind window.
  setPendingBouncerBind(serverId: string, netid: string): void {
    this.pendingBouncerBind.set(serverId, netid);
  }
  // Centralised CAP END sender. All call sites should use this instead
  // of raw sendRaw("CAP END") so the BIND-before-end invariant is
  // enforced in one place.
  sendCapEnd(serverId: string): void {
    const netid = this.pendingBouncerBind.get(serverId);
    if (netid) {
      this.pendingBouncerBind.delete(serverId);
      this.sendRaw(serverId, `BOUNCER BIND ${netid}`);
    }
    this.sendRaw(serverId, "CAP END");
  }
  bouncerAddNetwork(serverId: string, encodedAttrs: string): void {
    this.sendRaw(serverId, `BOUNCER ADDNETWORK ${encodedAttrs}`);
  }
  bouncerChangeNetwork(
    serverId: string,
    netid: string,
    encodedAttrs: string,
  ): void {
    this.sendRaw(serverId, `BOUNCER CHANGENETWORK ${netid} ${encodedAttrs}`);
  }
  bouncerDelNetwork(serverId: string, netid: string): void {
    this.sendRaw(serverId, `BOUNCER DELNETWORK ${netid}`);
  }

  /**
   * IRCv3 draft/named-modes: send a mode change addressed by long-form
   * mode names instead of single letters.
   *
   * When the negotiated registry exposes a letter for every requested
   * name, we build a `MODE` line so the change works on legacy
   * (non-cap) servers too. When the cap is negotiated AND any item
   * has no letter equivalent (a name-only mode), we send a `PROP`
   * line, which is the only wire form that can carry such modes.
   *
   * `target` is a channel name or a nick. `items` is a list of
   * `{sign, name, param?}` triples. `registry` is the per-server
   * NamedModes object the caller already has from the store; passing
   * it in keeps this layer free of a store dependency.
   */
  sendNamedMode(
    serverId: string,
    target: string,
    items: Array<{ sign: "+" | "-"; name: string; param?: string }>,
    registry?: { supported: boolean } & {
      channelModes: Array<{ name: string; letter?: string }>;
      userModes: Array<{ name: string; letter?: string }>;
    },
  ): void {
    if (!items.length) return;

    const isChannelTarget =
      target.startsWith("#") ||
      target.startsWith("^") ||
      target.startsWith("$");
    const list = isChannelTarget
      ? (registry?.channelModes ?? [])
      : (registry?.userModes ?? []);

    // Decide which form to send. Prefer PROP when the cap is
    // negotiated AND any item is name-only (no letter); fall back to
    // MODE otherwise so legacy servers / clients in mixed deployments
    // keep working.
    const capSupported = !!registry?.supported;
    const anyNameOnly = items.some((it) => {
      const spec = list.find((m) => m.name === it.name);
      return !spec?.letter;
    });

    if (capSupported && anyNameOnly) {
      const tail = items
        .map((it) =>
          it.param !== undefined
            ? `${it.sign}${it.name}=${it.param}`
            : `${it.sign}${it.name}`,
        )
        .join(" ");
      this.sendRaw(serverId, `PROP ${target} ${tail}`);
      return;
    }

    // Build a MODE line. Drop any items that map to no letter (only
    // happens when the cap isn't negotiated; the user just can't
    // reach name-only modes on a legacy server).
    let modestring = "";
    const params: string[] = [];
    let lastSign: "+" | "-" | "" = "";
    for (const it of items) {
      const spec = list.find((m) => m.name === it.name);
      if (!spec?.letter) continue;
      if (it.sign !== lastSign) {
        modestring += it.sign;
        lastSign = it.sign;
      }
      modestring += spec.letter;
      if (it.param !== undefined) params.push(it.param);
    }
    if (!modestring) return;
    const cmd = params.length
      ? `MODE ${target} ${modestring} ${params.join(" ")}`
      : `MODE ${target} ${modestring}`;
    this.sendRaw(serverId, cmd);
  }

  // draft/authtoken: ask the server to mint a bearer token for `service`.
  // Server reply is `:server TOKEN GENERATE <service> <url> :<token>`.
  requestToken(serverId: string, service: string, scope?: string): void {
    const command = scope
      ? `TOKEN GENERATE ${service} ${scope}`
      : `TOKEN GENERATE ${service}`;
    this.sendRaw(serverId, command);
  }

  // draft/authtoken: list services the server can mint tokens for.
  requestTokenServiceList(serverId: string): void {
    this.sendRaw(serverId, "TOKEN SERVICELIST");
  }

  // EXTJWT commands
  requestExtJwt(serverId: string, target?: string, serviceName?: string): void {
    // EXTJWT ( <channel> | * ) [service_name]
    const targetParam = target ?? "*";
    const cmd = serviceName
      ? `EXTJWT ${targetParam} ${serviceName}`
      : `EXTJWT ${targetParam}`;
    this.sendRaw(serverId, cmd);
  }

  // draft/account-recovery: forgotten-password flow.
  recoverRequest(serverId: string, account: string): void {
    this.sendRaw(serverId, `RECOVER REQUEST ${account}`);
  }

  recoverConfirm(serverId: string, account: string, code: string): void {
    this.sendRaw(serverId, `RECOVER CONFIRM ${account} ${code}`);
  }

  // SETPASS lives in the same draft/account-recovery cap.  The new
  // password is sent as the IRC trailing parameter so it MAY contain
  // spaces (for passphrases).  No base64 -- the password is UTF-8.
  setpass(serverId: string, newPassword: string): void {
    this.sendRaw(serverId, `SETPASS :${newPassword}`);
  }

  // draft/persistence: read or set the per-account ghost-on-disconnect
  // preference.  Server responds with PERSISTENCE STATUS.
  persistenceGet(serverId: string): void {
    this.sendRaw(serverId, "PERSISTENCE GET");
  }

  persistenceSet(serverId: string, value: "ON" | "OFF" | "DEFAULT"): void {
    this.sendRaw(serverId, `PERSISTENCE SET ${value}`);
  }

  // draft/read-marker: ask the server for the stored marker for a
  // target.  Channels are auto-pushed on JOIN, so this is mostly used
  // when a PM buffer is opened for the first time.
  markreadGet(serverId: string, target: string): void {
    this.sendRaw(serverId, `MARKREAD ${target}`);
  }

  // draft/read-marker: tell the server the user has read up to
  // `timestamp` in `target`.  Server clamps to monotonically-increasing
  // values and replies with MARKREAD echoing whatever it stored.
  markreadSet(serverId: string, target: string, timestamp: string): void {
    this.sendRaw(serverId, `MARKREAD ${target} timestamp=${timestamp}`);
  }

  // MONITOR commands
  monitorAdd(serverId: string, targets: string[]): void {
    const targetsStr = targets.join(",");
    this.sendRaw(serverId, `MONITOR + ${targetsStr}`);
  }

  monitorRemove(serverId: string, targets: string[]): void {
    const targetsStr = targets.join(",");
    this.sendRaw(serverId, `MONITOR - ${targetsStr}`);
  }

  monitorClear(serverId: string): void {
    this.sendRaw(serverId, "MONITOR C");
  }

  monitorList(serverId: string): void {
    this.sendRaw(serverId, "MONITOR L");
  }

  monitorStatus(serverId: string): void {
    this.sendRaw(serverId, "MONITOR S");
  }

  setAway(serverId: string, message: string): void {
    this.sendRaw(serverId, `AWAY :${message}`);
  }

  clearAway(serverId: string): void {
    this.sendRaw(serverId, "AWAY");
  }

  markChannelAsRead(serverId: string, channelId: string): void {
    const server = this.servers.get(serverId);
    const channel = server?.channels.find((c) => c.id === channelId);
    if (channel) channel.unreadCount = 0;
  }

  capAck(serverId: string, key: string, capabilities: string): void {
    this.triggerEvent("CAP_ACKNOWLEDGED", { serverId, key, capabilities });
  }

  // Allow handlers (e.g. the OAuth path) to flip the SASL-pending flag
  // before onCapAck's auto-send-CAP-END check runs. Called from the
  // CAP_ACKNOWLEDGED listener that initiates AUTHENTICATE IRCV3BEARER.
  setSaslEnabled(serverId: string, enabled: boolean): void {
    this.saslEnabled.set(serverId, enabled);
  }

  capEnd(_serverId: string) {}

  isCapNegotiationComplete(serverId: string): boolean {
    return this.capNegotiationComplete.get(serverId) ?? false;
  }

  getSaslMechanisms(serverId: string): string[] {
    return this.saslMechanisms.get(serverId) ?? [];
  }

  getNick(serverId: string): string | undefined {
    return this.nicks.get(serverId);
  }

  getMyIdent(serverId: string): string | undefined {
    return this.myIdents.get(serverId);
  }

  getMyHost(serverId: string): string | undefined {
    return this.myHosts.get(serverId);
  }

  userOnConnect(serverId: string) {
    const nickname = this.nicks.get(serverId);
    if (!nickname) {
      console.error(`No nickname found for serverId ${serverId}`);
      return;
    }
    // NICK is already sent before CAP negotiation, only send USER now
    this.sendRaw(serverId, `USER ${nickname} 0 * :${nickname}`);
  }

  private handleMessage(data: string, serverId: string): void {
    const lines = data.split("\r\n");
    for (let line of lines) {
      let mtags: Record<string, string> | undefined;
      let source: string;
      const parv: string[] = [];
      let i = 0;
      let l: string[];
      line = line.trim();

      // Skip empty lines
      if (!line) continue;

      // Handle message tags first, before splitting on trailing parameter
      let lineAfterTags = line;
      if (line[0] === "@") {
        const spaceIndex = line.indexOf(" ");
        if (spaceIndex !== -1) {
          mtags = parseMessageTags(line.substring(0, spaceIndex));
          lineAfterTags = line.substring(spaceIndex + 1);
        }
      }

      // Parse IRC message properly handling colon-prefixed trailing parameter
      const spaceIndex = lineAfterTags.indexOf(" :");
      let trailing = "";
      let mainPart = lineAfterTags;

      if (spaceIndex !== -1) {
        trailing = lineAfterTags.substring(spaceIndex + 2); // Skip ' :'
        mainPart = lineAfterTags.substring(0, spaceIndex);
      }

      l = mainPart.split(" ").filter((part) => part.length > 0);

      // Ensure we have at least one element
      if (l.length === 0) continue;

      // Determine the source. if none, spoof as host server
      if (l[i][0] !== ":") {
        const thisServ = this.servers.get(serverId);
        const thisServName = thisServ?.name;
        if (!thisServName) {
          continue;
        }
        source = thisServName;
      } else {
        source = l[i].substring(1);
        i++;
      }

      const command = l[i];
      for (i++; l[i]; i++) {
        parv.push(l[i]);
      }

      // Add trailing parameter if it exists
      if (trailing) {
        parv.push(trailing);
      }

      const handler = IRC_DISPATCH[command];
      if (handler) {
        handler(this, serverId, source, parv, mtags, trailing);
      }
    }
  }

  onCapLs(serverId: string, cliCaps: string, isFinal: boolean): void {
    let accumulated = this.capLsAccumulated.get(serverId);
    if (!accumulated) {
      accumulated = new Set();
      this.capLsAccumulated.set(serverId, accumulated);
    }

    const caps = cliCaps.split(" ");
    for (const c of caps) {
      const [cap, value] = c.split("=", 2);
      accumulated.add(cap);
      if (cap === "sasl" && value) {
        const mechanisms = value.split(",");
        this.saslMechanisms.set(serverId, mechanisms);
      }
      // Handle informational unrealircd.org/link-security capability
      if (cap === "unrealircd.org/link-security" && value) {
        const linkSecurityValue = Number.parseInt(value, 10) || 0;
        // Trigger event with the link security value so the store can handle it
        this.triggerEvent("CAP LS", {
          serverId,
          cliCaps: `unrealircd.org/link-security=${linkSecurityValue}`,
        });
      }
    }

    if (isFinal) {
      // Now request the caps we want from the accumulated list
      const capsToRequest: string[] = [];
      const saslEnabled = this.saslEnabled.get(serverId) ?? false;
      for (const cap of accumulated) {
        if (
          (this.ourCaps.includes(cap) || cap.startsWith("draft/metadata")) &&
          (cap !== "sasl" || saslEnabled)
        ) {
          capsToRequest.push(cap);
        }
      }

      if (capsToRequest.length > 0) {
        // Send capabilities in batches to avoid IRC line length limits (512 bytes)
        let currentBatch: string[] = [];
        const baseLength = "CAP REQ :".length + 2; // +2 for \r\n
        let currentLength = baseLength;
        let batchCount = 0;

        for (const cap of capsToRequest) {
          const capLength = cap.length + (currentBatch.length > 0 ? 1 : 0); // +1 for space if not first

          if (currentLength + capLength > 500 && currentBatch.length > 0) {
            // Leave some margin
            // Send current batch
            const reqMessage = `CAP REQ :${currentBatch.join(" ")}`;
            this.sendRaw(serverId, reqMessage);
            batchCount++;
            currentBatch = [];
            currentLength = baseLength;
          }

          currentBatch.push(cap);
          currentLength += capLength;
        }

        // Send remaining batch
        if (currentBatch.length > 0) {
          const reqMessage = `CAP REQ :${currentBatch.join(" ")}`;
          this.sendRaw(serverId, reqMessage);
          batchCount++;
        }

        // Track how many CAP REQ batches we sent
        this.pendingCapReqs.set(serverId, batchCount);

        // Set a timeout to send CAP END if server doesn't respond
        setTimeout(() => {
          if (this.pendingCapReqs.has(serverId)) {
            this.pendingCapReqs.delete(serverId);

            // Check if SASL is in progress before timing out
            const saslEnabled = this.saslEnabled.get(serverId) ?? false;
            const server = this.servers.get(serverId);
            const saslAcknowledged =
              server?.capabilities?.includes("sasl") ?? false;

            if (saslEnabled && saslAcknowledged) {
              console.log(
                `[CAP TIMEOUT] SASL in progress for ${serverId}, not timing out CAP negotiation`,
              );
              // Don't send CAP END - let SASL complete naturally
            } else {
              // No SASL in progress - safe to timeout
              console.log(
                `[CAP TIMEOUT] Timeout reached for ${serverId}, ending CAP negotiation`,
              );
              this.sendCapEnd(serverId);
              this.capNegotiationComplete.set(serverId, true);
              this.userOnConnect(serverId);
            }
          }
        }, 5000); // 5 second timeout

        if (capsToRequest.includes("draft/extended-isupport")) {
          this.sendRaw(serverId, "ISUPPORT");
        }
      } else {
        // No capabilities to request, end CAP negotiation immediately
        console.log(
          `[CAP LS] No capabilities to request for ${serverId}, ending CAP negotiation`,
        );
        this.sendCapEnd(serverId);
        this.capNegotiationComplete.set(serverId, true);
        this.userOnConnect(serverId);
      }
      // Clean up
      this.capLsAccumulated.delete(serverId);
    }
  }

  onCapNew(serverId: string, cliCaps: string): void {
    const caps = cliCaps.split(" ");
    for (const c of caps) {
      const [cap, value] = c.split("=", 2);
      if (cap === "sasl" && value) {
        const mechanisms = value.split(",");
        this.saslMechanisms.set(serverId, mechanisms);
        // If sasl becomes available, perhaps request it if not already
        // But for now, just log
      }
    }
  }

  onCapDel(serverId: string, cliCaps: string): void {
    const caps = cliCaps.split(" ");
    for (const c of caps) {
      const [cap] = c.split("=", 2);
      if (cap === "sasl") {
        this.saslMechanisms.delete(serverId);
      }
    }
  }

  onCapAck(serverId: string, cliCaps: string): void {
    // Trigger the original event for compatibility
    this.triggerEvent("CAP ACK", { serverId, cliCaps });

    // Store the acknowledged capabilities
    const server = this.servers.get(serverId);
    if (server) {
      const caps = cliCaps.split(" ");
      if (!server.capabilities) {
        server.capabilities = [];
      }
      for (const cap of caps) {
        if (!server.capabilities.includes(cap)) {
          server.capabilities.push(cap);
        }
      }
    }

    // Decrement pending CAP REQ count
    const pendingCount = this.pendingCapReqs.get(serverId) || 0;
    if (pendingCount > 0) {
      const newCount = pendingCount - 1;

      if (newCount === 0) {
        // All CAP REQ batches acknowledged
        this.pendingCapReqs.delete(serverId);

        // Check if SASL is enabled and was acknowledged
        const saslEnabled = this.saslEnabled.get(serverId) ?? false;
        const saslAcknowledged =
          server?.capabilities?.includes("sasl") ?? false;

        if (saslEnabled && saslAcknowledged) {
          // SASL is enabled and was acknowledged - wait for SASL authentication to complete
          // The SASL completion handlers (903/904-907) will send CAP END
          console.log(
            `[CAP ACK] SASL enabled for ${serverId}, waiting for SASL authentication`,
          );
        } else {
          // No SASL or SASL not acknowledged - complete CAP negotiation now
          this.sendCapEnd(serverId);
          this.capNegotiationComplete.set(serverId, true);
          this.userOnConnect(serverId);
        }
      } else {
        this.pendingCapReqs.set(serverId, newCount);
      }
    } else {
      console.log(
        `[CAP ACK] Received unexpected CAP ACK for ${serverId} (no pending requests)`,
      );
    }
  }

  on<K extends EventKey>(event: K, callback: EventCallback<K>): void {
    if (!this.eventCallbacks[event]) {
      this.eventCallbacks[event] = [];
    }
    this.eventCallbacks[event]?.push(callback);
  }

  deleteHook<K extends EventKey>(event: K, callback: EventCallback<K>): void {
    const cbs = this.eventCallbacks[event];
    if (!cbs) return;
    const index = cbs.indexOf(callback);
    if (index !== -1) {
      cbs.splice(index, 1);
    }
  }

  triggerEvent<K extends EventKey>(event: K, data: EventMap[K]): void {
    const cbs = this.eventCallbacks[event];
    if (!cbs) return;
    for (const cb of cbs) {
      cb(data);
    }
  }

  getServers(): Server[] {
    return Array.from(this.servers.values());
  }

  getCurrentUser(serverId?: string): User | null {
    // If no serverId provided, return null (we need server context now)
    if (!serverId) return null;
    return this.currentUsers.get(serverId) || null;
  }

  hasCapability(serverId: string, cap: string): boolean {
    return this.servers.get(serverId)?.capabilities?.includes(cap) ?? false;
  }

  getBatchType(serverId: string, batchId: string): string | undefined {
    return this.activeBatches.get(serverId)?.get(batchId)?.type;
  }

  getAllUsers(serverId: string): User[] {
    const server = this.servers.get(serverId);
    if (!server) return [];

    const allUsers = new Map<string, User>();

    // Collect users from all joined channels
    for (const channel of server.channels) {
      for (const user of channel.users) {
        allUsers.set(user.username, user);
      }
    }

    return Array.from(allUsers.values());
  }

  wakeReconnect(serverId: string): void {
    const now = Date.now();
    const last = this.lastWakeReconnect.get(serverId) ?? 0;
    if (now - last < 5000) return;
    this.lastWakeReconnect.set(serverId, now);

    const server = this.servers.get(serverId);
    if (!server) return;

    const params = this.serverConnectParams.get(serverId);
    if (!params) return;

    if (server.connectionState === "reconnecting") {
      // Already reconnecting but may be stuck in a long backoff (e.g. after many
      // failed attempts while sleeping). Cancel the pending timeout and retry now.
      const existingTimeout = this.reconnectionTimeouts.get(serverId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        this.reconnectionTimeouts.delete(serverId);
      }
      this.reconnectionAttempts.set(serverId, 0);
      this.attemptReconnection(
        serverId,
        params.name,
        params.host,
        params.port,
        params.nickname,
        params.password,
        params.saslAccountName,
        params.saslPassword,
      );
      return;
    }

    if (server.connectionState === "disconnected") {
      // Socket already gone; kick the reconnection loop immediately.
      this.reconnectionAttempts.set(serverId, 0);
      this.startReconnection(
        serverId,
        params.name,
        params.host,
        params.port,
        params.nickname,
        params.password,
        params.saslAccountName,
        params.saslPassword,
      );
      return;
    }

    // connectionState === "connected" or "connecting": leave it alone.
    // The existing ping/pong mechanism will detect a dead socket within ~40s
    // and kick the normal reconnection flow.
  }
}
