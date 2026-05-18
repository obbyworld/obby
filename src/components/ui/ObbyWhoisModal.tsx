/**
 * ObbyWhoisModal
 *
 * Profile / WHOIS view that consumes the obby.world/whois batch shape:
 * account-level fields are taken from the parent obby.world/whois batch
 * numerics, while per-session detail comes from the nested
 * obby.world/whois-session sub-batches (idle, host, IP, TLS, certfp,
 * country, ASN). Multiple sessions are rendered as a horizontal tab
 * strip; the active tab's detail card shows Connection / Security /
 * Activity groupings.
 *
 * Mounted in place of UserProfileModal when the active server has
 * negotiated the obby.world/whois cap. The legacy modal is kept for
 * everything else.
 *
 * Spec: doc/specs/whois-batch.md in the obbyircd repo.
 */
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FaCertificate,
  FaCheck,
  FaCheckCircle,
  FaCopy,
  FaGlobe,
  FaHashtag,
  FaLock,
  FaRobot,
  FaShieldAlt,
  FaSignInAlt,
  FaTimes,
} from "react-icons/fa";
import ircClient from "../../lib/ircClient";
import { openExternalUrl } from "../../lib/openUrl";
import useStore from "../../store";
import type { WhoisSession } from "../../types";
import ExternalLinkWarningModal from "./ExternalLinkWarningModal";

interface ObbyWhoisModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverId: string;
  username: string;
  /**
   * Optional back-navigation handler. When provided, the close button
   * is augmented with a back affordance — used by UserSettings's
   * "View profile" sub-modal so the user returns to settings rather
   * than dismissing the whole stack.
   */
  onBack?: () => void;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Validate a hex color the user set via draft/metadata-2 `color`.
 * We refuse anything that isn't an exact #RRGGBB / #RGB to avoid
 * pumping arbitrary CSS values into inline `style` props.
 */
const isHexColor = (v: string | undefined): v is string =>
  !!v && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v);

const DEFAULT_ACCENT = "#5865F2"; // discord-blurple fallback

/** Render a country code as a flag emoji via regional indicator. */
const flagFromCC = (cc: string | undefined): string => {
  if (!cc || cc.length !== 2) return "";
  const a = cc.toUpperCase().charCodeAt(0);
  const b = cc.toUpperCase().charCodeAt(1);
  if (a < 0x41 || a > 0x5a || b < 0x41 || b > 0x5a) return "";
  return (
    String.fromCodePoint(0x1f1e6 + (a - 0x41)) +
    String.fromCodePoint(0x1f1e6 + (b - 0x41))
  );
};

const formatIdle = (seconds: number | undefined): string => {
  if (seconds === undefined) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
};

const formatAbsoluteTime = (
  value: number | string | undefined,
): string | null => {
  if (value === undefined || value === null || value === "") return null;
  const d =
    typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
};

