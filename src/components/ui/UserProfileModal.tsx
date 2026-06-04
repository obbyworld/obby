import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FaClock,
  FaGlobe,
  FaHashtag,
  FaInfoCircle,
  FaRobot,
  FaServer,
  FaShieldAlt,
  FaTimes,
  FaUser,
  FaUserCheck,
} from "react-icons/fa";
import ircClient from "../../lib/ircClient";
import { serverFilehosts } from "../../lib/ircUtils";
import { canShowAvatarUrl, mediaLevelToSettings } from "../../lib/mediaUtils";
import { openExternalUrl } from "../../lib/openUrl";
import useStore from "../../store";
import ExternalLinkWarningModal from "./ExternalLinkWarningModal";

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBack?: () => void;
  serverId: string;
  username: string;
}

// Parse channel string into individual channels with status
const parseChannels = (channelsStr: string) => {
  // Split by space to get individual channel entries
  const channelEntries = channelsStr.trim().split(/\s+/);

  return channelEntries.map((entry) => {
    let isSecret = false;
    let status = "";
    let channel = entry;
    let processedEntry = entry;

    // Check for secret channel (prefix contains ?)
    if (processedEntry.includes("?")) {
      isSecret = true;
      // Remove the ? from the entry for further processing
      processedEntry = processedEntry.replace("?", "");
    }

    // Extract status prefixes: ~ & @ % +
    const prefixMatch = processedEntry.match(/^([~&@%+]+)/);
    if (prefixMatch) {
      status = prefixMatch[1];
      channel = processedEntry.substring(status.length);
    }

    return { channel, status, isSecret };
  });
};

