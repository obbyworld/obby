export interface User {
  id: string;
  username: string;
  hostname?: string; // User's hostname from WHO or CHGHOST
  realname?: string; // User's real name/gecos field from WHO
  avatar?: string;
  displayName?: string;
  account?: string;
  isOnline: boolean;
  isAway?: boolean; // Whether user is marked as away (from WHO flags or AWAY notify)
  awayMessage?: string; // Away message if user is away
  status?: string;
  isBot?: boolean; // Bot detection from WHO response
  isIrcOp?: boolean; // IRC operator status from WHO response (* flag)
  modes?: string; // User modes (e.g., "o" for operator)
  metadata?: Record<string, { value: string | undefined; visibility: string }>;
}

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

// soju.im/bouncer-networks: one upstream network advertised by a bouncer.
// `attributes` is the decoded `name=…;host=…;state=…` payload; treat it
// as a free-form map -- only the entries listed in
// BOUNCER_STANDARD_ATTRIBUTES are guaranteed to mean what the spec says
// they mean.
export interface BouncerNetwork {
  netid: string;
  attributes: Record<string, string>;
}

// State for one bouncer "control" connection -- the WS session that did
// CAP REQ soju.im/bouncer-networks. Child connections (one per upstream
// network the user is actively viewing) live in `Server`s as usual; PR B
// will link them back here via a parent reference.
export interface BouncerState {
  // serverId of the control connection in `state.servers`.
  serverId: string;
  // True once we've seen the cap in CAP ACK.
  supported: boolean;
  // True if soju.im/bouncer-networks-notify is also acked (the bouncer
  // will push initial list + live updates without us asking).
  notifyEnabled: boolean;
  // BOUNCER_NETID ISUPPORT token: the netid this *connection* is bound
  // to via BOUNCER BIND, if any. Empty/absent means this is a control
  // connection (no upstream selected).
  boundNetid?: string;
  // Latest known network list, keyed by netid.
  networks: Record<string, BouncerNetwork>;
  // True once the LISTNETWORKS batch has closed (or the notify-driven
  // initial dump has finished). UI uses this to switch from "loading"
  // to "empty / list" states.
  listed: boolean;
  // Most recent error from this bouncer (UI toasts it then clears).
  lastError?: {
    code: string;
    subcommand: string;
    description: string;
    attribute?: string;
    netid?: string;
  };
}

