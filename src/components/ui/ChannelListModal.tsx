import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FaDesktop, FaHashtag, FaUsers, FaVolumeUp } from "react-icons/fa";
import { useJoinAndSelectChannel } from "../../hooks/useJoinAndSelectChannel";
import ircClient from "../../lib/ircClient";
import { getChannelAvatarUrl, serverFilehosts } from "../../lib/ircUtils";
import { canShowAvatarUrl, mediaLevelToSettings } from "../../lib/mediaUtils";
import { BaseModal } from "../../lib/modal/BaseModal";
import useStore from "../../store";
import { TextInput } from "./TextInput";

// Per-channel-prefix icon + label mapping. Mirrors the CHANTYPES the
// ircd advertises ("#^$"); anything else falls back to the text-channel
// hashtag glyph so unknown future prefixes still render something.
function channelTypeMeta(name: string): {
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  color: string;
} {
  switch (name[0]) {
    case "^":
      return { Icon: FaVolumeUp, label: "Voice", color: "text-discord-green" };
    case "$":
      return {
        Icon: FaDesktop,
        label: "Stream",
        color: "text-discord-blue",
      };
    default:
      return {
        Icon: FaHashtag,
        label: "Text",
        color: "text-discord-text-muted",
      };
  }
}

const ChannelListModal: React.FC = () => {
  const {
    servers,
    ui: { selectedServerId },
    channelList,
    channelMetadataCache,
    listingInProgress,
    channelListFilters,
    listChannels,
    updateChannelListFilters,
    toggleChannelListModal,
  } = useStore();

  const joinAndSelectChannel = useJoinAndSelectChannel();

  const selectedServer = servers.find((s) => s.id === selectedServerId);
  const filehost = serverFilehosts(selectedServer);
  const mediaSettings = mediaLevelToSettings(
    useStore((state) => state.globalSettings.mediaVisibilityLevel),
  );
  const elist = (selectedServer?.elist || "").toUpperCase();
  const rawChannels = selectedServerId
    ? channelList[selectedServerId] || []
    : [];
  const metadataCache = selectedServerId
    ? channelMetadataCache[selectedServerId] || {}
    : {};

  const [sortBy, setSortBy] = useState<"alpha" | "users">("users");
  const [filter, setFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [minUsers, setMinUsers] = useState<number>(0);
  const [maxUsers, setMaxUsers] = useState<number>(0);
  const [minCreationTime, setMinCreationTime] = useState<number>(0);
  const [maxCreationTime, setMaxCreationTime] = useState<number>(0);
  const [minTopicTime, setMinTopicTime] = useState<number>(0);
  const [maxTopicTime, setMaxTopicTime] = useState<number>(0);
  const [mask, setMask] = useState<string>("");
  const [notMask, setNotMask] = useState<string>("");
  const [displayedChannelsCount, setDisplayedChannelsCountState] =
    useState<number>(50);
  const [loadingMore, setLoadingMoreState] = useState<boolean>(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const channelRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevFilteredLengthRef = useRef<number>(0);
  const loadingMoreRef = useRef<boolean>(false);
  const displayedCountRef = useRef<number>(50);

  const setLoadingMore = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      const newValue =
        typeof value === "function" ? value(loadingMoreRef.current) : value;
      loadingMoreRef.current = newValue;
      setLoadingMoreState(newValue);
    },
    [],
  );

  const setDisplayedChannelsCount = useCallback(
    (value: number | ((prev: number) => number)) => {
      const newValue =
        typeof value === "function" ? value(displayedCountRef.current) : value;
      displayedCountRef.current = newValue;
      setDisplayedChannelsCountState(newValue);
    },
    [],
  );

  const filteredChannels = rawChannels
    .filter((channel) =>
      channel.channel.toLowerCase().includes(filter.toLowerCase()),
    )
    .sort((a, b) => {
      if (sortBy === "alpha") {
        return a.channel.localeCompare(b.channel);
      }
      return b.userCount - a.userCount;
    });

  const fetchMetadataForChannels = useCallback(
    (channelNames: string[]) => {
      if (!selectedServerId || channelNames.length === 0) return;

      const state = useStore.getState();
      const now = Date.now();
      const CACHE_TTL = 5 * 60 * 1000;

      const channelsToFetch = channelNames.filter((channelName) => {
        const cached = metadataCache[channelName];
        const queue = state.channelMetadataFetchQueue[selectedServerId];
        const alreadyQueued = queue?.has(channelName);
        const isCacheValid = cached && now - cached.fetchedAt < CACHE_TTL;
        return !isCacheValid && !alreadyQueued;
      });

      if (channelsToFetch.length === 0) return;

      const queue =
        state.channelMetadataFetchQueue[selectedServerId] || new Set();
      const newQueue = new Set(queue);
      for (const ch of channelsToFetch) {
        newQueue.add(ch);
      }

      useStore.setState((state) => ({
        channelMetadataFetchQueue: {
          ...state.channelMetadataFetchQueue,
          [selectedServerId]: newQueue,
        },
      }));

      channelsToFetch.forEach((channelName) => {
        ircClient.metadataGet(selectedServerId, channelName, [
          "avatar",
          "display-name",
        ]);
      });
    },
    [selectedServerId, metadataCache],
  );

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visibleChannels = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => entry.target.getAttribute("data-channel"))
          .filter((ch): ch is string => ch !== null);

        if (visibleChannels.length > 0) {
          fetchMetadataForChannels(visibleChannels);
        }
      },
      {
        root: null,
        rootMargin: "100px",
        threshold: 0.1,
      },
    );

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [fetchMetadataForChannels]);

  useEffect(() => {
    if (!observerRef.current) return;

    channelRefs.current.forEach((element) => {
      observerRef.current?.observe(element);
    });

    return () => {
      if (observerRef.current) {
        channelRefs.current.forEach((element) => {
          observerRef.current?.unobserve(element);
        });
      }
    };
  }, []);

  useEffect(() => {
    if (selectedServerId) {
      listChannels(selectedServerId);
    }
  }, [selectedServerId, listChannels]);

  useEffect(() => {
    if (selectedServerId && channelListFilters[selectedServerId]) {
      const filters = channelListFilters[selectedServerId];
      setMinUsers(filters.minUsers || 0);
      setMaxUsers(filters.maxUsers || 0);
      setMinCreationTime(filters.minCreationTime || 0);
      setMaxCreationTime(filters.maxCreationTime || 0);
      setMinTopicTime(filters.minTopicTime || 0);
      setMaxTopicTime(filters.maxTopicTime || 0);
      setMask(filters.mask || "");
      setNotMask(filters.notMask || "");
    }
  }, [selectedServerId, channelListFilters]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const isNearBottom = scrollTop + clientHeight >= scrollHeight - 100;

      if (
        isNearBottom &&
        !loadingMoreRef.current &&
        displayedCountRef.current < filteredChannels.length
      ) {
        setLoadingMore(true);
        setTimeout(() => {
          setDisplayedChannelsCount((prev) =>
            Math.min(prev + 50, filteredChannels.length),
          );
          setLoadingMore(false);
        }, 200);
      }
    };

    scrollContainer.addEventListener("scroll", handleScroll);
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [filteredChannels.length, setDisplayedChannelsCount, setLoadingMore]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (prevFilteredLengthRef.current !== filteredChannels.length) {
      setDisplayedChannelsCount(50);
      prevFilteredLengthRef.current = filteredChannels.length;
    }
  }, [filteredChannels.length, setDisplayedChannelsCount]);

  const applyFilters = () => {
    if (!selectedServerId) return;

    const filters = {
      minUsers: minUsers > 0 ? minUsers : undefined,
      maxUsers: maxUsers > 0 ? maxUsers : undefined,
      minCreationTime: minCreationTime > 0 ? minCreationTime : undefined,
      maxCreationTime: maxCreationTime > 0 ? maxCreationTime : undefined,
      minTopicTime: minTopicTime > 0 ? minTopicTime : undefined,
      maxTopicTime: maxTopicTime > 0 ? maxTopicTime : undefined,
      mask: mask.trim() || undefined,
      notMask: notMask.trim() || undefined,
    };

    updateChannelListFilters(selectedServerId, filters);
    listChannels(selectedServerId, filters);
  };

  const handleJoinChannel = (channelName: string) => {
    if (selectedServerId) {
      joinAndSelectChannel(selectedServerId, channelName);
      toggleChannelListModal(false);
    }
  };

  const setChannelRef = (
    channelName: string,
    element: HTMLDivElement | null,
  ) => {
    if (element) {
      channelRefs.current.set(channelName, element);
    } else {
      channelRefs.current.delete(channelName);
    }
  };

  const networkName =
    selectedServer?.networkName || selectedServer?.name || "Unknown Network";

  return (
    <BaseModal
      isOpen={true}
      onClose={() => toggleChannelListModal(false)}
      title={t`Channels on ${networkName}`}
      showCloseButton
      maxWidth="2xl"
      contentClassName="flex flex-col"
    >
      <div className="p-4 flex flex-col flex-1 min-h-0">
        <div className="mb-4 flex-shrink-0">
          <span className="bg-blue-600 text-white text-sm px-3 py-2 rounded-lg font-semibold shadow-sm">
            <Trans>Total: {filteredChannels.length}</Trans>
          </span>
        </div>

        <div className="mb-4 flex flex-col sm:flex-row gap-2 sm:gap-4 items-stretch sm:items-center flex-shrink-0">
          <TextInput
            placeholder={t`Filter channels...`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 bg-discord-dark-300 text-white px-3 py-2 rounded"
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "alpha" | "users")}
            className="bg-discord-dark-300 text-white px-3 py-2 rounded"
          >
            <option value="alpha">{t`Sort by Name`}</option>
            <option value="users">{t`Sort by Users`}</option>
          </select>
        </div>

        {/* Advanced Filters */}
        <div className="mb-4 flex-shrink-0">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="text-gray-300 hover:text-white text-sm mb-2 flex items-center gap-2"
          >
            <span>
              {showFilters ? "▼" : "▶"} <Trans>Advanced Filters</Trans>
            </span>
          </button>

          {showFilters && (
            <div className="bg-discord-dark-300 p-3 rounded space-y-3">
              <div className="grid grid-cols-1 gap-3">
                {elist.includes("U") && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        {t`Min Users`}
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={minUsers}
                        onChange={(e) =>
                          setMinUsers(Number.parseInt(e.target.value, 10) || 0)
                        }
                        className="w-full bg-discord-dark-400 text-white px-2 py-1 rounded text-sm"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        {t`Max Users`}
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={maxUsers}
                        onChange={(e) =>
                          setMaxUsers(Number.parseInt(e.target.value, 10) || 0)
                        }
                        className="w-full bg-discord-dark-400 text-white px-2 py-1 rounded text-sm"
                        placeholder="0"
                      />
                    </div>
                  </div>
                )}

                {elist.includes("C") && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        {t`Created After (min ago)`}
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={minCreationTime}
                        onChange={(e) =>
                          setMinCreationTime(
                            Number.parseInt(e.target.value, 10) || 0,
                          )
                        }
                        className="w-full bg-discord-dark-400 text-white px-2 py-1 rounded text-sm"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        {t`Created Before (min ago)`}
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={maxCreationTime}
                        onChange={(e) =>
                          setMaxCreationTime(
                            Number.parseInt(e.target.value, 10) || 0,
                          )
                        }
                        className="w-full bg-discord-dark-400 text-white px-2 py-1 rounded text-sm"
                        placeholder="0"
                      />
                    </div>
                  </div>
                )}

                {elist.includes("T") && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        {t`Topic Set After (min ago)`}
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={minTopicTime}
                        onChange={(e) =>
                          setMinTopicTime(
                            Number.parseInt(e.target.value, 10) || 0,
                          )
                        }
                        className="w-full bg-discord-dark-400 text-white px-2 py-1 rounded text-sm"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        {t`Topic Set Before (min ago)`}
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={maxTopicTime}
                        onChange={(e) =>
                          setMaxTopicTime(
                            Number.parseInt(e.target.value, 10) || 0,
                          )
                        }
                        className="w-full bg-discord-dark-400 text-white px-2 py-1 rounded text-sm"
                        placeholder="0"
                      />
                    </div>
                  </div>
                )}

                {elist.includes("M") && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      {t`Channel Name Mask`}
                    </label>
                    <TextInput
                      value={mask}
                      onChange={(e) => setMask(e.target.value)}
                      className="w-full bg-discord-dark-400 text-white px-2 py-1 rounded text-sm"
                      placeholder={t`*channel*`}
                    />
                  </div>
                )}

                {elist.includes("N") && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      {t`Exclude Channel Name Mask`}
                    </label>
                    <TextInput
                      value={notMask}
                      onChange={(e) => setNotMask(e.target.value)}
                      className="w-full bg-discord-dark-400 text-white px-2 py-1 rounded text-sm"
                      placeholder={t`*spam*`}
                    />
                  </div>
                )}

                {elist.length === 0 && (
                  <div className="text-sm text-gray-400 text-center py-2">
                    {t`Server doesn't support advanced LIST filtering`}
                  </div>
                )}
              </div>

              <button
                onClick={applyFilters}
                className="w-full bg-discord-primary hover:bg-discord-primary-hover text-white py-2 px-4 rounded text-sm font-medium"
              >
                <Trans>Apply Filters & Refresh</Trans>
              </button>
            </div>
          )}
        </div>

        {selectedServerId && listingInProgress[selectedServerId] && (
          <p className="text-gray-400 mb-4 flex-shrink-0">
            <Trans>Loading channels...</Trans>
          </p>
        )}

        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto overflow-x-hidden min-h-0"
        >
          <div className="space-y-2">
            {filteredChannels.length === 0 &&
              !(selectedServerId && listingInProgress[selectedServerId]) && (
                <p className="text-gray-400">
                  <Trans>No channels found.</Trans>
                </p>
              )}
            {filteredChannels
              .slice(0, displayedChannelsCount)
              .map((channel) => {
                const metadata = metadataCache[channel.channel];
                const avatarUrl = metadata?.avatar
                  ? getChannelAvatarUrl(
                      {
                        avatar: {
                          value: metadata.avatar,
                          visibility: "public",
                        },
                      },
                      32,
                    )
                  : null;
                const displayName = metadata?.displayName;
                const hasMetadata = !!(avatarUrl || displayName);

                return (
                  <div
                    key={channel.channel}
                    ref={(el) => setChannelRef(channel.channel, el)}
                    data-channel={channel.channel}
                    className="bg-discord-dark-300 p-3 rounded flex items-start gap-3 cursor-pointer hover:bg-discord-dark-400"
                    onClick={() => handleJoinChannel(channel.channel)}
                  >
                    <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center mt-0.5">
                      {(() => {
                        const canShowAvatar = canShowAvatarUrl(
                          avatarUrl,
                          filehost,
                          mediaSettings,
                        );
                        const { Icon, color } = channelTypeMeta(
                          channel.channel,
                        );
                        return (
                          <>
                            {canShowAvatar ? (
                              <img
                                src={avatarUrl ?? ""}
                                alt={channel.channel}
                                className="w-8 h-8 rounded-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                  const fallback = e.currentTarget
                                    .nextElementSibling as HTMLElement;
                                  if (fallback) fallback.style.display = "flex";
                                }}
                              />
                            ) : null}
                            <span
                              className={`w-8 h-8 rounded-full bg-discord-dark-400 items-center justify-center ${color}`}
                              style={{
                                display: canShowAvatar ? "none" : "flex",
                              }}
                            >
                              <Icon size={16} />
                            </span>
                          </>
                        );
                      })()}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {(() => {
                            const { Icon, color, label } = channelTypeMeta(
                              channel.channel,
                            );
                            return (
                              <span
                                title={`${label} channel`}
                                className={`flex-shrink-0 ${color}`}
                              >
                                <Icon size={12} />
                              </span>
                            );
                          })()}
                          <span className="text-white font-medium truncate">
                            {displayName ||
                              channel.channel.replace(/^[#^$]/, "")}
                          </span>
                          {hasMetadata &&
                            displayName &&
                            displayName !== channel.channel.substring(1) && (
                              <span className="text-xs bg-discord-dark-400 text-gray-300 px-2 py-0.5 rounded flex-shrink-0">
                                {channel.channel}
                              </span>
                            )}
                        </div>
                        <span className="text-gray-400 text-sm flex-shrink-0 flex items-center gap-1">
                          <FaUsers size={12} />
                          {channel.userCount}
                        </span>
                      </div>
                      <p className="text-gray-400 text-sm break-words mt-0.5">
                        {channel.topic || t`No topic`}
                      </p>
                    </div>
                  </div>
                );
              })}
            {loadingMore && (
              <div className="text-center py-4">
                <p className="text-gray-400 text-sm">
                  <Trans>Loading more channels...</Trans>
                </p>
              </div>
            )}
            {displayedChannelsCount < filteredChannels.length &&
              !loadingMore && (
                <div className="text-center py-4">
                  <p className="text-gray-500 text-xs">
                    <Trans>
                      Showing {displayedChannelsCount} of{" "}
                      {filteredChannels.length} channels
                    </Trans>
                  </p>
                </div>
              )}
          </div>
        </div>
      </div>
    </BaseModal>
  );
};

export default ChannelListModal;