const formatRelativeSince = (iso: string | undefined): string | null => {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 60) return t`just now`;
  if (secs < 3600) return t`${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return t`${Math.floor(secs / 3600)}h ago`;
  return t`${Math.floor(secs / 86400)}d ago`;
};

/* ------------------------------------------------------------------ *
 * Channel chip helpers (parity with UserProfileModal)
 * ------------------------------------------------------------------ */

const parseChannels = (raw: string) =>
  raw
    .trim()
    .split(/\s+/)
    .map((entry) => {
      let isSecret = false;
      let status = "";
      let channel = entry;
      let s = entry;
      if (s.includes("?")) {
        isSecret = true;
        s = s.replace("?", "");
      }
      const prefix = s.match(/^([~&@%+]+)/);
      if (prefix) {
        status = prefix[1];
        channel = s.substring(status.length);
      }
      return { channel, status, isSecret };
    });

const statusBadge = (status: string) => {
  if (status.includes("~"))
    return { text: "~", label: "Owner", color: "bg-red-600" };
  if (status.includes("&"))
    return { text: "&", label: "Admin", color: "bg-orange-600" };
  if (status.includes("@"))
    return { text: "@", label: "Op", color: "bg-green-600" };
  if (status.includes("%"))
    return { text: "%", label: "Halfop", color: "bg-blue-600" };
  if (status.includes("+"))
    return { text: "+", label: "Voice", color: "bg-purple-600" };
  return null;
};

/* ------------------------------------------------------------------ *
 * Session detail card
 * ------------------------------------------------------------------ */

const Row: React.FC<{
  label: React.ReactNode;
  value: React.ReactNode;
  mono?: boolean;
  copy?: string;
}> = ({ label, value, mono, copy }) => {
  const [copied, setCopied] = useState(false);
  const doCopy = () => {
    if (!copy) return;
    navigator.clipboard?.writeText(copy);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 py-1.5 items-start">
      <div className="text-xs uppercase tracking-wide text-discord-text-muted pt-0.5">
        {label}
      </div>
      <div
        className={`text-sm text-white break-all ${
          mono ? "font-mono" : ""
        } flex items-start gap-2`}
      >
        <span className="flex-1 min-w-0">{value}</span>
        {copy && (
          <button
            type="button"
            onClick={doCopy}
            className="flex-shrink-0 text-discord-text-muted hover:text-white p-1 rounded transition-colors"
            title={t`Copy`}
          >
            {copied ? (
              <FaCheck size={11} className="text-green-400" />
            ) : (
              <FaCopy size={11} />
            )}
          </button>
        )}
      </div>
    </div>
  );
};

const SessionDetail: React.FC<{
  session: WhoisSession;
  accent: string;
  isYou: boolean;
  /** Suppress the "Session N" header row when redundant (single
   * session with no `total`, or rendered below a tab strip). */
  hideHeader?: boolean;
}> = ({ session, accent, isYou, hideHeader }) => {
  const since = formatAbsoluteTime(session.since);
  const sinceRelative = formatRelativeSince(session.since);
  const signon = formatAbsoluteTime(session.signon);

  return (
    <div
      className="rounded-lg border border-discord-dark-400/60 bg-discord-dark-300/60 px-5 py-4"
      style={{ borderTopColor: accent, borderTopWidth: 2 }}
    >
      {(!hideHeader || isYou) && (
        <div className="flex items-center justify-between mb-3">
          {hideHeader ? (
            <div />
          ) : (
            <h4 className="text-white font-semibold text-sm flex items-center gap-2">
              <Trans>Session {session.ordinal}</Trans>
              {session.total && (
                <span className="text-discord-text-muted font-normal">
                  <Trans>of {session.total}</Trans>
                </span>
              )}
            </h4>
          )}
          {isYou && (
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{ background: accent, color: "#fff" }}
            >
              <Trans>This is you</Trans>
            </span>
          )}
        </div>
      )}

      {since && (
        <div className="text-xs text-discord-text-muted mb-3">
          <Trans>Joined</Trans> {since}
          {sinceRelative && (
            <span className="ml-1.5 italic">({sinceRelative})</span>
          )}
        </div>
      )}

      {/* Connection group */}
      {(session.ip ||
        session.realhost ||
        session.countryCode ||
        session.asn) && (
        <div className="mb-3">
          <div
            className="text-[0.7rem] uppercase tracking-widest font-semibold mb-1 pb-1 border-b"
            style={{ color: accent, borderBottomColor: `${accent}40` }}
          >
            <Trans>Connection</Trans>
          </div>
          {session.ip && (
            <Row
              label={<Trans>IP</Trans>}
              value={session.ip}
              mono
              copy={session.ip}
            />
          )}
          {session.realhost && (
            <Row
              label={<Trans>Hostname</Trans>}
              value={session.realhost}
              mono
              copy={session.realhost}
            />
          )}
          {session.ident && (
            <Row label={<Trans>Ident</Trans>} value={session.ident} mono />
          )}
          {session.countryCode && (
            <Row
              label={<Trans>Country</Trans>}
              value={
                <span>
                  {flagFromCC(session.countryCode)} {session.countryName} (
                  {session.countryCode})
                </span>
              }
            />
          )}
          {session.asn !== undefined && (
            <Row
              label={<Trans>ASN</Trans>}
              value={
                <span>
                  AS{session.asn}
                  {session.asname && (
                    <span className="text-discord-text-muted ml-1">
                      — {session.asname}
                    </span>
                  )}
                </span>
              }
            />
          )}
        </div>
      )}

      {/* Security group.  Modes / snomask are account-level (synced
       * canonical->sessions by the server's persistence module), so
       * they're rendered once in the identity stripe rather than
       * duplicated in every session card. */}
      {(session.secureConnection || session.certFp) && (
        <div className="mb-3">
          <div
            className="text-[0.7rem] uppercase tracking-widest font-semibold mb-1 pb-1 border-b"
            style={{ color: accent, borderBottomColor: `${accent}40` }}
          >
            <Trans>Security</Trans>
          </div>
          {session.secureConnection && (
            <Row
              label={<Trans>TLS</Trans>}
              value={
                <span className="inline-flex items-center gap-1.5">
                  <FaLock size={10} className="text-green-400" />
                  {session.secureConnection}
                </span>
              }
            />
          )}
          {session.certFp && (
            <Row
              label={<Trans>Cert FP</Trans>}
              value={
                <span className="inline-flex items-center gap-1.5">
                  <FaCertificate size={10} className="text-blue-400" />
                  <code className="truncate" title={session.certFp}>
                    {session.certFp}
                  </code>
                </span>
              }
              mono
              copy={session.certFp}
            />
          )}
        </div>
      )}

      {/* Activity group */}
      {(session.idle !== undefined || signon) && (
        <div>
          <div
            className="text-[0.7rem] uppercase tracking-widest font-semibold mb-1 pb-1 border-b"
            style={{ color: accent, borderBottomColor: `${accent}40` }}
          >
            <Trans>Activity</Trans>
          </div>
          {session.idle !== undefined && (
            <Row label={<Trans>Idle</Trans>} value={formatIdle(session.idle)} />
          )}
          {signon && <Row label={<Trans>Signed on</Trans>} value={signon} />}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ *
 * Main modal
 * ------------------------------------------------------------------ */

const ObbyWhoisModal: React.FC<ObbyWhoisModalProps> = ({
  isOpen,
  onClose,
  serverId,
  username,
  onBack,
}) => {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [activeSessionIdx, setActiveSessionIdx] = useState(0);
  const whoisRequestedRef = useRef(false);
  const metadataRequestedRef = useRef<string | null>(null);

  const whoisData = useStore((state) => state.whoisData[serverId]?.[username]);
  const servers = useStore((state) => state.servers);
  const joinChannel = useStore((state) => state.joinChannel);
  const selectChannel = useStore((state) => state.selectChannel);
  const openPrivateChat = useStore((state) => state.openPrivateChat);
  const selectPrivateChat = useStore((state) => state.selectPrivateChat);

  const server = servers.find((s) => s.id === serverId);
  const user = server?.channels
    .flatMap((ch) => ch.users)
    .find((u) => u.username === username);

  const currentNick = ircClient.getNick(serverId);
  const isOwnProfile = currentNick?.toLowerCase() === username.toLowerCase();

  /* Request WHOIS + metadata on open (mirrors UserProfileModal) */
  // biome-ignore lint/correctness/useExhaustiveDependencies: WHOIS shouldn't refire on cached data updates
  useEffect(() => {
    if (!isOpen || !serverId || !username) {
      whoisRequestedRef.current = false;
      metadataRequestedRef.current = null;
      return;
    }
    const now = Date.now();
    const age = whoisData?.timestamp
      ? now - whoisData.timestamp
      : Number.POSITIVE_INFINITY;
    const TTL = 5 * 60 * 1000;
    if (!whoisRequestedRef.current && (!whoisData?.isComplete || age > TTL)) {
      whoisRequestedRef.current = true;
      ircClient.whois(serverId, username);
    }
    if (metadataRequestedRef.current !== username) {
      metadataRequestedRef.current = username;
      useStore
        .getState()
        .metadataGet(serverId, username, [
          "avatar",
          "display-name",
          "bot",
          "homepage",
          "status",
          "color",
        ]);
    }
  }, [isOpen, serverId, username]);

  /* Reset tab when target changes */
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — re-run when target identity changes
  useEffect(() => {
    setActiveSessionIdx(0);
  }, [username, serverId]);

  /* Derived display fields */
  const displayName = user?.metadata?.["display-name"]?.value || username;
  const avatar = user?.metadata?.avatar?.value;
  const colorMeta = user?.metadata?.color?.value;
  const accent = isHexColor(colorMeta) ? colorMeta : DEFAULT_ACCENT;
  const bot = user?.metadata?.bot?.value;
  const homepage = user?.metadata?.homepage?.value;
  const userStatus = user?.metadata?.status?.value;
  const isBot = user?.isBot || !!bot;
  const botDescription = bot && bot !== "true" ? bot : undefined;
  const isVerified =
    whoisData?.account &&
    username.toLowerCase() === whoisData.account.toLowerCase();

  const isValidHttpUrl = (url: string): boolean => {
    try {
      const u = new URL(url);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  };
  const sanitizedHomepage =
    homepage && isValidHttpUrl(homepage) ? homepage : undefined;

  const parsedChannels = useMemo(
    () => (whoisData?.channels ? parseChannels(whoisData.channels) : []),
    [whoisData?.channels],
  );

  const sessions = whoisData?.sessions ?? [];
  const sessionCount =
    whoisData?.sessionCount ??
    (sessions.length > 0 ? sessions.length : undefined);
  const activeSession =
    sessions.length > 0
      ? sessions[Math.min(activeSessionIdx, sessions.length - 1)]
      : undefined;

  /* "Which session am I?" — match by ident@host against my own when self-WHOISing */
  const myIdent = ircClient.getMyIdent(serverId);
  const myHost = ircClient.getMyHost(serverId);
  const youSessionOrdinal =
    isOwnProfile && sessions.length > 0
      ? sessions.find(
          (s) =>
            s.ident === myIdent && (s.realhost === myHost || s.ip === myHost),
        )?.ordinal
      : undefined;

  /* Country / spread subtitle */
  const distinctCountries = useMemo(() => {
    const set = new Set<string>();
    sessions.forEach((s) => {
      if (s.countryCode) set.add(s.countryCode);
    });
    return Array.from(set);
  }, [sessions]);

  const getAvatarUrl = (a: string | undefined, size: number) => {
    if (!a) return undefined;
    return a.includes("{size}") ? a.replace("{size}", String(size)) : a;
  };

  const handleChannelClick = (name: string) => {
    if (!server) return;
    const existing = server.channels.find((ch) => ch.name === name);
    if (existing) {
      selectChannel(existing.id, { navigate: true });
    } else {
      joinChannel(serverId, name);
      setTimeout(() => {
        const updated = useStore
          .getState()
          .servers.find((s) => s.id === serverId);
        const ch = updated?.channels.find((c) => c.name === name);
        if (ch) selectChannel(ch.id, { navigate: true });
      }, 100);
    }
    onClose();
  };

  const handlePM = () => {
    openPrivateChat(serverId, username);
    const fresh = useStore.getState().servers.find((s) => s.id === serverId);
    const pc = fresh?.privateChats?.find(
      (p) => p.username.toLowerCase() === username.toLowerCase(),
    );
    if (pc) selectPrivateChat(pc.id, { navigate: true });
    onClose();
  };

  const handleWhois = () => ircClient.whois(serverId, username);

  if (!isOpen) return null;

  return createPortal(
    <>
      <ExternalLinkWarningModal
        isOpen={!!pendingUrl}
        url={pendingUrl || ""}
        onConfirm={async () => {
          if (pendingUrl) await openExternalUrl(pendingUrl);
          setPendingUrl(null);
        }}
        onCancel={() => setPendingUrl(null)}
      />
      <div
        className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[9999] p-4 modal-container"
        onClick={onClose}
      >
        <div
          className="relative bg-discord-dark-200 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top accent bar — replaces the old banner gradient */}
          <div
            className="h-1.5 w-full flex-shrink-0"
            style={{ background: accent }}
          />

          {/* Back button (when nested in another modal) */}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="absolute top-4 left-4 px-2.5 py-1 text-xs font-semibold rounded bg-discord-dark-100/80 hover:bg-discord-dark-100 text-white flex items-center gap-1 transition-colors z-10"
            >
              <Trans>← Back</Trans>
            </button>
          )}

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-discord-dark-100/80 hover:bg-discord-dark-100 text-white flex items-center justify-center transition-colors z-10"
          >
            <FaTimes size={14} />
          </button>

          {/* Identity stripe */}
          <div className="px-6 pt-6 pb-4 flex items-start gap-4">
            {/* Avatar with accent ring */}
            <div
              className="w-16 h-16 rounded-full flex-shrink-0 overflow-hidden flex items-center justify-center bg-discord-dark-100"
              style={{
                outline: `2px solid ${accent}`,
                outlineOffset: 2,
              }}
            >
              {avatar ? (
                <img
                  src={getAvatarUrl(avatar, 64)}
                  alt={displayName}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                    const fb = e.currentTarget
                      .nextElementSibling as HTMLElement | null;
                    if (fb) fb.style.display = "flex";
                  }}
                />
              ) : null}
              <div
                className="w-full h-full flex items-center justify-center text-2xl font-bold text-white"
                style={{
                  display: avatar ? "none" : "flex",
                  background: accent,
                }}
              >
                {displayName[0]?.toUpperCase()}
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold text-white flex items-center gap-2 flex-wrap">
                <span style={{ color: accent }}>{displayName}</span>
                {isVerified && (
                  <FaCheckCircle
                    size={14}
                    className="text-green-400"
                    title={t`Authenticated`}
                  />
                )}
                {isBot && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold bg-cyan-900/40 text-cyan-300 px-1.5 py-0.5 rounded">
                    <FaRobot size={10} /> BOT
                  </span>
                )}
                {user?.isIrcOp && (
                  <span className="text-xs font-semibold bg-yellow-900/40 text-yellow-300 px-1.5 py-0.5 rounded">
                    <Trans>IRC OP</Trans>
                  </span>
                )}
                {whoisData?.umodes && (
                  <span
                    className="text-xs font-mono bg-discord-dark-300 text-discord-text-muted px-1.5 py-0.5 rounded"
                    title={
                      whoisData.snomask
                        ? `Umodes ${whoisData.umodes}  ·  snomask ${whoisData.snomask}`
                        : t`User modes`
                    }
                  >
                    {whoisData.umodes}
                    {whoisData.snomask && (
                      <span className="text-discord-text-muted/60 ml-1">
                        {whoisData.snomask}
                      </span>
                    )}
                  </span>
                )}
              </h2>
              {displayName !== username && (
                <div className="text-xs text-discord-text-muted">
                  @{username}
                </div>
              )}

              {/* Subtitle: account · sessions · countries */}
              <div className="text-xs text-discord-text-muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {whoisData?.account && (
                  <span className="inline-flex items-center gap-1">
                    <FaShieldAlt size={9} />
                    <Trans>logged in as {whoisData.account}</Trans>
                  </span>
                )}
                {whoisData?.account &&
                  sessionCount !== undefined &&
                  sessionCount > 1 && <span>·</span>}
                {sessionCount !== undefined && sessionCount > 1 && (
                  <span>
                    <Trans>connected from {sessionCount} sessions</Trans>
                    {distinctCountries.length > 0 && (
                      <>
                        {" "}
                        <span className="text-discord-text-muted/60">
                          ({distinctCountries.join(", ")})
                        </span>
                      </>
                    )}
                  </span>
                )}
              </div>

              {whoisData?.realname && (
                <div className="text-sm text-white/80 mt-1.5">
                  {whoisData.realname}
                </div>
              )}
              {userStatus && (
                <div className="text-xs text-discord-text-muted mt-1 italic">
                  “{userStatus}”
                </div>
              )}

              {/* Action row */}
              {!isOwnProfile && (
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    onClick={handlePM}
                    className="px-3 py-1 text-xs font-semibold rounded text-white transition-opacity hover:opacity-90"
                    style={{ background: accent }}
                  >
                    <Trans>Message</Trans>
                  </button>
                  <button
                    type="button"
                    onClick={handleWhois}
                    className="px-3 py-1 text-xs font-semibold rounded bg-discord-dark-100 text-white hover:bg-discord-dark-400 transition-colors"
                  >
                    <Trans>Refresh WHOIS</Trans>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Bot description / homepage */}
          {(botDescription || sanitizedHomepage) && (
            <div className="px-6 pb-3 space-y-2">
              {botDescription && (
                <div className="bg-discord-dark-300 rounded-lg p-3 flex items-center gap-3 text-sm">
                  <FaRobot className="text-cyan-400 flex-shrink-0" size={14} />
                  <span className="text-white">{botDescription}</span>
                </div>
              )}
              {sanitizedHomepage && (
                <div className="bg-discord-dark-300 rounded-lg p-3 flex items-center gap-3 text-sm">
                  <FaGlobe className="text-blue-400 flex-shrink-0" size={14} />
                  <button
                    type="button"
                    onClick={() => setPendingUrl(sanitizedHomepage)}
                    className="text-blue-400 hover:underline text-left break-all"
                  >
                    {sanitizedHomepage}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto">
            {/* Channels */}
            {parsedChannels.length > 0 && (
              <div className="px-6 py-4 border-t border-discord-dark-400/40">
                <div
                  className="text-[0.7rem] uppercase tracking-widest font-semibold mb-2"
                  style={{ color: accent }}
                >
                  <Trans>Channels</Trans> ({parsedChannels.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {parsedChannels.map(({ channel, status, isSecret }) => {
                    const badge = statusBadge(status);
                    return (
                      <button
                        type="button"
                        key={channel}
                        onClick={() => handleChannelClick(channel)}
                        className="inline-flex items-center gap-1.5 bg-discord-dark-300 hover:bg-discord-dark-400 rounded px-2 py-1 text-sm transition-colors"
                        title={t`Click to join ${channel}`}
                      >
                        {badge && (
                          <span
                            className={`${badge.color} text-white text-[10px] font-bold px-1 rounded`}
                          >
                            {badge.text}
                          </span>
                        )}
                        <FaHashtag
                          size={9}
                          className="text-discord-text-muted"
                        />
                        <span className="text-white font-mono">
                          {channel.replace(/^#/, "")}
                        </span>
                        {isSecret && <span title={t`Secret`}>🔒</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Security groups (account-level). Rendered as a chip
             * row. Special-cased: "known-users" gets a green tint to
             * communicate "recognised account"; "unknown-users" gets
             * a yellow tint to flag the opposite. Everything else
             * (tls-users, websocket-users, etc.) renders as a neutral
             * chip. The list comes from the
             * obby.world/whois-security-groups sub-batch which is
             * only emitted to opers + self per the server's
             * set::whois-details policy. */}
            {whoisData?.securityGroups &&
              whoisData.securityGroups.length > 0 && (
                <div className="px-6 py-4 border-t border-discord-dark-400/40">
                  <div
                    className="text-[0.7rem] uppercase tracking-widest font-semibold mb-2"
                    style={{ color: accent }}
                  >
                    <Trans>Security groups</Trans> (
                    {whoisData.securityGroups.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {whoisData.securityGroups.map((g) => {
                      let tint = "bg-discord-dark-300 text-discord-text-muted";
                      if (g === "known-users")
                        tint = "bg-green-900/30 text-green-300";
                      else if (g === "unknown-users")
                        tint = "bg-yellow-900/30 text-yellow-300";
                      else if (g === "tls-users")
                        tint = "bg-blue-900/30 text-blue-300";
                      return (
                        <span
                          key={g}
                          className={`${tint} font-mono text-xs rounded px-2 py-0.5`}
                        >
                          {g}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

            {/* SESSIONS
             *
             * Shown whenever we have at least one session record OR
             * the privacy-preserving summary count.  For single-session
             * users / bots / no-persistence accounts the parser
             * synthesizes an implicit Session 1 from the parent-batch
             * per-session numerics, so this path is hit there too.
             * If we have neither (truly minimal WHOIS — only 311/318),
             * skip the section entirely; account-level info above and
             * the Status section below are already showing what we
             * know. */}
            {(sessions.length > 0 ||
              (sessionCount !== undefined && sessionCount > 1)) && (
              <div className="px-6 py-4 border-t border-discord-dark-400/40">
                <div
                  className="text-[0.7rem] uppercase tracking-widest font-semibold mb-3 flex items-center gap-2"
                  style={{ color: accent }}
                >
                  {sessions.length > 1 || (sessionCount ?? 1) > 1 ? (
                    <Trans>Sessions</Trans>
                  ) : (
                    <Trans>Connection</Trans>
                  )}
                  {sessionCount !== undefined && sessionCount > 1 && (
                    <span className="text-discord-text-muted/70 font-normal normal-case">
                      ({sessionCount})
                    </span>
                  )}
                </div>

                {sessions.length === 0 &&
                  sessionCount !== undefined &&
                  sessionCount > 1 && (
                    /* Privacy summary — non-priv querier, we know N but no detail */
                    <div className="bg-discord-dark-300 rounded-lg p-4 text-sm text-discord-text-muted">
                      <Trans>
                        This account is connected from {sessionCount} sessions.
                        Per-session details are only disclosed to the account
                        holder or IRC operators.
                      </Trans>
                    </div>
                  )}

                {sessions.length === 1 && activeSession && (
                  <SessionDetail
                    session={activeSession}
                    accent={accent}
                    isYou={
                      youSessionOrdinal !== undefined &&
                      youSessionOrdinal === activeSession.ordinal
                    }
                    hideHeader
                  />
                )}

                {sessions.length > 1 && (
                  <>
                    {/* Tab strip */}
                    <div className="flex gap-1 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
                      {sessions.map((s, idx) => {
                        const isActive = idx === activeSessionIdx;
                        const isYou =
                          youSessionOrdinal !== undefined &&
                          youSessionOrdinal === s.ordinal;
                        return (
                          <button
                            type="button"
                            key={s.ordinal}
                            onClick={() => setActiveSessionIdx(idx)}
                            className={`flex-shrink-0 px-3 py-2 rounded-t-lg text-left transition-colors min-w-[7rem] ${
                              isActive
                                ? "bg-discord-dark-300"
                                : "bg-discord-dark-100/40 hover:bg-discord-dark-300/60"
                            }`}
                            style={
                              isActive
                                ? { borderBottom: `2px solid ${accent}` }
                                : { borderBottom: "2px solid transparent" }
                            }
                          >
                            <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                              {flagFromCC(s.countryCode) || "🌐"}
                              <span>
                                <Trans>Session</Trans> {s.ordinal}
                              </span>
                              {isYou && (
                                <span
                                  className="w-1.5 h-1.5 rounded-full"
                                  style={{ background: accent }}
                                  title={t`This is you`}
                                />
                              )}
                            </div>
                            <div className="text-[10px] text-discord-text-muted mt-0.5">
                              {s.idle !== undefined
                                ? t`${formatIdle(s.idle)} idle`
                                : s.since
                                  ? formatRelativeSince(s.since)
                                  : ""}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {activeSession && (
                      <SessionDetail
                        session={activeSession}
                        accent={accent}
                        isYou={
                          youSessionOrdinal !== undefined &&
                          youSessionOrdinal === activeSession.ordinal
                        }
                        hideHeader
                      />
                    )}
                  </>
                )}
              </div>
            )}

            {/* Away / status / swhois / specials */}
            {(user?.isAway ||
              (whoisData?.specialMessages &&
                whoisData.specialMessages.length > 0)) && (
              <div className="px-6 py-4 border-t border-discord-dark-400/40">
                <div
                  className="text-[0.7rem] uppercase tracking-widest font-semibold mb-2"
                  style={{ color: accent }}
                >
                  <Trans>Status</Trans>
                </div>
                {user?.isAway && (
                  <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-lg p-3 mb-2 text-sm text-yellow-200">
                    <span className="font-semibold mr-2">
                      <Trans>Away:</Trans>
                    </span>
                    {user.awayMessage || (
                      <span className="italic">
                        <Trans>no message</Trans>
                      </span>
                    )}
                  </div>
                )}
                {whoisData?.specialMessages
                  ?.filter((m) => !/is connected from\s+\d+\s+session/i.test(m))
                  .map((m) => (
                    <div
                      key={m}
                      className="text-xs text-discord-text-muted py-0.5"
                    >
                      <FaSignInAlt
                        size={9}
                        className="inline-block mr-1.5 opacity-50"
                      />
                      {m}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
};

export default ObbyWhoisModal;
