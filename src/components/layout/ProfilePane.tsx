import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FaBan,
  FaCertificate,
  FaCheck,
  FaCheckCircle,
  FaChevronLeft,
  FaClock,
  FaCopy,
  FaDesktop,
  FaEllipsisH,
  FaGlobe,
  FaHashtag,
  FaLock,
  FaRobot,
  FaShieldAlt,
  FaSignInAlt,
  FaSyncAlt,
  FaTerminal,
  FaTimes,
  FaVolumeUp,
} from "react-icons/fa";
import { getChannelKind } from "../../lib/channelFolders";
import { e2eeSessionKey } from "../../lib/e2ee/session";
import { createIgnorePattern, isUserIgnored } from "../../lib/ignoreUtils";
import ircClient from "../../lib/ircClient";
import { serverFilehosts } from "../../lib/ircUtils";
import { canShowAvatarUrl, mediaLevelToSettings } from "../../lib/mediaUtils";
import { openExternalUrl } from "../../lib/openUrl";
import { formatRelativeTime } from "../../lib/relativeTime";
import useStore from "../../store";
import { findServerUser } from "../../store/helpers";
import type { ProfilePane as ProfilePaneTarget } from "../../store/types";
import type { WhoisSession } from "../../types";
import ExternalLinkWarningModal from "../ui/ExternalLinkWarningModal";
import Menu, { type MenuItem } from "../ui/Menu";
import { DEFAULT_ACCENT, isHexColor } from "../ui/ProfileBanner";
import { SettingGroup } from "../ui/page/SettingRow";

const WHOIS_CACHE_TTL = 5 * 60 * 1000;
const METADATA_KEYS = [
  "avatar",
  "display-name",
  "bot",
  "homepage",
  "status",
  "color",
];
const LEGACY_METADATA_KEYS = [...METADATA_KEYS, "pronouns"];
const OBBY_WHOIS_CAP = "obby.world/whois";

const isHttpUrl = (url: string): boolean => {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const formatIdle = (seconds: number | undefined): string => {
  if (seconds === undefined) return "-";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
};

const formatAbsoluteTime = (
  value: number | string | undefined,
): string | null => {
  if (value === undefined || value === "") return null;
  const date =
    typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
};

const formatRelativeSince = (iso: string | undefined): string | null => {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) ? formatRelativeTime(ts) : null;
};

const parseChannels = (raw: string) =>
  raw
    .trim()
    .split(/\s+/)
    .map((entry) => {
      const isSecret = entry.includes("?");
      const withoutSecret = entry.replace("?", "");
      const prefix = withoutSecret.match(/^([~&@%+]+)/)?.[1] ?? "";
      return {
        channel: withoutSecret.substring(prefix.length),
        status: prefix,
        isSecret,
      };
    });

const statusBadge = (status: string) => {
  if (status.includes("~"))
    return { text: "~", label: t`Owner`, color: "bg-red-600" };
  if (status.includes("&"))
    return { text: "&", label: t`Admin`, color: "bg-orange-600" };
  if (status.includes("@"))
    return { text: "@", label: t`Op`, color: "bg-green-600" };
  if (status.includes("%"))
    return { text: "%", label: t`Halfop`, color: "bg-blue-600" };
  if (status.includes("+"))
    return { text: "+", label: t`Voice`, color: "bg-purple-600" };
  return null;
};

const DetailRow: React.FC<{
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
    <div className="flex gap-3 px-4 py-2.5 border-t border-white/[0.06] first:border-t-0">
      <dt className="w-24 shrink-0 text-[13px] text-discord-text-muted pt-0.5">
        {label}
      </dt>
      <dd
        className={`flex-1 min-w-0 flex items-start gap-2 text-sm text-white ${mono ? "font-mono break-all" : "[overflow-wrap:anywhere]"}`}
      >
        <span className="flex-1 min-w-0">{value}</span>
        {copy && (
          <button
            type="button"
            onClick={doCopy}
            className="icon-button -my-1"
            title={t`Copy`}
            aria-label={t`Copy`}
          >
            {copied ? (
              <FaCheck size={11} className="text-green-400" />
            ) : (
              <FaCopy size={11} />
            )}
          </button>
        )}
      </dd>
    </div>
  );
};