export interface Server {
  id: string;
  name: string;
  networkName?: string; // Network name from ISUPPORT NETWORK token
  // soju.im/bouncer-networks linkage:
  //   `bouncerServerId` — set on a child connection; points back to the
  //     control connection's server id.
  //   `bouncerNetid` — the upstream `netid` this connection bound to
  //     via BOUNCER BIND before CAP END.
  //   `isBouncerControl` — true on the parent control connection (the
  //     one that did CAP REQ soju.im/bouncer-networks without binding).
  bouncerServerId?: string;
  bouncerNetid?: string;
  isBouncerControl?: boolean;
  host: string;
  port: number;
  channels: Channel[];
  privateChats: PrivateChat[];
  icon?: string;
  isConnected: boolean;
  connectionState?: ConnectionState;
  isAway?: boolean; // Whether we are marked as away on this server
  awayMessage?: string; // Our away message on this server
  users: User[];
  capabilities?: string[];
  // Per-cap value strings as advertised in CAP LS (e.g.
  // "draft/account-2fa" -> "totp,webauthn,oauth", "sasl" ->
  // "PLAIN,EXTERNAL"). CAP ACK only echoes names so the value list
  // lives here and is consulted by UI that needs to know which
  // sub-features the server actually supports.
  capabilityValues?: Record<string, string>;
  metadata?: Record<string, { value: string | undefined; visibility: string }>;
  prefix?: string;
  chanmodes?: string; // CHANMODES ISUPPORT value defining mode groups A,B,C,D
  botMode?: string;
  filehost?: string;
  linkSecurity?: number; // Link security level from unrealircd.org/link-security
  jwtToken?: string; // JWT token for filehost authentication (from EXTJWT)
  // Bearer token from draft/authtoken (TOKEN GENERATE).  Used as the
  // `Authorization: Bearer <token>` header for the per-network filehost.
  authToken?: string;
  // URL the token is bound to (returned alongside the token).  Falls
  // back to `filehost` for older servers.
  authTokenUrl?: string;
  // Service the token was minted for, e.g. "filehost".
  authTokenService?: string;
  isUnrealIRCd?: boolean; // Whether this server is running UnrealIRCd
  elist?: string; // ELIST ISUPPORT value for extended LIST capabilities
  // IRCv3 draft/named-modes: server-advertised long-form mode names.
  // Populated from RPL_CHMODELIST (964) / RPL_UMODELIST (965) at
  // connect time; consumed by the mode-rendering paths so MODE +o /
  // PROP +op stay interchangeable in the UI.
  namedModes?: NamedModes;
  // draft/EMOJI ISUPPORT: URL to the network-wide pack document.
  emojiPackUrl?: string;
  // draft/persistence state (populated from PERSISTENCE STATUS replies).
  // `preference` is what the user has explicitly set on this account
  // (ON/OFF) or DEFAULT meaning "follow the server-wide default".
  // `effective` is what the server is actually doing right now.
  persistencePreference?: "ON" | "OFF" | "DEFAULT";
  persistenceEffective?: "ON" | "OFF";
  myIdent?: string; // Our own ident on this server (draft/whoami SETNAME burst or CHGHOST)
  myHost?: string; // Our own hostname on this server (draft/whoami SETNAME burst or CHGHOST)
  // obsidianirc/cmdslist: lowercase set of commands this user can
  // currently invoke on this server.  Used to drive the slash-command
  // suggestion popover.  undefined = the cap is not negotiated.
  cmdsAvailable?: string[];
}

export interface NamedModeSpec {
  /** Spec type: 1=list, 2=param-set+unset, 3=param-set, 4=flag, 5=prefix. */
  type: 1 | 2 | 3 | 4 | 5;
  /** IRCv3 long-form name, e.g. "op", "topiclock", "obsidianirc/floodprot". */
  name: string;
  /** Legacy MODE letter (omitted for name-only modes). */
  letter?: string;
}

export interface NamedModes {
  /** Capability negotiated with server; if false, registry is empty. */
  supported: boolean;
  channelModes: NamedModeSpec[];
  userModes: NamedModeSpec[];
}

export interface ServerConfig {
  id: string;
  name?: string;
  host: string;
  port: number;
  nickname: string;
  password?: string | undefined;
  channels: string[];
  saslAccountName?: string;
  saslPassword?: string;
  saslEnabled: boolean;
  // "auto" prefers SCRAM-SHA-256 when the server advertises it and falls
  // back to PLAIN, "webauthn" uses DRAFT-WEBAUTHN-BIO directly.
  saslMechanism?:
    | "auto"
    | "PLAIN"
    | "SCRAM-SHA-256"
    | "DRAFT-WEBAUTHN-BIO"
    | "EXTERNAL";
  skipLinkSecurityWarning?: boolean;
  skipLocalhostWarning?: boolean;
  operUsername?: string;
  operPassword?: string;
  operOnConnect?: boolean;
  addedAt?: number; // Timestamp when server was added (ms since epoch)
  oauth?: ServerOAuthConfig;
  // soju.im/bouncer-networks: persisted form of the parent/child link
  // so child connections re-bind to their upstream automatically after
  // a page reload.
  bouncerServerId?: string;
  bouncerNetid?: string;
  isBouncerControl?: boolean;
}

