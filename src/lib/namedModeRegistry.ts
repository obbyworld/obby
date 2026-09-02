// Curated metadata for IRCv3 draft/named-modes channel-mode names.
//
// The server's RPL_CHMODELIST advertises a long-form name for every
// chanmode; we map the ones we know about onto a proper UI label, a
// description, and (for param modes) a placeholder so the Advanced
// tab in ChannelSettingsModal can render a useful row.
//
// Anything not in this table falls back to humanizeNamedMode() in
// ircUtils.tsx (auto-derived label, no description, generic input).
//
// Sources for copy:
//   - tooltips from the legacy hardcoded Advanced tab
//   - UnrealIRCd docs:
//       https://www.unrealircd.org/docs/Channel_Modes
//       https://www.unrealircd.org/docs/Channel_anti-flood_settings
//   - draft/named-modes spec table for the unprefixed standard names

export type NamedModeGroup =
  | "filtering" // color/CTCP/bad-words/strip etc.
  | "behavior" // delay-joins, nokick, no-knocks, ...
  | "access" // regonly, operonly, secureonly, ...
  | "properties" // permanent, private, history, link, ...
  | "flood"; // floodprot, floodprot-profile

export interface NamedModeMeta {
  /** Label shown to the user. Curated, not auto-derived. */
  label: string;
  /** One-line description, plain text. */
  description: string;
  /** Section the row should live under in the UI. */
  group: NamedModeGroup;
  /** For param modes: placeholder shown in the input. */
  paramPlaceholder?: string;
  /** Hide from the Advanced tab. Used for:
   *   - modes covered by other tabs (ban / op / limit / etc.)
   *   - server-managed auto-set modes the user can't usefully toggle
   *     (issecure, isregistered, delayjoin-rejoinhide) */
  hidden?: boolean;
}

/** Metadata keyed by the IRCv3 named-modes name (vendor prefix
 *  included for non-spec modes). */