const SessionGroups: React.FC<{ session: WhoisSession; isYou: boolean }> = ({
  session,
  isYou,
}) => {
  const since = formatAbsoluteTime(session.since);
  const sinceRelative = formatRelativeSince(session.since);
  const signon = formatAbsoluteTime(session.signon);
  const hasConnection =
    session.ip ||
    session.realhost ||
    session.ident ||
    session.countryCode ||
    session.asn !== undefined;

  return (
    <>
      {isYou && (
        <span className="self-start text-xs font-semibold px-2 py-0.5 rounded-full bg-discord-primary text-white">
          <Trans>This is you</Trans>
        </span>
      )}
      {hasConnection && (
        <SettingGroup title={<Trans>Connection</Trans>}>
          <dl className="flex flex-col">
            {session.ip && (
              <DetailRow
                label={<Trans>IP</Trans>}
                value={session.ip}
                mono
                copy={session.ip}
              />
            )}
            {session.realhost && (
              <DetailRow
                label={<Trans>Hostname</Trans>}
                value={session.realhost}
                mono
                copy={session.realhost}
              />
            )}
            {session.ident && (
              <DetailRow
                label={<Trans>Ident</Trans>}
                value={session.ident}
                mono
              />
            )}
            {session.countryCode && (
              <DetailRow
                label={<Trans>Country</Trans>}
                value={
                  session.countryName
                    ? `${session.countryName} (${session.countryCode})`
                    : session.countryCode
                }
              />
            )}
            {session.asn !== undefined && (
              <DetailRow
                label={<Trans>ASN</Trans>}
                value={`AS${session.asn}${session.asname ? ` ${session.asname}` : ""}`}
              />
            )}
          </dl>
        </SettingGroup>
      )}
      {(session.secureConnection || session.certFp) && (
        <SettingGroup title={<Trans>Security</Trans>}>
          <dl className="flex flex-col">
            {session.secureConnection && (
              <DetailRow
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
              <DetailRow
                label={<Trans>Cert FP</Trans>}
                value={
                  <span className="inline-flex items-center gap-1.5">
                    <FaCertificate size={10} className="text-blue-400" />
                    {session.certFp}
                  </span>
                }
                mono
                copy={session.certFp}
              />
            )}
          </dl>
        </SettingGroup>
      )}
      {(session.idle !== undefined || since || signon) && (
        <SettingGroup title={<Trans>Activity</Trans>}>
          <dl className="flex flex-col">
            {session.idle !== undefined && (
              <DetailRow
                label={<Trans>Idle</Trans>}
                value={formatIdle(session.idle)}
              />
            )}
            {since && (
              <DetailRow
                label={<Trans>Joined</Trans>}
                value={sinceRelative ? `${since} (${sinceRelative})` : since}
              />
            )}
            {signon && (
              <DetailRow label={<Trans>Signed on</Trans>} value={signon} />
            )}
          </dl>
        </SettingGroup>
      )}
    </>
  );
};

const ChannelKindGlyph: React.FC<{ name: string }> = ({ name }) => {
  const kind = getChannelKind(name);
  const Icon =
    kind === "voice" ? FaVolumeUp : kind === "stream" ? FaDesktop : FaHashtag;
  return <Icon size={9} className="text-discord-text-muted" />;
};