export interface ServerOAuthConfig {
  enabled: boolean;
  providerLabel: string;
  issuer: string;
  clientId: string;
  scopes?: string;
  redirectUri?: string;
  accessToken?: string;
  idToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
  // "jwt" (default): the IRC server validates the bearer locally against
  // its JWKS. The client sends idToken (preferred) or accessToken,
  // whichever is a JWT. Works for Logto, Auth0, Keycloak, Okta, Google
  // (id_token), Microsoft (id_token).
  // "opaque": the IRC server hits the IdP's userinfo endpoint to resolve
  // the bearer. The client sends accessToken plus a `serverProvider`
  // hint so the server knows which oauth-provider {} block to consult.
  // Required for GitHub, Discord, Slack, Reddit, Twitter.
  tokenKind?: "jwt" | "opaque";
  // Name the IRC server admin gave to the matching oauth-provider {}
  // block. Sent as the IRCV3BEARER authzid (or OAUTHBEARER `provider=`
  // k/v) in opaque mode so the server can pick the right userinfo URL.
  serverProvider?: string;
  // Manual auth/token endpoint overrides for non-OIDC providers like
  // GitHub that don't publish a /.well-known/openid-configuration.
  // When both are set, OIDC discovery is skipped.
  authorizeEndpoint?: string;
  tokenEndpoint?: string;
}

export interface Channel {
  id: string;
  name: string;
  topic?: string;
  isPrivate: boolean;
  serverId: string;
  unreadCount: number;
  // Number of *highlight* events since the channel was last marked
  // read.  Distinct from unreadCount (every message) so the badge
  // can show "you were pinged 3 times" instead of "33 messages
  // happened since your first ping".
  mentionCount?: number;
  isMentioned: boolean;
  messages: Message[];
  users: User[];
  isRead?: boolean;
  isLoadingHistory?: boolean;
  needsWhoRequest?: boolean;
  chathistoryRequested?: boolean;
  hasMoreHistory?: boolean;
  metadata?: Record<string, { value: string | undefined; visibility: string }>;
  modes?: string;
  modeArgs?: string[];
  bans?: Array<{ mask: string; setter: string; timestamp: number }>;
  invites?: Array<{ mask: string; setter: string; timestamp: number }>;
  exceptions?: Array<{ mask: string; setter: string; timestamp: number }>;
  // draft/read-marker: ISO-8601 timestamp of the latest message the
  // user has marked as read in this channel (mirrored across all of
  // the user's connected sessions).  null = no marker on file yet.
  readMarker?: string | null;
}

export interface PrivateChat {
  id: string;
  username: string;
  serverId: string;
  unreadCount: number;
  // Highlight counter (PMs always count as mentions; this is per-PM).
  mentionCount?: number;
  isMentioned: boolean;
  lastActivity?: Date;
  isPinned?: boolean;
  order?: number;
  isOnline?: boolean; // Tracked via MONITOR
  isAway?: boolean; // Tracked via extended-monitor + away-notify
  awayMessage?: string; // Away message from extended-monitor
  realname?: string; // Realname/gecos from WHO or extended-join
  account?: string; // Account name from WHOX
  isBot?: boolean; // Bot status from WHO/WHOX or message tags
  isIrcOp?: boolean; // IRC operator status from WHO response (* flag)
  metadata?: Record<string, { value: string | undefined; visibility: string }>;
  // draft/read-marker: see Channel.readMarker.
  readMarker?: string | null;
  // draft/read-marker: have we issued an initial MARKREAD GET for this
  // PM yet?  PMs are not auto-pushed by the server, so we need to
  // explicitly fetch on first open.
  readMarkerFetched?: boolean;
}

export interface Reaction {
  emoji: string;
  userId: string;
}

