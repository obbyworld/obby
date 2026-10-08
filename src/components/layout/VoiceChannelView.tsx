// Discord-style voice channel UI. Mounted in place of ChatArea when the
// user has selected a `^` or `$` channel. The call itself is owned by
// voice.ts and survives this component unmounting; useVoiceCall only
// attaches a view onto it.
//
// Audio playback is funneled through a single hidden <audio> element
// owned by voice.ts so Safari's autoplay policies cooperate; video is
// rendered per-tile via VideoTrackView, bound to the inbound
// MediaStreamTrack.

import { Trans, useLingui } from "@lingui/react/macro";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FaTimes } from "react-icons/fa";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useVoiceCall } from "../../hooks/useVoiceCall";
import { releaseVoiceClient, type VoiceMember } from "../../lib/voice";
import { describeVoiceError } from "../../lib/voiceErrors";
import { useSpotlight, useTheater } from "../../lib/voiceSpotlight";
import useStore, { resolveCallReturnTarget } from "../../store";
import BottomSheet from "../mobile/BottomSheet";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import { VoiceAvatarBar } from "../voice/VoiceAvatarBar";
import { VoiceDock } from "../voice/VoiceDock";
import { VoiceStage } from "../voice/VoiceStage";
import { VoiceVideoBand } from "../voice/VoiceVideoBand";

interface Props {
  serverId: string;
  channelName: string;
}

// Mirrors `streamMaxStreamers` in hosted-backend/voice.go. The server is
// the source of truth; this is just for the "N/4 streaming" header label.
const STREAM_MAX_STREAMERS = 4;