export const NAMED_MODE_META: Record<string, NamedModeMeta> = {
  // ---- Spec-table standard chanmodes covered by other tabs ----
  ban: { label: "Ban", description: "", group: "access", hidden: true },
  banex: {
    label: "Ban Exception",
    description: "",
    group: "access",
    hidden: true,
  },
  invex: {
    label: "Invite Exception",
    description: "",
    group: "access",
    hidden: true,
  },
  op: { label: "Op", description: "", group: "access", hidden: true },
  voice: { label: "Voice", description: "", group: "access", hidden: true },
  halfop: { label: "Halfop", description: "", group: "access", hidden: true },
  owner: { label: "Owner", description: "", group: "access", hidden: true },
  admin: { label: "Admin", description: "", group: "access", hidden: true },
  inviteonly: {
    label: "Invite-Only",
    description: "",
    group: "access",
    hidden: true,
  },
  key: { label: "Key", description: "", group: "access", hidden: true },
  limit: {
    label: "User Limit",
    description: "",
    group: "properties",
    hidden: true,
  },
  moderated: {
    label: "Moderated",
    description: "",
    group: "properties",
    hidden: true,
  },
  noextmsg: {
    label: "No External Messages",
    description: "",
    group: "behavior",
    hidden: true,
  },
  secret: {
    label: "Secret",
    description: "",
    group: "properties",
    hidden: true,
  },
  topiclock: {
    label: "Protected Topic",
    description: "",
    group: "properties",
    hidden: true,
  },

  // ---- Spec-table modes shown in Advanced ----
  private: {
    label: "Private Channel",
    description: "Channel is marked as private.",
    group: "properties",
  },
  permanent: {
    label: "Permanent Channel",
    description:
      "Channel persists when empty (settable by IRC operators only).",
    group: "properties",
  },
  regonly: {
    label: "Registered Users Only",
    description: "Only logged-in (registered) users may join.",
    group: "access",
  },
  secureonly: {
    label: "Secure Connection Required",
    description: "Only clients connected with TLS/SSL may join.",
    group: "access",
  },
  noctcp: {
    label: "Block CTCPs",
    description:
      "Drop CTCP messages other than ACTION (/me) sent to the channel.",
    group: "filtering",
  },

  // ---- Obby / UnrealIRCd-family chanmodes ----
  "obsidianirc/floodprot": {
    label: "Flood Protection",
    description:
      "Per-channel anti-flood rules. Format: [N1c1[#action[Ntime]],...]:seconds. Use the Configure button on the legacy view if you're not sure.",
    paramPlaceholder: "[10j#R30,5m]:30",
    group: "flood",
  },
  "obsidianirc/floodprot-profile": {
    label: "Flood Profile",
    description:
      "Built-in flood profile. Use one of: very-strict, strict, normal, relaxed, very-relaxed.",
    paramPlaceholder: "normal",
    group: "flood",
  },
  "obsidianirc/nocolor": {
    label: "Block Color Codes",
    description: "Reject messages that contain mIRC color codes.",
    group: "filtering",
  },
  "obsidianirc/stripcolor": {
    label: "Strip Color Codes",
    description:
      "Silently strip color codes from messages instead of dropping them.",
    group: "filtering",
  },
  "obsidianirc/censor": {
    label: "Filter Bad Words",
    description:
      "Replace configured bad words with <censored> in messages sent to the channel.",
    group: "filtering",
  },

  "obsidianirc/delayjoin": {
    label: "Delay Joins",
    description:
      "Hide joins until the user speaks. Useful in busy channels to suppress noise.",
    group: "behavior",
  },
  "obsidianirc/noknock": {
    label: "No Knocks",
    description: "/KNOCK is not accepted on this channel.",
    group: "behavior",
  },
  "obsidianirc/nonickchange": {
    label: "No Nick Changes",
    description: "Members may not change their nickname while in the channel.",
    group: "behavior",
  },
  "obsidianirc/nokick": {
    label: "No Kicks",
    description: "/KICK is disabled in the channel.",
    group: "behavior",
  },
  "obsidianirc/nonotice": {
    label: "No Notices",
    description: "/NOTICE to the channel is rejected.",
    group: "behavior",
  },
  "obsidianirc/noinvite": {
    label: "No Invites",
    description: "/INVITE is not accepted for this channel.",
    group: "behavior",
  },

  "obsidianirc/regonlyspeak": {
    label: "Registered Nicks Speak Only",
    description:
      "Only users on a registered nickname can send to the channel. Unregistered users can still join.",
    group: "access",
  },
  "obsidianirc/operonly": {
    label: "IRC Operator Only",
    description:
      "Only IRC operators may join (settable by IRC operators only).",
    group: "access",
  },

  "obsidianirc/history": {
    label: "Channel History",
    description:
      "Record channel history. Format: max-lines:max-time (e.g. 100:1d for 100 lines or 1 day).",
    paramPlaceholder: "100:1d",
    group: "properties",
  },
  "obsidianirc/link": {
    label: "Channel Link",
    description:
      "Forward users to this channel if they can't join (e.g. due to ban/limit/key).",
    paramPlaceholder: "#overflow",
    group: "properties",
  },

  // ---- Auto-managed modes hidden from the UI ----
  "obsidianirc/issecure": {
    label: "Channel Is Secure",
    description: "",
    group: "access",
    hidden: true, // server sets/clears automatically based on members
  },
  "obsidianirc/isregistered": {
    label: "Channel Is Registered",
    description: "",
    group: "properties",
    hidden: true, // services-managed
  },
  "obsidianirc/delayjoin-rejoinhide": {
    label: "Delayjoin (auto-managed)",
    description: "",
    group: "behavior",
    hidden: true, // auto-set/cleared by +D logic
  },
};

/** Look up a curated entry. Returns undefined for unknown names —
 *  callers should fall back to humanizeNamedMode for the label and
 *  show no description. */
export function lookupNamedModeMeta(name: string): NamedModeMeta | undefined {
  return NAMED_MODE_META[name];
}

/** Stable sort order for sections in the Advanced tab. */
export const NAMED_MODE_GROUP_ORDER: NamedModeGroup[] = [
  "flood",
  "filtering",
  "behavior",
  "access",
  "properties",
];

export const NAMED_MODE_GROUP_LABELS: Record<NamedModeGroup, string> = {
  flood: "Flood Protection",
  filtering: "Content Filtering",
  behavior: "Channel Behavior",
  access: "Access Control",
  properties: "Channel Properties",
};
