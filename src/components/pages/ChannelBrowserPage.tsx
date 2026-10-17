import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FaDesktop,
  FaHashtag,
  FaSearch,
  FaUsers,
  FaVolumeUp,
} from "react-icons/fa";
import { useJoinAndSelectChannel } from "../../hooks/useJoinAndSelectChannel";
import ircClient from "../../lib/ircClient";
import { getChannelAvatarUrl, serverFilehosts } from "../../lib/ircUtils";
import { canShowAvatarUrl, mediaLevelToSettings } from "../../lib/mediaUtils";
import { Button } from "../../lib/modal/components";
import { buttonClassName } from "../../lib/modal/components/Button";
import useStore, { type AppState } from "../../store";
import { PageShell } from "../ui/page/PageShell";
import { SkeletonRow } from "../ui/SkeletonRow";
import { TextInput } from "../ui/TextInput";
import type { PageProps } from "./PageHost";

type ListedChannel = AppState["channelList"][string][number];
type ChannelListFilters = NonNullable<AppState["channelListFilters"][string]>;

const PAGE_SIZE = 50;
const SKELETON_ROW_IDS = [0, 1, 2, 3, 4, 5];
const METADATA_TTL_MS = 5 * 60 * 1000;

// We match the CHANTYPES the ircd advertises, so each prefix gets its own icon.
function channelTypeMeta(name: string): {
  Icon: React.ComponentType<{ size?: number }>;
  color: string;
} {
  switch (name[0]) {
    case "^":
      return { Icon: FaVolumeUp, color: "text-discord-green" };
    case "$":
      return { Icon: FaDesktop, color: "text-discord-blue" };
    default:
      return { Icon: FaHashtag, color: "text-discord-text-muted" };
  }
}

const ChannelAvatar: React.FC<{ src: string | null; channel: string }> = ({
  src,
  channel,
}) => {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const { Icon, color } = channelTypeMeta(channel);
  if (src && src !== failedSrc) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setFailedSrc(src)}
        className="w-8 h-8 shrink-0 rounded-lg object-cover"
      />
    );
  }
  return (
    <span
      className={`w-8 h-8 shrink-0 rounded-lg bg-discord-dark-400 flex items-center justify-center ${color}`}
    >
      <Icon size={14} />
    </span>
  );
};

interface ChannelRowProps {
  channel: ListedChannel;
  avatarSrc: string | null;
  displayName?: string;
  joined: boolean;
  onOpen: () => void;
  onJoin: () => void;
}