export interface Message {
  id: string;
  msgid?: string; // IRC message ID from IRCv3 message-ids capability
  multilineMessageIds?: string[]; // For multiline messages: all message IDs that make up this message
  type:
    | "message"
    | "system"
    | "error"
    | "join"
    | "part"
    | "quit"
    | "kick"
    | "nick"
    | "leave"
    | "standard-reply"
    | "notice"
    | "netsplit"
    | "netjoin"
    | "mode"
    | "invite";
  content: string;
  timestamp: Date;
  userId: string;
  channelId: string;
  serverId: string;
  reactions: Reaction[];
  replyMessage: Message | null;
  mentioned: string[];
  tags?: Record<string, string>;
  // Whisper fields (for draft/channel-context)
  whisperTarget?: string; // The recipient of a whisper
  // Standard reply fields. `command`, `code`, and `context` are
  // computer-readable; only `message` is intended for human display.
  standardReplyType?: "FAIL" | "WARN" | "NOTE";
  standardReplyCommand?: string;
  standardReplyCode?: string;
  standardReplyTarget?: string;
  standardReplyContext?: string[];
  standardReplyMessage?: string;
  // Batch-related fields for netsplit/netjoin
  batchId?: string;
  quitUsers?: string[];
  server1?: string;
  server2?: string;
  // Invite fields
  inviteChannel?: string; // The channel being invited to
  inviteTarget?: string; // Who is being invited
  // Link preview fields
  linkPreviewUrl?: string;
  linkPreviewTitle?: string;
  linkPreviewSnippet?: string;
  linkPreviewMeta?: string; // URL to preview image/thumbnail
  // JSON log data for server notices
  jsonLogData?: JsonValue;
  // True when the message was replayed from chathistory (not a live event)
  fromHistory?: boolean;
  // labeled-response: when the user sends a message with the
  // labeled-response cap acked, we insert a local placeholder
  // immediately and wait for the server's echo to match it back.
  // `pendingLabel` is the label tag value we attached on send, set
  // only on the local placeholder until the echo arrives.
  pendingLabel?: string;
  // labeled-response: lifecycle state of an outgoing message.
  // - "pending": placeholder awaiting server echo
  // - "failed": no echo / FAIL arrived in the timeout window
  // undefined => normal received message (no pending lifecycle).
  status?: "pending" | "failed";
}

// Alias for backwards compatibility
export type MessageType = Message;

export interface SocketResponse {
  event: string;
  data: unknown;
  error?: string;
}

export interface CommandResponse {
  success: boolean;
  message: string;
  data?: unknown;
}

export type CommandHandler = (
  args: string[],
  channel: Channel,
  server: Server,
) => CommandResponse;

export interface Command {
  name: string;
  description: string;
  usage: string;
  handler: CommandHandler;
}

export type ISupportEvent = {
  serverId: string;
  capabilities: string[];
};

export type MessageTag = {
  key: string;
  value?: string;
};

// Base event interface that all IRC events extend
export interface BaseIRCEvent {
  serverId: string;
}

// Events that include message tags
export interface EventWithTags extends BaseIRCEvent {
  mtags: Record<string, string> | undefined;
}

// Base metadata event interface
export interface BaseMetadataEvent extends BaseIRCEvent {
  target: string;
  key: string;
}

// Metadata event with visibility and value
export interface MetadataValueEvent extends BaseMetadataEvent {
  visibility: string;
  value: string;
}

// Base message event interface
export interface BaseMessageEvent extends EventWithTags {
  sender: string;
  message: string;
  timestamp: Date;
}

// Base user action event interface
export interface BaseUserActionEvent extends BaseIRCEvent {
  username: string;
}

// JSON value type for handling arbitrary JSON data
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[];

export interface WhoisData {
  nick: string;
  username?: string;
  host?: string;
  realname?: string;
  server?: string;
  serverInfo?: string;
  idle?: number;
  signon?: number;
  channels?: string;
  account?: string;
  specialMessages: string[]; // For 320, 378, 379 responses
  secureConnection?: string;
  timestamp: number; // When this data was fetched
  isComplete?: boolean; // Whether we've received WHOIS_END (318)
}
