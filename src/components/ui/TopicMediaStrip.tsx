import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { FaFileAlt, FaPlay } from "react-icons/fa";
import { serverFilehosts } from "../../lib/ircUtils";
import { getCachedProbeResult, probeMediaUrl } from "../../lib/mediaProbe";
import type { MediaEntry, MediaType } from "../../lib/mediaUtils";
import {
  canShowMedia,
  extractMediaFromText,
  getEmbedThumbnailUrl,
  mediaLevelToSettings,
} from "../../lib/mediaUtils";
import useStore from "../../store";

const MAX_VISIBLE = 5;

export const TopicMediaStrip: React.FC = () => {
  const [resolvedTypes, setResolvedTypes] = useState<
    Map<string, MediaType | null>
  >(new Map());

  const mediaVisibilityLevel = useStore(
    (s) => s.globalSettings.mediaVisibilityLevel,
  );
  const servers = useStore((s) => s.servers);
  const selectedServerId = useStore((s) => s.ui.selectedServerId);
  const perServerSelections = useStore((s) => s.ui.perServerSelections);
  const { playMedia, openTopicMedia } = useStore();

  const selectedChannelId = selectedServerId
    ? (perServerSelections[selectedServerId]?.selectedChannelId ?? null)
    : null;

  const selectedChannel = useMemo(() => {
    if (!selectedServerId || !selectedChannelId) return null;
    const server = servers.find((s) => s.id === selectedServerId);
    return server?.channels.find((c) => c.id === selectedChannelId) ?? null;
  }, [selectedServerId, selectedChannelId, servers]);

  const topic = selectedChannel?.topic ?? null;

  const filehost = useMemo(
    () => serverFilehosts(servers.find((s) => s.id === selectedServerId)),
    [servers, selectedServerId],
  );

  const mediaSettings = useMemo(
    () => mediaLevelToSettings(mediaVisibilityLevel),
    [mediaVisibilityLevel],
  );

  const candidates = useMemo(() => {
    if (!topic) return [];
    return extractMediaFromText(topic).filter((e) =>
      canShowMedia(e.url, mediaSettings, filehost),
    );
  }, [topic, mediaSettings, filehost]);

  useEffect(() => {
    let cancelled = false;
    for (const entry of candidates) {
      if (entry.type !== null) continue;
      const cached = getCachedProbeResult(entry.url);
      if (cached !== undefined) {
        if (!cancelled) {
          setResolvedTypes((prev) =>
            new Map(prev).set(entry.url, cached?.type ?? null),
          );
        }
        continue;
      }
      probeMediaUrl(entry.url).then((result) => {
        if (!cancelled) {
          setResolvedTypes((prev) =>
            new Map(prev).set(entry.url, result?.type ?? null),
          );
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [candidates]);

  // Only show entries with a confirmed media type — skip anything still probing (undefined) or
  // confirmed non-media (null). Tiles appear after probe succeeds, never as a loading skeleton.
  const displayCandidates = candidates.filter(
    (e) => e.type !== null || resolvedTypes.get(e.url) != null,
  );

  if (displayCandidates.length === 0 || !selectedServerId || !selectedChannelId)
    return null;

  const visible = displayCandidates.slice(0, MAX_VISIBLE);
  const overflow = displayCandidates.length - MAX_VISIBLE;

  function resolveType(entry: MediaEntry): MediaType | null {
    return entry.type ?? resolvedTypes.get(entry.url) ?? null;
  }

  // Both are non-null here — we returned null above when either is missing
  const serverId = selectedServerId as string;
  const channelId = selectedChannelId as string;

  function handleClick(entry: MediaEntry) {
    const type = resolveType(entry);
    if (type === "audio" || type === "video") {
      playMedia(entry.url, type, undefined, undefined, serverId, channelId);
    } else {
      openTopicMedia(entry.url, serverId, channelId);
    }
  }

  return (
    <div className="h-8 flex items-center gap-1 px-2.5 shrink-0 border-b border-black/30 bg-[#1a1b1e] animate-in slide-in-from-top-2 duration-200">
      {/* thin left accent line */}
      <div className="w-0.5 h-4 rounded-full bg-white/10 shrink-0 mr-1" />
      <div className="flex items-center gap-1 overflow-x-auto min-w-0 scrollbar-none">
        {visible.map((entry) => {
          const type = resolveType(entry);
          return (
            <button
              key={entry.url}
              type="button"
              onClick={() => handleClick(entry)}
              title={entry.url}
              className="flex-shrink-0 w-6 h-6 rounded-sm overflow-hidden focus:outline-none opacity-60 hover:opacity-100 transition-opacity"
            >
              <Tile type={type} url={entry.url} />
            </button>
          );
        })}
        {overflow > 0 && (
          <span className="text-white/30 text-[10px] shrink-0 pl-0.5">
            +{overflow}
          </span>
        )}
      </div>
    </div>
  );
};

const Tile: React.FC<{ type: MediaType | null; url: string }> = ({
  type,
  url,
}) => {
  if (type === null) {
    return (
      <div className="w-6 h-6 rounded bg-discord-dark-200 animate-pulse" />
    );
  }

  if (type === "image") {
    return (
      <img
        src={url}
        alt=""
        className="w-6 h-6 rounded object-cover"
        loading="lazy"
      />
    );
  }

  if (type === "video") {
    return (
      <div className="relative w-6 h-6 rounded bg-discord-dark-200 overflow-hidden">
        <img src={url} alt="" className="w-6 h-6 object-cover" loading="lazy" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <FaPlay className="text-white" style={{ fontSize: 8 }} />
        </div>
      </div>
    );
  }

  if (type === "embed") {
    const thumb = getEmbedThumbnailUrl(url);
    return thumb ? (
      <div className="relative w-6 h-6 rounded overflow-hidden">
        <img
          src={thumb}
          alt=""
          className="w-6 h-6 object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <FaPlay className="text-white" style={{ fontSize: 8 }} />
        </div>
      </div>
    ) : (
      <div className="w-6 h-6 rounded bg-discord-dark-200 flex items-center justify-center">
        <FaPlay className="text-discord-text-muted text-xs" />
      </div>
    );
  }

  if (type === "audio") {
    return (
      <div className="w-6 h-6 rounded bg-discord-dark-200 flex items-center justify-center">
        <FaPlay className="text-discord-text-muted text-xs" />
      </div>
    );
  }

  if (type === "pdf") {
    return (
      <div className="w-6 h-6 rounded bg-discord-dark-200 flex items-center justify-center">
        <FaFileAlt className="text-discord-text-muted text-xs" />
      </div>
    );
  }

  return null;
};