const ChannelRow: React.FC<ChannelRowProps> = ({
  channel,
  avatarSrc,
  displayName,
  joined,
  onOpen,
  onJoin,
}) => (
  <button
    type="button"
    data-channel={channel.channel}
    aria-label={
      joined ? t`Open ${channel.channel}` : t`Join ${channel.channel}`
    }
    onClick={joined ? onOpen : onJoin}
    className="h-14 w-full flex items-center gap-3 px-3 text-left"
  >
    <ChannelAvatar src={avatarSrc} channel={channel.channel} />
    <span className="flex-1 min-w-0 flex flex-col">
      <span className="flex items-baseline gap-2 min-w-0">
        <span className="truncate text-[15px] text-white">
          {displayName || channel.channel.replace(/^[#^$]/, "")}
        </span>
        {displayName && (
          <span className="truncate text-xs text-discord-text-muted">
            {channel.channel}
          </span>
        )}
      </span>
      <span className="truncate text-[13px] text-discord-text-muted">
        {channel.topic || t`No topic`}
      </span>
    </span>
    <span className="shrink-0 flex items-center gap-1 text-[13px] text-discord-text-muted">
      <FaUsers size={11} />
      {channel.userCount}
    </span>
    <span className="w-20 shrink-0 flex justify-end">
      {joined ? (
        <span className="text-[13px] text-discord-text-muted">
          <Trans>Joined</Trans>
        </span>
      ) : (
        <span className={buttonClassName()}>
          <Trans>Join</Trans>
        </span>
      )}
    </span>
  </button>
);

const NumberFilter: React.FC<{
  label: string;
  value?: number;
  onChange: (value?: number) => void;
}> = ({ label, value, onChange }) => (
  <label className="flex flex-col gap-1 min-w-0 text-xs text-discord-text-muted">
    {label}
    <input
      type="number"
      min={0}
      placeholder="0"
      value={value ?? ""}
      onChange={(e) =>
        onChange(Number.parseInt(e.target.value, 10) || undefined)
      }
      className="field-input"
    />
  </label>
);

const ChannelBrowserPage: React.FC<PageProps<"channelBrowser">> = ({
  page,
}) => {
  const serverId = page.serverId;
  const server = useStore((s) => s.servers.find((x) => x.id === serverId));
  const listed = useStore((s) => s.channelList[serverId]);
  const isListing = useStore((s) => !!s.listingInProgress[serverId]);
  const metadataCache = useStore((s) => s.channelMetadataCache[serverId]);
  const storedFilters = useStore((s) => s.channelListFilters[serverId]);
  const mediaLevel = useStore((s) => s.globalSettings.mediaVisibilityLevel);
  const listChannels = useStore((s) => s.listChannels);
  const updateChannelListFilters = useStore((s) => s.updateChannelListFilters);
  const selectChannel = useStore((s) => s.selectChannel);
  const closePage = useStore((s) => s.closePage);
  const joinAndSelectChannel = useJoinAndSelectChannel();

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"alpha" | "users">("users");
  const [showFilters, setShowFilters] = useState(false);
  const [draftFilters, setDraftFilters] = useState<ChannelListFilters>(
    storedFilters ?? {},
  );
  const [shown, setShown] = useState(PAGE_SIZE);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listChannels(serverId);
  }, [serverId, listChannels]);

  const filehost = serverFilehosts(server);
  const mediaSettings = mediaLevelToSettings(mediaLevel);
  const elist = (server?.elist || "").toUpperCase();
  const joinedNames = new Set(
    server?.channels.map((c) => c.name.toLowerCase()),
  );

  const visible = useMemo(
    () =>
      (listed ?? [])
        .filter((c) => c.channel.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) =>
          sortBy === "alpha"
            ? a.channel.localeCompare(b.channel)
            : b.userCount - a.userCount,
        ),
    [listed, search, sortBy],
  );
  const total = visible.length;
  const displayed = visible.slice(0, shown);
  const isLoading = isListing || listed === undefined;
  const rowsKey = displayed.map((c) => c.channel).join("\n");

  const fetchMetadataForChannels = useCallback(
    (names: string[]) => {
      const state = useStore.getState();
      const now = Date.now();
      const toFetch = names.filter((name) => {
        const cached = state.channelMetadataCache[serverId]?.[name];
        const queued = state.channelMetadataFetchQueue[serverId]?.has(name);
        const fresh = cached && now - cached.fetchedAt < METADATA_TTL_MS;
        return !fresh && !queued;
      });
      if (toFetch.length === 0) return;

      useStore.setState((s) => ({
        channelMetadataFetchQueue: {
          ...s.channelMetadataFetchQueue,
          [serverId]: new Set([
            ...(s.channelMetadataFetchQueue[serverId] ?? []),
            ...toFetch,
          ]),
        },
      }));
      for (const name of toFetch) {
        ircClient.metadataGet(serverId, name, ["avatar", "display-name"]);
      }
    },
    [serverId],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: rowsKey changes whenever the rendered rows do
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const names = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => entry.target.getAttribute("data-channel"))
          .filter((name): name is string => !!name);
        if (names.length > 0) fetchMetadataForChannels(names);
      },
      { rootMargin: "100px", threshold: 0.1 },
    );
    for (const row of list.querySelectorAll("[data-channel]")) {
      observer.observe(row);
    }
    return () => observer.disconnect();
  }, [rowsKey, fetchMetadataForChannels]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || shown >= total) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setShown((n) => n + PAGE_SIZE);
      },
      { rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [shown, total]);

  const applyFilters = () => {
    const filters: ChannelListFilters = {
      ...draftFilters,
      mask: draftFilters.mask?.trim() || undefined,
      notMask: draftFilters.notMask?.trim() || undefined,
    };
    updateChannelListFilters(serverId, filters);
    listChannels(serverId, filters);
    setShown(PAGE_SIZE);
  };

  const patchFilters = (patch: Partial<ChannelListFilters>) =>
    setDraftFilters((draft) => ({ ...draft, ...patch }));

  const openChannel = (name: string) => {
    const channel = server?.channels.find(
      (c) => c.name.toLowerCase() === name.toLowerCase(),
    );
    if (!channel) return;
    selectChannel(channel.id, { navigate: true });
    closePage();
  };

  const joinChannel = (name: string) => {
    joinAndSelectChannel(serverId, name);
    closePage();
  };

  return (
    <PageShell
      title={t`Browse channels`}
      wide
      headerActions={
        !isLoading && (
          <span className="shrink-0 text-[13px] text-discord-text-muted">
            {plural(total, { one: "# channel", other: "# channels" })}
          </span>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <FaSearch
            size={13}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-discord-text-muted"
          />
          <TextInput
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setShown(PAGE_SIZE);
            }}
            placeholder={t`Search channels...`}
            className="field-input pl-9"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => {
            setSortBy(e.target.value as "alpha" | "users");
            setShown(PAGE_SIZE);
          }}
          aria-label={t`Choose sort order`}
          className="field-input w-auto shrink-0"
        >
          <option value="users">{t`Sort by users`}</option>
          <option value="alpha">{t`Sort by name`}</option>
        </select>
        <button
          type="button"
          aria-expanded={showFilters}
          onClick={() => setShowFilters((v) => !v)}
          className={buttonClassName("secondary")}
        >
          <Trans>Filters</Trans>
        </button>
      </div>

      {showFilters && (
        <div className="flex flex-col gap-3 rounded-md bg-discord-dark-400/30 p-3">
          {elist ? (
            <div className="grid grid-cols-2 gap-3">
              {elist.includes("U") && (
                <>
                  <NumberFilter
                    label={t`Min users`}
                    value={draftFilters.minUsers}
                    onChange={(v) => patchFilters({ minUsers: v })}
                  />
                  <NumberFilter
                    label={t`Max users`}
                    value={draftFilters.maxUsers}
                    onChange={(v) => patchFilters({ maxUsers: v })}
                  />
                </>
              )}
              {elist.includes("C") && (
                <>
                  <NumberFilter
                    label={t`Created after (min ago)`}
                    value={draftFilters.minCreationTime}
                    onChange={(v) => patchFilters({ minCreationTime: v })}
                  />
                  <NumberFilter
                    label={t`Created before (min ago)`}
                    value={draftFilters.maxCreationTime}
                    onChange={(v) => patchFilters({ maxCreationTime: v })}
                  />
                </>
              )}
              {elist.includes("T") && (
                <>
                  <NumberFilter
                    label={t`Topic set after (min ago)`}
                    value={draftFilters.minTopicTime}
                    onChange={(v) => patchFilters({ minTopicTime: v })}
                  />
                  <NumberFilter
                    label={t`Topic set before (min ago)`}
                    value={draftFilters.maxTopicTime}
                    onChange={(v) => patchFilters({ maxTopicTime: v })}
                  />
                </>
              )}
              {elist.includes("M") && (
                <label className="col-span-2 flex flex-col gap-1 text-xs text-discord-text-muted">
                  {t`Channel name mask`}
                  <TextInput
                    value={draftFilters.mask ?? ""}
                    onChange={(e) => patchFilters({ mask: e.target.value })}
                    placeholder={t`*channel*`}
                    className="field-input"
                  />
                </label>
              )}
              {elist.includes("N") && (
                <label className="col-span-2 flex flex-col gap-1 text-xs text-discord-text-muted">
                  {t`Exclude channel name mask`}
                  <TextInput
                    value={draftFilters.notMask ?? ""}
                    onChange={(e) => patchFilters({ notMask: e.target.value })}
                    placeholder={t`*spam*`}
                    className="field-input"
                  />
                </label>
              )}
            </div>
          ) : (
            <p className="text-[13px] text-discord-text-muted">
              <Trans>Filters are unavailable on this server</Trans>
            </p>
          )}
          <div className="flex justify-end">
            <Button onClick={applyFilters}>
              <Trans>Apply and refresh</Trans>
            </Button>
          </div>
        </div>
      )}

      <div
        ref={listRef}
        aria-busy={isLoading}
        className="page-card overflow-hidden"
      >
        {isLoading ? (
          SKELETON_ROW_IDS.map((id) => <SkeletonRow key={id} />)
        ) : displayed.length === 0 ? (
          <div className="h-14 flex items-center px-3 text-[13px] text-discord-text-muted">
            <Trans>No channels found. Change the search or filters.</Trans>
          </div>
        ) : (
          displayed.map((channel) => {
            const metadata = metadataCache?.[channel.channel];
            const avatarUrl = metadata?.avatar
              ? getChannelAvatarUrl(
                  {
                    avatar: { value: metadata.avatar, visibility: "public" },
                  },
                  32,
                )
              : null;
            const avatarSrc =
              avatarUrl && canShowAvatarUrl(avatarUrl, filehost, mediaSettings)
                ? avatarUrl
                : null;
            return (
              <ChannelRow
                key={channel.channel}
                channel={channel}
                avatarSrc={avatarSrc}
                displayName={metadata?.displayName}
                joined={joinedNames.has(channel.channel.toLowerCase())}
                onOpen={() => openChannel(channel.channel)}
                onJoin={() => joinChannel(channel.channel)}
              />
            );
          })
        )}
      </div>
      <div ref={sentinelRef} className="h-px" />
    </PageShell>
  );
};

export default ChannelBrowserPage;