export const VoiceChannelView: React.FC<Props> = ({
  serverId,
  channelName,
}) => {
  const { t } = useLingui();
  const {
    state,
    error,
    clearError,
    reactions,
    client,
    selfNick,
    self,
    isStreamRoom,
    isStreamer,
    isHost,
    streamers,
    streamerMembers,
    viewerMembers,
  } = useVoiceCall(serverId, channelName);

  const selectChannel = useStore((s) => s.selectChannel);
  const selectPrivateChat = useStore((s) => s.selectPrivateChat);
  const setMobileViewActiveColumn = useStore(
    (s) => s.setMobileViewActiveColumn,
  );
  const setSettingsNavigation = useStore((s) => s.setSettingsNavigation);
  const toggleSettingsModal = useStore((s) => s.toggleSettingsModal);

  // Nick of the explicitly spotlighted member, or null for the
  // stage's default layout (single tile / auto screen-share spotlight
  // / grid -- see VoiceStage). Shared with the pop-out via
  // voiceSpotlight.ts so the pick follows the user across both views.
  const [focusNick, setFocusNick] = useSpotlight(serverId, channelName);
  const [theater, setTheater] = useTheater(serverId, channelName);
  const [isViewerSheetOpen, setIsViewerSheetOpen] = useState(false);
  // Push-to-talk is purely a client-side toggle (not part of VoiceState),
  // so it's the one control mirrored into local state -- seeded from the
  // client whenever it changes so a remount picks up the real value.
  const [pttOn, setPttOn] = useState(false);

  const isNarrow = useMediaQuery();
  const isTouch = useIsTouchInput();
  const isLandscape = useMediaQuery("(orientation: landscape)");
  const hasStreamVideo = streamerMembers.some((m) => m.videoTrack);

  // Turning a phone sideways while a stream plays is how people ask to watch
  // it full screen, and turning it back is how they leave.
  // biome-ignore lint/correctness/useExhaustiveDependencies: we react to orientation changes only
  useEffect(() => {
    if (isTouch && isStreamRoom && hasStreamVideo) setTheater(isLandscape);
  }, [isLandscape]);

  useEffect(() => {
    if (client) setPttOn(client.isPushToTalk());
  }, [client]);

  useEffect(() => {
    if (!pttOn) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      if (!client?.isPushToTalk()) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      e.preventDefault();
      client.setMic(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (!client?.isPushToTalk()) return;
      client.setMic(false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [pttOn, client]);

  useEffect(() => {
    if (!theater) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTheater(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [theater, setTheater]);

  // Auto-clear an explicit spotlight when that member leaves the call.
  useEffect(() => {
    if (focusNick && !streamerMembers.find((m) => m.nick === focusNick)) {
      setFocusNick(null);
    }
  }, [focusNick, streamerMembers, setFocusNick]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: store actions have unstable refs
  const onLeave = useCallback(() => {
    releaseVoiceClient(serverId, channelName);
    const { ui } = useStore.getState();
    // On a narrow layout the channel list is a page of its own, and dropping
    // someone into a conversation they were not reading is worse than showing
    // them where they are. A wide layout already shows the list beside the
    // chat, so it can land on what they had open before the call.
    if (ui.isNarrowView) {
      selectChannel(null);
      setMobileViewActiveColumn("serverList");
      return;
    }
    const target = resolveCallReturnTarget(useStore.getState(), serverId);
    if (target?.type === "channel") selectChannel(target.id);
    else if (target?.type === "privateChat") selectPrivateChat(target.id);
  }, [serverId, channelName]);

  const onToggleMic = () => client?.setMic(!(self?.micOn ?? false));
  const onToggleVideo = () => void client?.setVideo(!(self?.videoOn ?? false));
  const onToggleScreen = () =>
    void client?.setScreenShare(!(self?.screenSharing ?? false));
  const deafened = self?.deafened ?? client?.isDeafened() ?? false;
  const onToggleDeafen = () => client?.setDeafened(!deafened);
  const onToggleHand = () =>
    client?.setHandRaised(!(self?.handRaised ?? false));
  const onTogglePtt = () => {
    const next = !pttOn;
    setPttOn(next);
    client?.setPushToTalk(next);
  };
  const onStepOffStream = () => client?.demote();
  const onOpenDeviceSettings = () => {
    setSettingsNavigation({ category: "calls" });
    toggleSettingsModal(true);
  };
  const onReact = (emoji: string) => client?.sendReaction(emoji);
  const onSetMuted = useCallback(
    (nick: string, muted: boolean) => client?.setMemberMuted(nick, muted),
    [client],
  );
  const onSetVolume = useCallback(
    (nick: string, volume: number) => client?.setMemberVolume(nick, volume),
    [client],
  );
  const onDemote = useCallback(
    (nick: string) => client?.demote(nick),
    [client],
  );
  const onPromote = useCallback(
    (nick: string) => client?.promote(nick),
    [client],
  );

  const canStepOffStream = isStreamRoom && isStreamer && !isHost;

  const statusLabel =
    state.phase === "joining"
      ? t`Connecting…`
      : state.phase === "failed"
        ? t`Reconnect failed`
        : state.phase === "connected"
          ? t`Live`
          : null;
  const statusDotClass =
    state.phase === "connected"
      ? "bg-discord-green"
      : state.phase === "failed"
        ? "bg-discord-red"
        : "bg-yellow-400 animate-pulse";

  // A phone shows a call above its chat, and full screen it shows only the
  // video, since there is no room left for chat beside it.
  const isFullscreenVideo =
    theater && isTouch && hasStreamVideo && state.phase === "connected";
  const isCompact = isNarrow && isTouch && !isFullscreenVideo;

  const rootClass = theater
    ? "fixed inset-0 z-[9990] flex flex-col bg-discord-dark-400"
    : "w-full min-h-0 flex flex-col bg-discord-dark-200";
  const safeAreaPadding = {
    paddingTop: "var(--safe-area-inset-top, 0px)",
    paddingBottom: "var(--safe-area-inset-bottom, 0px)",
    paddingLeft: "var(--safe-area-inset-left, 0px)",
    paddingRight: "var(--safe-area-inset-right, 0px)",
  };

  const dock = (
    <VoiceDock
      isNarrow={isNarrow}
      isTouch={isTouch}
      isStreamer={isStreamer}
      micOn={self?.micOn ?? false}
      videoOn={self?.videoOn ?? false}
      screenOn={self?.screenSharing ?? false}
      deafened={deafened}
      handRaised={self?.handRaised ?? false}
      pttOn={pttOn}
      canStepOffStream={canStepOffStream}
      onToggleMic={onToggleMic}
      onToggleVideo={onToggleVideo}
      onToggleScreen={onToggleScreen}
      onToggleDeafen={onToggleDeafen}
      onToggleHand={onToggleHand}
      onTogglePtt={onTogglePtt}
      onStepOffStream={onStepOffStream}
      onReact={onReact}
      onLeave={onLeave}
      onOpenDeviceSettings={onOpenDeviceSettings}
    />
  );

  const errorBanner = error && (
    <div className="pointer-events-auto max-w-md w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-discord-red/90 text-white text-sm shadow-lg">
      <span className="flex-1 min-w-0">{describeVoiceError(error)}</span>
      <button
        type="button"
        onClick={clearError}
        aria-label={t`Dismiss`}
        title={t`Dismiss`}
        className="flex-shrink-0 hover:opacity-80"
      >
        <FaTimes />
      </button>
    </div>
  );

  const viewerSheet = isStreamRoom && (
    <BottomSheet
      isOpen={isViewerSheetOpen}
      onClose={() => setIsViewerSheetOpen(false)}
    >
      <ViewerList
        viewers={viewerMembers}
        isHost={isHost}
        maxStreamers={STREAM_MAX_STREAMERS}
        streamerCount={streamers.length}
        onPromote={onPromote}
      />
    </BottomSheet>
  );

  const statusPill = (
    <span className="flex items-center gap-2 px-2 py-1 rounded-full bg-black/55 text-xs text-white flex-shrink-0">
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass}`}
        aria-hidden="true"
      />
      {statusLabel}
    </span>
  );
  const viewersButton = isStreamRoom && state.phase === "connected" && (
    <button
      type="button"
      onClick={() => setIsViewerSheetOpen(true)}
      title={t`See viewers`}
      aria-label={t`See viewers`}
      className="flex-shrink-0 px-2 py-1 rounded-full bg-black/55 text-xs text-white"
    >
      <Trans>{viewerMembers.length} watching</Trans>
    </button>
  );
  const videoBand = (
    <VoiceVideoBand
      members={streamerMembers}
      serverId={serverId}
      selfNick={selfNick}
      focusNick={focusNick}
      onFocus={setFocusNick}
      reactions={reactions}
      onSetMuted={onSetMuted}
      onSetVolume={onSetVolume}
      isHost={isHost}
      onDemote={onDemote}
      status={statusPill}
      actions={viewersButton}
      dock={dock}
      isFullscreen={isFullscreenVideo}
      onToggleFullscreen={() => setTheater(!theater)}
    />
  );

  if (isFullscreenVideo) {
    return createPortal(
      <div
        className="fixed inset-0 z-[9990] bg-black flex flex-col"
        style={safeAreaPadding}
      >
        {videoBand}
        {errorBanner && (
          <div className="absolute inset-x-3 top-14 flex justify-center">
            {errorBanner}
          </div>
        )}
        {viewerSheet}
      </div>,
      document.body,
    );
  }

  if (isCompact) {
    return (
      <div className="w-full flex flex-col bg-discord-dark-200">
        {state.phase !== "connected" && state.phase !== "failed" && (
          <div className="flex items-center justify-center py-6">
            <LoadingSpinner size="md" text="" />
          </div>
        )}
        {state.phase === "connected" && hasStreamVideo ? (
          <>
            <div className="[html[data-keyboard-open]_&]:hidden">
              {videoBand}
            </div>
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => (document.activeElement as HTMLElement)?.blur()}
              className="hidden [html[data-keyboard-open]_&]:flex items-center gap-2 px-3 py-2 bg-discord-dark-300 text-xs text-discord-text-normal"
            >
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass}`}
                aria-hidden="true"
              />
              <span className="flex-1 text-left">{statusLabel}</span>
              <span className="text-discord-text-link">
                <Trans>Show video</Trans>
              </span>
            </button>
          </>
        ) : (
          (state.phase === "connected" || state.phase === "failed") && (
            <>
              {(isStreamRoom || state.phase === "failed") && (
                <div className="flex items-center gap-2 px-3 pt-2">
                  {statusPill}
                  <span className="flex-1" />
                  {viewersButton}
                </div>
              )}
              <VoiceAvatarBar
                members={streamerMembers}
                serverId={serverId}
                dock={dock}
              />
            </>
          )
        )}
        {errorBanner && <div className="px-3 py-2">{errorBanner}</div>}
        {viewerSheet}
      </div>
    );
  }

  // Theater renders through a portal to document.body so its `fixed`
  // container is positioned against the real viewport -- nested in place,
  // an ancestor's transform (e.g. the narrow-view swipe container in
  // AppLayout) would otherwise become its containing block and confine
  // it to that ancestor's box instead of the window.
  const content = (
    <div className={rootClass} style={theater ? safeAreaPadding : undefined}>
      <div
        data-testid="voice-status-strip"
        className="h-9 flex-shrink-0 px-3 flex items-center gap-2 text-xs border-b border-discord-dark-300 bg-discord-dark-300/60 text-discord-text-muted"
      >
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass}`}
          aria-hidden="true"
        />
        <span className="truncate">{statusLabel}</span>
        {isStreamRoom && state.phase === "connected" && (
          <>
            <span className="px-1.5 py-0.5 rounded bg-discord-primary text-white flex-shrink-0">
              {isHost ? t`Host` : isStreamer ? t`Streamer` : t`Viewer`}
            </span>
            <span className="flex-shrink-0">
              <Trans>
                {streamerMembers.length}/{STREAM_MAX_STREAMERS} streaming ·{" "}
                {viewerMembers.length} watching
              </Trans>
            </span>
          </>
        )}
        <span className="flex-1" />
        {focusNick && streamerMembers.length > 1 && (
          <button
            type="button"
            onClick={() => setFocusNick(null)}
            title={t`Exit spotlight`}
            aria-label={t`Exit spotlight`}
            className="px-2 py-0.5 rounded hover:bg-discord-dark-400 text-discord-text-normal flex-shrink-0"
          >
            <Trans>Exit spotlight</Trans>
          </button>
        )}
      </div>

      <div
        className={
          theater
            ? "relative flex-1 min-h-0 flex flex-col bg-discord-dark-400"
            : "relative min-h-0 flex flex-col bg-discord-dark-400"
        }
      >
        <div
          className={
            theater
              ? "flex-1 min-h-0 overflow-hidden flex flex-col pb-20"
              : "min-h-[10rem] overflow-y-auto"
          }
        >
          {state.phase !== "connected" && state.phase !== "failed" && (
            <div className="flex items-center justify-center py-12">
              <LoadingSpinner size="md" text="" />
            </div>
          )}
          {state.phase === "connected" && streamerMembers.length > 0 && (
            <VoiceStage
              members={streamerMembers}
              serverId={serverId}
              selfNick={selfNick}
              focusNick={focusNick}
              onFocus={setFocusNick}
              reactions={reactions}
              onSetMuted={onSetMuted}
              onSetVolume={onSetVolume}
              isHost={isHost}
              onDemote={onDemote}
              theater={theater}
              onToggleTheater={() => setTheater(!theater)}
            />
          )}
          {state.phase === "connected" &&
            streamerMembers.length === 0 &&
            !isStreamRoom && (
              <p className="text-discord-text-muted text-sm italic mt-8 text-center px-4">
                <Trans>
                  Nobody's here. Ask someone to /join {channelName}.
                </Trans>
              </p>
            )}
          {isStreamRoom && !theater && state.phase === "connected" && (
            <ViewerList
              viewers={viewerMembers}
              isHost={isHost}
              maxStreamers={STREAM_MAX_STREAMERS}
              streamerCount={streamers.length}
              onPromote={onPromote}
            />
          )}
        </div>

        <div
          className={`flex flex-col items-center gap-2 px-3 ${
            theater
              ? "pointer-events-none absolute inset-x-0 bottom-4"
              : "flex-shrink-0 py-2"
          }`}
        >
          {errorBanner}
          <div className="pointer-events-auto">{dock}</div>
        </div>
      </div>
    </div>
  );

  return theater ? createPortal(content, document.body) : content;
};

function ViewerList({
  viewers,
  isHost,
  maxStreamers,
  streamerCount,
  onPromote,
}: {
  viewers: VoiceMember[];
  isHost: boolean;
  maxStreamers: number;
  streamerCount: number;
  onPromote: (nick: string) => void;
}) {
  const { t } = useLingui();
  return (
    <div className="mt-6 px-4 pb-4">
      <h3 className="text-discord-text-muted text-xs uppercase mb-2">
        <Trans>Viewers ({viewers.length})</Trans>
      </h3>
      {viewers.length === 0 ? (
        <p className="text-xs text-discord-text-muted italic">
          <Trans>No viewers yet.</Trans>
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {viewers.map((v) => (
            <span
              key={v.nick}
              className="px-2 py-1 rounded bg-discord-dark-300 text-xs text-discord-text-normal flex items-center gap-2"
            >
              {v.nick}
              {isHost && streamerCount < maxStreamers && (
                <button
                  type="button"
                  onClick={() => onPromote(v.nick)}
                  className="text-xs text-discord-primary hover:underline"
                  title={t`Invite to stream`}
                >
                  <Trans>Invite</Trans>
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default VoiceChannelView;