const ProfilePane: React.FC<{ target: ProfilePaneTarget }> = ({
  target: { serverId, username },
}) => {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [activeSessionIdx, setActiveSessionIdx] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);

  const whoisData = useStore((s) => s.whoisData[serverId]?.[username]);
  const server = useStore((s) => s.servers.find((srv) => srv.id === serverId));
  const botCommands = useStore(
    (s) =>
      s.servers.find((srv) => srv.id === serverId)?.botCommands?.[
        username.toLowerCase()
      ] ?? null,
  );
  const isNarrowView = useStore((s) => s.ui.isNarrowView);
  const ignoreList = useStore((s) => s.globalSettings.ignoreList);
  const e2eeStatus = useStore(
    (s) => s.e2eeSessions[e2eeSessionKey(serverId, username)]?.status,
  );
  const mediaSettings = mediaLevelToSettings(
    useStore((s) => s.globalSettings.mediaVisibilityLevel),
  );
  const closeProfile = useStore((s) => s.closeProfile);
  const openPage = useStore((s) => s.openPage);
  const openBot = useStore((s) => s.openBot);
  const joinChannel = useStore((s) => s.joinChannel);
  const selectChannel = useStore((s) => s.selectChannel);
  const openChat = useStore((s) => s.openChat);
  const setAway = useStore((s) => s.setAway);
  const clearAway = useStore((s) => s.clearAway);
  const openE2EEVerify = useStore((s) => s.openE2EEVerify);
  const addToIgnoreList = useStore((s) => s.addToIgnoreList);
  const removeFromIgnoreList = useStore((s) => s.removeFromIgnoreList);

  const useObby = !!server?.capabilities?.includes(OBBY_WHOIS_CAP);
  const metadataKeys = useObby ? METADATA_KEYS : LEGACY_METADATA_KEYS;

  const user = findServerUser(server, username);
  const isOwnProfile =
    ircClient.getNick(serverId)?.toLowerCase() === username.toLowerCase();

  // biome-ignore lint/correctness/useExhaustiveDependencies: whoisData is read once per target so cached WHOIS data does not refire the request
  useEffect(() => {
    const age = whoisData?.timestamp
      ? Date.now() - whoisData.timestamp
      : Number.POSITIVE_INFINITY;
    if (!whoisData?.isComplete || age > WHOIS_CACHE_TTL) {
      ircClient.whois(serverId, username);
    }
    useStore.getState().metadataGet(serverId, username, metadataKeys);
  }, [serverId, username]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new target starts on its first session
  useEffect(() => {
    setActiveSessionIdx(0);
  }, [serverId, username]);

  const displayName = user?.metadata?.["display-name"]?.value || username;
  const avatar = user?.metadata?.avatar?.value;
  const canShowAvatar = canShowAvatarUrl(
    avatar,
    serverFilehosts(server),
    mediaSettings,
  );
  const colorMeta = user?.metadata?.color?.value;
  const nameColor = isHexColor(colorMeta) ? colorMeta : undefined;
  const accent = nameColor ?? DEFAULT_ACCENT;
  const bot = user?.metadata?.bot?.value;
  const isBot = !!user?.isBot || !!bot;
  const botDescription = bot && bot !== "true" ? bot : undefined;
  const userStatus = user?.metadata?.status?.value;
  const pronouns = user?.metadata?.pronouns?.value;
  const homepage = user?.metadata?.homepage?.value;
  const sanitizedHomepage =
    homepage && isHttpUrl(homepage) ? homepage : undefined;
  const isVerified =
    !!whoisData?.account &&
    username.toLowerCase() === whoisData.account.toLowerCase();

  const sessions = whoisData?.sessions ?? [];
  const sessionCount =
    whoisData?.sessionCount ??
    (sessions.length > 0 ? sessions.length : undefined);
  const activeSession =
    sessions.length > 0
      ? sessions[Math.min(activeSessionIdx, sessions.length - 1)]
      : undefined;
  const myIdent = ircClient.getMyIdent(serverId);
  const myHost = ircClient.getMyHost(serverId);
  const youSessionOrdinal = isOwnProfile
    ? sessions.find(
        (s) =>
          s.ident === myIdent && (s.realhost === myHost || s.ip === myHost),
      )?.ordinal
    : undefined;
  const isYou = (ordinal: number) => youSessionOrdinal === ordinal;

  const parsedChannels = useMemo(
    () => (whoisData?.channels ? parseChannels(whoisData.channels) : []),
    [whoisData?.channels],
  );

  const presenceClass = user?.isAway
    ? "bg-yellow-400"
    : user
      ? "bg-discord-green"
      : "bg-discord-dark-500";
  const presenceText = userStatus
    ? userStatus
    : user?.isAway
      ? t`Away`
      : user
        ? t`Online`
        : t`Offline`;

  const leaveOnNarrow = () => {
    if (isNarrowView) closeProfile();
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
    leaveOnNarrow();
  };

  const messageUser = () => {
    openChat(serverId, username);
    leaveOnNarrow();
  };

  const showInBotsMenu = () => {
    openBot(serverId, username);
  };

  const editOwnProfile = () => {
    closeProfile();
    openPage({ kind: "settings", section: "profile" });
  };

  const isIgnored = isUserIgnored(username, undefined, undefined, ignoreList);
  const toggleIgnored = () => {
    if (isIgnored) {
      ignoreList
        .filter((pattern) =>
          isUserIgnored(username, undefined, undefined, [pattern]),
        )
        .forEach(removeFromIgnoreList);
    } else {
      addToIgnoreList(createIgnorePattern(username));
    }
  };

  const canVerify =
    e2eeStatus === "established" || e2eeStatus === "key-changed";
  const menuItems: MenuItem[] = [
    {
      id: "whois",
      label: t`Refresh WHOIS`,
      icon: <FaSyncAlt />,
      show: !isOwnProfile,
      onClick: () => ircClient.whois(serverId, username),
    },
    {
      id: "bots",
      label: t`Show in bots menu`,
      icon: <FaTerminal />,
      show: isBot && !!botCommands?.length,
      onClick: showInBotsMenu,
    },
    {
      id: "verify",
      label:
        e2eeStatus === "key-changed" ? (
          <Trans>Review changed key…</Trans>
        ) : (
          <Trans>Verify fingerprint…</Trans>
        ),
      icon: <FaShieldAlt />,
      show: !isOwnProfile && canVerify,
      onClick: () => openE2EEVerify(serverId, username),
    },
    {
      id: "ignore",
      label: isIgnored ? t`Unignore user` : t`Ignore user`,
      icon: isIgnored ? <FaCheckCircle /> : <FaBan />,
      danger: !isIgnored,
      show: !isOwnProfile,
      onClick: toggleIgnored,
    },
    {
      id: "away",
      label: server?.isAway ? t`I'm back` : t`Set away`,
      icon: <FaClock />,
      show: isOwnProfile,
      onClick: () => (server?.isAway ? clearAway(serverId) : setAway(serverId)),
    },
  ];

  const confirmOpenUrl = async () => {
    if (pendingUrl) await openExternalUrl(pendingUrl);
    setPendingUrl(null);
  };

  const avatarUrl = avatar?.includes("{size}")
    ? avatar.replace("{size}", "96")
    : avatar;

  const statusMessages = (whoisData?.specialMessages ?? []).filter(
    (m) =>
      !/is connected from\s+\d+\s+session/i.test(m) &&
      !(whoisData?.umodes && /is using modes/i.test(m)),
  );

  return (
    <div className="flex flex-col h-full min-h-0 overflow-x-hidden bg-discord-dark-100">
      <ExternalLinkWarningModal
        isOpen={!!pendingUrl}
        url={pendingUrl ?? ""}
        onConfirm={confirmOpenUrl}
        onCancel={() => setPendingUrl(null)}
      />

      <header className="h-12 shrink-0 flex items-center gap-1.5 px-2 border-b border-white/[0.06]">
        {isNarrowView && (
          <button
            type="button"
            onClick={closeProfile}
            className="icon-button w-10 h-10 rounded-lg"
            title={t`Back`}
            aria-label={t`Back`}
          >
            <FaChevronLeft className="w-3.5 h-3.5" />
          </button>
        )}
        <h2 className="flex-1 min-w-0 truncate px-1 text-[15px] font-semibold text-white">
          <Trans>Profile</Trans>
        </h2>
        {!isNarrowView && (
          <button
            type="button"
            onClick={closeProfile}
            className="icon-button w-10 h-10 rounded-lg"
            title={t`Close`}
            aria-label={t`Close`}
          >
            <FaTimes className="w-3.5 h-3.5" />
          </button>
        )}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-4 flex flex-col gap-6">
        <section className="flex flex-col items-center gap-2 text-center">
          <div className="w-20 h-20 rounded-full overflow-hidden flex items-center justify-center bg-discord-dark-400 shrink-0">
            {canShowAvatar ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                  const fallback = e.currentTarget
                    .nextElementSibling as HTMLElement | null;
                  if (fallback) fallback.style.display = "flex";
                }}
              />
            ) : null}
            <div
              className="w-full h-full items-center justify-center text-3xl font-bold text-white"
              style={{ display: canShowAvatar ? "none" : "flex" }}
            >
              {displayName[0]?.toUpperCase()}
            </div>
          </div>

          <h3 className="mt-1 text-xl font-bold text-white flex items-center gap-2 flex-wrap justify-center">
            <span style={nameColor ? { color: nameColor } : undefined}>
              {displayName}
            </span>
            {isVerified && (
              <FaCheckCircle
                size={14}
                className="text-green-400"
                title={t`Authenticated`}
              />
            )}
            {isBot && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold bg-cyan-900/40 text-cyan-300 px-1.5 py-0.5 rounded">
                <FaRobot size={10} />
                <Trans>BOT</Trans>
              </span>
            )}
            {user?.isIrcOp && (
              <span className="text-xs font-semibold bg-yellow-900/40 text-yellow-300 px-1.5 py-0.5 rounded">
                <Trans>IRC OP</Trans>
              </span>
            )}
          </h3>
          {displayName !== username && (
            <div className="text-[13px] text-discord-text-muted">
              @{username}
            </div>
          )}
          {pronouns && (
            <div className="text-[13px] text-discord-text-muted">
              {pronouns}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[13px] text-discord-text-muted">
            <span className={`w-2 h-2 rounded-full ${presenceClass}`} />
            {presenceText}
          </div>
          {botDescription && (
            <div className="mt-1 flex items-center gap-2 text-sm text-white">
              <FaRobot className="text-cyan-400 shrink-0" size={14} />
              {botDescription}
            </div>
          )}

          <div className="mt-2 flex items-center gap-2">
            {isOwnProfile ? (
              <button
                type="button"
                onClick={editOwnProfile}
                className="button-primary h-9 px-4 rounded-lg text-sm font-semibold"
              >
                <Trans>Edit profile</Trans>
              </button>
            ) : (
              <button
                type="button"
                onClick={messageUser}
                className="button-primary h-9 px-4 rounded-lg text-sm font-semibold"
              >
                <Trans>Message</Trans>
              </button>
            )}
            <button
              ref={moreRef}
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="h-10 w-10 rounded-lg bg-discord-dark-100 text-white flex items-center justify-center hover:bg-discord-dark-400 transition-colors"
              title={t`More actions`}
              aria-label={t`More actions`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <FaEllipsisH size={14} />
            </button>
            <Menu
              isOpen={menuOpen}
              onClose={() => setMenuOpen(false)}
              menuItems={menuItems}
              anchorElement={moreRef.current}
            />
          </div>
        </section>

        <SettingGroup>
          {!whoisData?.isComplete && (
            <div className="px-4 py-3 flex items-center gap-2 text-sm text-discord-text-muted">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-discord-primary border-t-transparent" />
              <Trans>Loading WHOIS data...</Trans>
            </div>
          )}
          <dl className="flex flex-col">
            {whoisData?.username && whoisData.host && (
              <DetailRow
                label={<Trans>Host</Trans>}
                value={`${whoisData.username}@${whoisData.host}`}
                mono
              />
            )}
            {whoisData?.realname && (
              <DetailRow
                label={<Trans>Real name</Trans>}
                value={whoisData.realname}
              />
            )}
            {whoisData?.account && (
              <DetailRow
                label={<Trans>Account</Trans>}
                value={
                  <span className="inline-flex items-center gap-1.5">
                    {whoisData.account}
                    {isVerified && (
                      <FaCheckCircle size={11} className="text-green-400" />
                    )}
                  </span>
                }
              />
            )}
            {whoisData?.server && (
              <DetailRow
                label={<Trans>Connected to</Trans>}
                value={
                  whoisData.serverInfo
                    ? `${whoisData.server} (${whoisData.serverInfo})`
                    : whoisData.server
                }
                mono
              />
            )}
            {sessions.length === 0 && whoisData?.idle !== undefined && (
              <DetailRow
                label={<Trans>Idle</Trans>}
                value={formatIdle(whoisData.idle)}
              />
            )}
            {sessions.length === 0 && formatAbsoluteTime(whoisData?.signon) && (
              <DetailRow
                label={<Trans>Signed on</Trans>}
                value={formatAbsoluteTime(whoisData?.signon)}
              />
            )}
            {whoisData?.umodes && (
              <DetailRow
                label={<Trans>Modes</Trans>}
                value={`${whoisData.umodes}${whoisData.snomask ? ` ${whoisData.snomask}` : ""}`}
                mono
              />
            )}
            {whoisData?.secureConnection && (
              <DetailRow
                label={<Trans>Secure connection</Trans>}
                value={whoisData.secureConnection}
              />
            )}
            {sanitizedHomepage && (
              <DetailRow
                label={<Trans>Homepage</Trans>}
                value={
                  <button
                    type="button"
                    onClick={() => setPendingUrl(sanitizedHomepage)}
                    className="flex items-center gap-2 text-blue-400 hover:underline text-left break-all"
                  >
                    <FaGlobe className="shrink-0" size={12} />
                    {sanitizedHomepage}
                  </button>
                }
              />
            )}
          </dl>
        </SettingGroup>

        {parsedChannels.length > 0 && (
          <SettingGroup
            title={
              <>
                <Trans>Channels</Trans> ({parsedChannels.length})
              </>
            }
          >
            <div className="flex flex-wrap gap-1.5 p-3">
              {parsedChannels.map(({ channel, status, isSecret }) => {
                const badge = statusBadge(status);
                return (
                  <button
                    type="button"
                    key={channel}
                    onClick={() => handleChannelClick(channel)}
                    className="inline-flex items-center gap-1.5 min-h-9 bg-discord-dark-300 hover:bg-discord-dark-400 rounded px-2 py-1 text-sm transition-colors"
                    title={t`Join ${channel}`}
                  >
                    {badge && (
                      <span
                        className={`${badge.color} text-white text-[10px] font-bold px-1 rounded`}
                        title={badge.label}
                      >
                        {badge.text}
                      </span>
                    )}
                    <ChannelKindGlyph name={channel} />
                    <span className="text-white font-mono">
                      {channel.replace(/^[#^$]/, "")}
                    </span>
                    {isSecret && (
                      <span title={t`Secret`}>
                        <FaLock size={9} className="text-discord-text-muted" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </SettingGroup>
        )}

        {whoisData?.securityGroups && whoisData.securityGroups.length > 0 && (
          <SettingGroup
            title={
              <>
                <Trans>Security groups</Trans> (
                {whoisData.securityGroups.length})
              </>
            }
          >
            <div className="flex flex-wrap gap-1.5 p-3">
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
          </SettingGroup>
        )}

        {sessions.length === 0 &&
          sessionCount !== undefined &&
          sessionCount > 1 && (
            <SettingGroup
              title={
                <>
                  <Trans>Sessions</Trans> ({sessionCount})
                </>
              }
            >
              <p className="p-4 text-sm text-discord-text-muted">
                <Trans>
                  {sessionCount} sessions connected. Sign in as this account or
                  ask an IRC operator to see their details.
                </Trans>
              </p>
            </SettingGroup>
          )}

        {sessions.length > 1 && (
          <SettingGroup
            title={
              <>
                <Trans>Sessions</Trans> ({sessions.length})
              </>
            }
          >
            <div className="flex gap-1 overflow-x-auto p-2">
              {sessions.map((s, idx) => {
                const isActive = idx === activeSessionIdx;
                return (
                  <button
                    type="button"
                    key={s.ordinal}
                    aria-pressed={isActive}
                    onClick={() => setActiveSessionIdx(idx)}
                    className={`flex-shrink-0 px-3 py-2 rounded-lg text-left transition-colors min-w-[7rem] ${
                      isActive
                        ? "bg-discord-dark-300"
                        : "bg-transparent hover:bg-discord-dark-300/60"
                    }`}
                    style={{
                      boxShadow: isActive ? `inset 0 -2px 0 ${accent}` : "none",
                    }}
                  >
                    <div className="text-xs font-semibold text-white flex items-center gap-1.5">
                      {s.countryCode ? (
                        <span className="font-mono">{s.countryCode}</span>
                      ) : (
                        <FaGlobe size={10} className="text-blue-400" />
                      )}
                      <span>
                        <Trans>Session</Trans> {s.ordinal}
                      </span>
                      {isYou(s.ordinal) && (
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
          </SettingGroup>
        )}

        {activeSession && (
          <SessionGroups
            session={activeSession}
            isYou={isYou(activeSession.ordinal)}
          />
        )}

        {(user?.isAway || statusMessages.length > 0) && (
          <SettingGroup title={<Trans>Status</Trans>}>
            <div className="flex flex-col gap-2 p-4">
              {user?.isAway && (
                <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-lg p-3 text-sm text-yellow-200">
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
              {statusMessages.map((m) => (
                <div key={m} className="text-xs text-discord-text-muted">
                  <FaSignInAlt
                    size={9}
                    className="inline-block mr-1.5 opacity-50"
                  />
                  {m}
                </div>
              ))}
            </div>
          </SettingGroup>
        )}
      </div>
    </div>
  );
};

export default ProfilePane;