// Get status badge info
const getStatusBadge = (status: string) => {
  // Get the highest privilege from multi-prefix
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

const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  onClose,
  onBack,
  serverId,
  username,
}) => {
  const [isLoadingWhois, setIsLoadingWhois] = useState(false);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const whoisRequestedRef = useRef(false);
  const metadataRequestedRef = useRef<string | null>(null);

  const whoisData = useStore((state) => state.whoisData[serverId]?.[username]);
  const servers = useStore((state) => state.servers);
  const joinChannel = useStore((state) => state.joinChannel);
  const selectChannel = useStore((state) => state.selectChannel);
  const openPrivateChat = useStore((state) => state.openPrivateChat);
  const selectPrivateChat = useStore((state) => state.selectPrivateChat);
  const toggleSettingsModal = useStore((state) => state.toggleSettingsModal);
  const setAway = useStore((state) => state.setAway);
  const clearAway = useStore((state) => state.clearAway);
  const server = servers.find((s) => s.id === serverId);
  const mediaSettings = mediaLevelToSettings(
    useStore((state) => state.globalSettings.mediaVisibilityLevel),
  );

  // Get user metadata from channels
  const user = server?.channels
    .flatMap((ch) => ch.users)
    .find((u) => u.username === username);

  // Check if we're viewing our own profile
  const currentNick = ircClient.getNick(serverId);
  const isOwnProfile = currentNick?.toLowerCase() === username.toLowerCase();

  // Fetch WHOIS and metadata when modal opens
  // biome-ignore lint/correctness/useExhaustiveDependencies: whoisData intentionally not in deps to prevent multiple WHOIS requests
  useEffect(() => {
    if (!isOpen || !serverId || !username) {
      // Reset the refs when modal closes
      whoisRequestedRef.current = false;
      metadataRequestedRef.current = null;
      setIsLoadingWhois(false);
      setIsLoadingMetadata(false);
      return;
    }

    // Check if we have recent whois data (less than 5 minutes old)
    const now = Date.now();
    const whoisAge = whoisData?.timestamp
      ? now - whoisData.timestamp
      : Number.POSITIVE_INFINITY;
    const WHOIS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    // Only request WHOIS once per modal opening
    if (
      !whoisRequestedRef.current &&
      (!whoisData?.isComplete || whoisAge > WHOIS_CACHE_TTL)
    ) {
      whoisRequestedRef.current = true;
      setIsLoadingWhois(true);
      ircClient.whois(serverId, username);
    } else if (whoisData?.isComplete) {
      // If we already have complete WHOIS data, don't show loading
      setIsLoadingWhois(false);
    }

    // Fetch metadata only once per username per modal opening
    if (metadataRequestedRef.current !== username) {
      metadataRequestedRef.current = username;
      setIsLoadingMetadata(true);
      // Metadata GET for avatar, display-name, bot, homepage, status, and color
      useStore
        .getState()
        .metadataGet(serverId, username, [
          "avatar",
          "display-name",
          "bot",
          "homepage",
          "status",
          "color",
          "pronouns",
        ]);
      setTimeout(() => setIsLoadingMetadata(false), 2000);
    }
  }, [isOpen, serverId, username]);

  // Clear loading state when whois is complete
  useEffect(() => {
    if (whoisData?.isComplete) {
      setIsLoadingWhois(false);
    }
  }, [whoisData?.isComplete]);

  // Memoize parsed channels to prevent re-ordering on re-renders
  const parsedChannels = useMemo(() => {
    if (!whoisData?.channels) return [];
    return parseChannels(whoisData.channels);
  }, [whoisData?.channels]);

  if (!isOpen) return null;

  // Format idle time
  const formatIdleTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds} seconds`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours`;
    return `${Math.floor(seconds / 86400)} days`;
  };

  // Format signon time
  const formatSignonTime = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString();
  };

  const displayName = user?.metadata?.["display-name"]?.value || username;
  const avatar = user?.metadata?.avatar?.value;
  const bot = user?.metadata?.bot?.value;
  const homepage = user?.metadata?.homepage?.value;
  const status = user?.metadata?.status?.value;
  const color = user?.metadata?.color?.value;
  const pronouns = user?.metadata?.pronouns?.value;

  const canShowAvatar = canShowAvatarUrl(
    avatar,
    serverFilehosts(server),
    mediaSettings,
  );

  // Check if user is a bot (from metadata or isBot flag)
  const isBot = user?.isBot || bot === "true" || !!bot;
  // Get bot description if it's not just "true"
  const botDescription = bot && bot !== "true" ? bot : undefined;

  // Check if user is verified (account name matches nickname, case-insensitive)
  const isVerified = whoisData?.account
    ? username.toLowerCase() === whoisData.account.toLowerCase()
    : false;

  // Validate and sanitize URL to prevent XSS
  const isValidHttpUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      // Only allow http and https protocols
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  };

  // Get sanitized homepage URL
  const sanitizedHomepage =
    homepage && isValidHttpUrl(homepage) ? homepage : undefined;

  // Handle homepage link click
  const handleHomepageClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (sanitizedHomepage) {
      setPendingUrl(sanitizedHomepage);
    }
  };

  const handleConfirmOpen = async () => {
    if (pendingUrl) {
      await openExternalUrl(pendingUrl);
    }
    setPendingUrl(null);
  };

  const handleCancelOpen = () => {
    setPendingUrl(null);
  };

  // Get avatar URL with size replacement
  const getAvatarUrl = (
    avatarUrl: string | undefined,
    size: number,
  ): string | undefined => {
    if (!avatarUrl) return undefined;
    if (avatarUrl.includes("{size}")) {
      return avatarUrl.replace("{size}", size.toString());
    }
    return avatarUrl;
  };

  // Handle channel click to join
  const handleChannelClick = (channelName: string) => {
    if (!server) return;

    // Check if already in the channel
    const existingChannel = server.channels.find(
      (ch) => ch.name === channelName,
    );

    if (existingChannel) {
      // Just switch to the channel
      selectChannel(existingChannel.id, { navigate: true });
    } else {
      // Join the channel - it will be added to the server's channels
      joinChannel(serverId, channelName);
      // Wait a bit for the channel to be created, then select it
      setTimeout(() => {
        const updatedServer = useStore
          .getState()
          .servers.find((s) => s.id === serverId);
        const newChannel = updatedServer?.channels.find(
          (ch) => ch.name === channelName,
        );
        if (newChannel) {
          selectChannel(newChannel.id, { navigate: true });
        }
      }, 100);
    }

    // Close the modal after joining/switching
    onClose();
  };

  if (!isOpen) return null;

  return createPortal(
    <>
      <ExternalLinkWarningModal
        isOpen={!!pendingUrl}
        url={pendingUrl || ""}
        onConfirm={handleConfirmOpen}
        onCancel={handleCancelOpen}
      />
      <div
        className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-[9999] p-4 modal-container"
        onClick={onClose}
      >
        <div
          className="bg-gradient-to-br from-discord-dark-200 to-discord-dark-100 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header with Banner */}
          <div className="relative">
            {/* Banner */}
            <div className="h-24 bg-gradient-to-r from-[#36393F] via-[#5865F2] to-discord-green" />

            {/* Avatar positioned over banner */}
            <div className="absolute -bottom-12 left-6">
              <div className="w-24 h-24 rounded-full bg-discord-dark-100 flex items-center justify-center overflow-hidden border-4 border-discord-dark-200 shadow-xl transition-transform duration-300 ease-in-out hover:scale-[2] hover:z-50 cursor-pointer">
                {canShowAvatar ? (
                  <img
                    src={getAvatarUrl(avatar, 96)}
                    alt={displayName}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                      if (e.currentTarget.nextElementSibling) {
                        (
                          e.currentTarget.nextElementSibling as HTMLElement
                        ).style.display = "flex";
                      }
                    }}
                  />
                ) : null}
                <div
                  className="w-full h-full flex items-center justify-center text-3xl font-bold text-white bg-gradient-to-br from-discord-blurple to-purple-600"
                  style={{ display: canShowAvatar ? "none" : "flex" }}
                >
                  {displayName[0].toUpperCase()}
                </div>
              </div>
            </div>

            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black bg-opacity-50 hover:bg-opacity-70 text-white flex items-center justify-center transition-all"
            >
              <FaTimes size={16} />
            </button>
          </div>

          {/* User Info Section */}
          <div className="px-6 pt-16 pb-4">
            <h2
              className="text-2xl font-bold mb-1 flex items-center gap-2"
              style={{ color: color || "#ffffff" }}
            >
              {displayName}
              {isVerified && displayName === username && (
                <span
                  className="inline-flex items-center justify-center w-5 h-5 text-xs text-white bg-green-500 rounded-full"
                  title={t`User is authenticated`}
                >
                  ✓
                </span>
              )}
            </h2>
            {displayName !== username && (
              <p className="text-discord-text-muted text-sm flex items-center gap-1">
                @{username}
                {isVerified && (
                  <span
                    className="inline-flex items-center justify-center w-4 h-4 text-xs text-white bg-green-500 rounded-full"
                    title={t`User is authenticated`}
                  >
                    ✓
                  </span>
                )}
              </p>
            )}

            {/* Bot Description */}
            {botDescription && (
              <div className="mt-3 bg-discord-dark-300 rounded-lg p-3 flex items-center gap-3">
                <FaRobot className="text-cyan-400 flex-shrink-0" size={16} />
                <div className="text-white text-sm">{botDescription}</div>
              </div>
            )}

            {/* Homepage */}
            {sanitizedHomepage && (
              <div className="mt-3 bg-discord-dark-300 rounded-lg p-3 flex items-center gap-3">
                <FaGlobe className="text-blue-400 flex-shrink-0" size={16} />
                <a
                  href={sanitizedHomepage}
                  onClick={handleHomepageClick}
                  className="text-blue-400 hover:underline text-sm break-all cursor-pointer"
                >
                  {sanitizedHomepage}
                </a>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="h-px bg-gradient-to-r from-transparent via-discord-dark-400 to-transparent mx-6" />

          {/* Content - Scrollable */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {/* WHOIS Information */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-4">
                <FaInfoCircle className="text-discord-blurple" size={18} />
                <h3 className="text-lg font-semibold text-white">
                  <Trans>User Information</Trans>
                </h3>
              </div>

              {isLoadingWhois && (
                <div className="flex items-center gap-2 text-discord-text-muted text-sm py-8 justify-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-discord-blurple border-t-transparent" />
                  <Trans>Loading WHOIS data...</Trans>
                </div>
              )}

              {whoisData?.isComplete && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Username and Host */}
                  {whoisData.username && whoisData.host && (
                    <div className="bg-discord-dark-300 rounded-lg p-4 hover:bg-discord-dark-400 transition-colors">
                      <div className="flex items-center gap-2 mb-2">
                        <FaUserCheck className="text-green-400" size={14} />
                        <span className="text-xs font-semibold text-discord-text-muted uppercase tracking-wide">
                          <Trans>Host</Trans>
                        </span>
                      </div>
                      <code className="text-white font-mono text-sm break-all">
                        {whoisData.username}@{whoisData.host}
                      </code>
                    </div>
                  )}

                  {/* Real Name */}
                  {whoisData.realname && (
                    <div className="bg-discord-dark-300 rounded-lg p-4 hover:bg-discord-dark-400 transition-colors">
                      <div className="text-xs font-semibold text-discord-text-muted uppercase tracking-wide mb-2">
                        <Trans>Real Name</Trans>
                      </div>
                      <div className="text-white">{whoisData.realname}</div>
                    </div>
                  )}

                  {/* Account */}
                  {whoisData.account && (
                    <div className="bg-discord-dark-300 rounded-lg p-4 hover:bg-discord-dark-400 transition-colors">
                      <div className="flex items-center gap-2 mb-2">
                        <FaShieldAlt className="text-blue-400" size={14} />
                        <span className="text-xs font-semibold text-discord-text-muted uppercase tracking-wide">
                          <Trans>Authenticated Account</Trans>
                        </span>
                      </div>
                      <div className="text-white font-medium">
                        {whoisData.account}
                      </div>
                    </div>
                  )}

                  {/* Status */}
                  {status && (
                    <div className="bg-discord-dark-300 rounded-lg p-4 hover:bg-discord-dark-400 transition-colors">
                      <div className="text-xs font-semibold text-discord-text-muted uppercase tracking-wide mb-2">
                        <Trans>Status</Trans>
                      </div>
                      <div className="text-white">{status}</div>
                    </div>
                  )}

                  {pronouns && (
                    <div className="bg-discord-dark-300 rounded-lg p-4 hover:bg-discord-dark-400 transition-colors">
                      <div className="text-xs font-semibold text-discord-text-muted uppercase tracking-wide mb-2">
                        <Trans>Pronouns</Trans>
                      </div>
                      <div className="text-white">{pronouns}</div>
                    </div>
                  )}

                  {/* Server */}
                  {whoisData.server && (
                    <div className="bg-discord-dark-300 rounded-lg p-4 hover:bg-discord-dark-400 transition-colors">
                      <div className="flex items-center gap-2 mb-2">
                        <FaServer className="text-purple-400" size={14} />
                        <span className="text-xs font-semibold text-discord-text-muted uppercase tracking-wide">
                          <Trans>Connected To</Trans>
                        </span>
                      </div>
                      <code className="text-white font-mono text-sm break-all">
                        {whoisData.server}
                      </code>
                      {whoisData.serverInfo && (
                        <div className="text-discord-text-muted text-xs mt-1">
                          {whoisData.serverInfo}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Idle Time */}
                  {whoisData.idle !== undefined && (
                    <div className="bg-discord-dark-300 rounded-lg p-4 hover:bg-discord-dark-400 transition-colors">
                      <div className="flex items-center gap-2 mb-2">
                        <FaClock className="text-orange-400" size={14} />
                        <span className="text-xs font-semibold text-discord-text-muted uppercase tracking-wide">
                          <Trans>Idle</Trans>
                        </span>
                      </div>
                      <div className="text-white font-medium">
                        {formatIdleTime(whoisData.idle)}
                      </div>
                    </div>
                  )}

                  {/* Away Status */}
                  {user?.isAway && (
                    <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-lg p-4 hover:bg-yellow-900/30 transition-colors">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-yellow-400">●</span>
                        <span className="text-xs font-semibold text-yellow-400 uppercase tracking-wide">
                          <Trans>Away</Trans>
                        </span>
                      </div>
                      {user.awayMessage && (
                        <div className="text-white text-sm">
                          {user.awayMessage}
                        </div>
                      )}
                      {!user.awayMessage && (
                        <div className="text-discord-text-muted text-sm italic">
                          <Trans>User is away</Trans>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Channels - Full width */}
                  {whoisData.channels && (
                    <div className="bg-discord-dark-300 rounded-lg p-4 hover:bg-discord-dark-400 transition-colors md:col-span-2">
                      <div className="flex items-center gap-2 mb-3">
                        <FaHashtag className="text-yellow-400" size={14} />
                        <span className="text-xs font-semibold text-discord-text-muted uppercase tracking-wide">
                          <Trans>Channels</Trans>
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {parsedChannels.map(({ channel, status, isSecret }) => {
                          const badge = getStatusBadge(status);
                          return (
                            <button
                              type="button"
                              key={channel}
                              onClick={() => handleChannelClick(channel)}
                              className="flex items-center gap-2 bg-discord-dark-100 rounded px-3 py-2 hover:bg-discord-blurple transition-colors cursor-pointer text-left group"
                              title={t`Click to join ${channel}`}
                            >
                              {badge && (
                                <span
                                  className={`${badge.color} text-white text-xs font-bold px-1.5 py-0.5 rounded`}
                                  title={badge.label}
                                >
                                  {badge.text}
                                </span>
                              )}
                              <span className="text-white text-sm font-mono flex-1 truncate group-hover:text-white">
                                {channel}
                              </span>
                              {isSecret && (
                                <span
                                  className="text-discord-text-muted text-xs"
                                  title={t`Secret channel`}
                                >
                                  🔒
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Secure Connection */}
                  {whoisData.secureConnection && (
                    <div className="bg-gradient-to-r from-green-900/20 to-green-800/20 border border-green-700/30 rounded-lg p-4 md:col-span-2">
                      <div className="flex items-center gap-2 mb-2">
                        <FaShieldAlt className="text-green-400" size={14} />
                        <span className="text-xs font-semibold text-green-400 uppercase tracking-wide">
                          <Trans>Secure Connection</Trans>
                        </span>
                      </div>
                      <div className="text-white text-sm">
                        {whoisData.secureConnection}
                      </div>
                    </div>
                  )}

                  {/* Signed On */}
                  {whoisData.signon && (
                    <div className="bg-discord-dark-300 rounded-lg p-4 hover:bg-discord-dark-400 transition-colors">
                      <div className="flex items-center gap-2 mb-2">
                        <FaClock className="text-teal-400" size={14} />
                        <span className="text-xs font-semibold text-discord-text-muted uppercase tracking-wide">
                          <Trans>Signed On</Trans>
                        </span>
                      </div>
                      <div className="text-white font-medium text-sm">
                        {formatSignonTime(whoisData.signon)}
                      </div>
                    </div>
                  )}

                  {/* Special Messages */}
                  {whoisData.specialMessages &&
                    whoisData.specialMessages.length > 0 && (
                      <div className="bg-discord-dark-300 rounded-lg p-4">
                        <div className="text-xs font-semibold text-discord-text-muted uppercase tracking-wide mb-3">
                          <Trans>Additional Information</Trans>
                        </div>
                        <div className="space-y-2">
                          {whoisData.specialMessages.map((msg) => (
                            <div
                              key={msg}
                              className="text-white text-sm flex items-start gap-2"
                            >
                              <span className="text-discord-blurple mt-1">
                                •
                              </span>
                              <span>{msg}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              )}

              {!whoisData?.isComplete && !isLoadingWhois && (
                <div className="text-center py-12">
                  <div className="text-discord-text-muted text-sm">
                    <Trans>No WHOIS data available</Trans>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-discord-dark-300 border-t border-discord-dark-400">
            <div className="flex justify-between items-center gap-3">
              {isOwnProfile && (
                <>
                  {!onBack && (
                    <button
                      onClick={() => {
                        onClose();
                        toggleSettingsModal(true);
                      }}
                      className="px-6 py-2 bg-[#5865F2] hover:bg-[#4752C4] text-white rounded-lg font-medium transition-all hover:shadow-lg hover:shadow-[#5865F2]/20"
                    >
                      <Trans>Edit Profile</Trans>
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (server?.isAway) {
                        clearAway(serverId);
                      } else {
                        setAway(serverId);
                      }
                    }}
                    className={`px-6 py-2 rounded-lg font-medium transition-all ${
                      server?.isAway
                        ? "bg-green-600 hover:bg-green-700 text-white hover:shadow-lg hover:shadow-green-600/20"
                        : "bg-yellow-600 hover:bg-yellow-700 text-white hover:shadow-lg hover:shadow-yellow-600/20"
                    }`}
                  >
                    {server?.isAway ? (
                      <Trans>I'm Back</Trans>
                    ) : (
                      <Trans>Set Away</Trans>
                    )}
                  </button>
                </>
              )}
              {!isOwnProfile && (
                <button
                  onClick={() => {
                    openPrivateChat(serverId, username);
                    // Read fresh state after openPrivateChat updates the store
                    const freshServers = useStore.getState().servers;
                    const server = freshServers.find((s) => s.id === serverId);
                    const privateChat = server?.privateChats?.find(
                      (pc) =>
                        pc.username.toLowerCase() === username.toLowerCase(),
                    );
                    if (privateChat) {
                      selectPrivateChat(privateChat.id, { navigate: true });
                    }
                    onClose();
                  }}
                  className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-all hover:shadow-lg hover:shadow-green-600/20 flex items-center gap-2"
                  title={t`Send private message`}
                >
                  <FaUser size={14} />
                  <Trans>PM User</Trans>
                </button>
              )}
              <button
                onClick={onBack ?? onClose}
                className={`px-6 py-2 bg-discord-blurple hover:bg-discord-blurple-hover text-white rounded-lg font-medium transition-all hover:shadow-lg hover:shadow-discord-blurple/20 ${!isOwnProfile ? "ml-auto" : ""}`}
              >
                {onBack ? <Trans>← Back</Trans> : <Trans>Close</Trans>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
};

export default UserProfileModal;
