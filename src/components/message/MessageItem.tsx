import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type * as React from "react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useLongPress } from "../../hooks/useLongPress";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { formatCopyAuthor } from "../../lib/chatMarkdownCopy";
import { renderWithCustomEmoji, useEmojiResolver } from "../../lib/customEmoji";
import ircClient from "../../lib/ircClient";
import {
  isUrlFromFilehost,
  isUserVerified,
  processMarkdownInText,
  serverFilehosts,
} from "../../lib/ircUtils";
import {
  canShowMedia,
  extractMediaFromMessage,
  type MediaEntry,
  type MediaType,
  mediaLevelToSettings,
} from "../../lib/mediaUtils";
import { stripIrcFormatting } from "../../lib/messageFormatter";
import useStore, { loadSavedMetadata } from "../../store";
import type { MessageType, PrivateChat, User } from "../../types";
import MessageBottomSheet from "../mobile/MessageBottomSheet";
import { EnhancedLinkWrapper } from "../ui/LinkWrapper";
import type { CollapsibleMessageHandle } from "./CollapsibleMessage";
import { InviteMessage } from "./InviteMessage";
import {
  ActionMessage,
  CollapsibleMessage,
  DateSeparator,
  EventMessage,
  JsonLogMessage,
  LinkPreview,
  MessageAvatar,
  MessageHeader,
  MessageReply,
  ReactionsWithActions,
  StandardReplyNotification,
  SystemMessage,
  WhisperMessage,
} from "./index";
import { MediaPreview } from "./MediaPreview";
import { MessageStatusIndicator } from "./MessageStatusIndicator";

interface MessageItemProps {
  message: MessageType;
  showDate: boolean;
  showHeader: boolean;
  setReplyTo: (msg: MessageType) => void;
  onUsernameContextMenu: (
    e: React.MouseEvent,
    username: string,
    serverId: string,
    channelId: string,
    avatarElement?: Element | null,
  ) => void;
  onOpenProfile?: (username: string) => void;
  onIrcLinkClick?: (url: string) => void;
  onReactClick: (message: MessageType, buttonElement: Element) => void;
  joinChannel?: (serverId: string, channelName: string) => void;
  onReactionUnreact: (emoji: string, message: MessageType) => void;
  onOpenReactionModal: (
    message: MessageType,
    position: { x: number; y: number },
  ) => void;
  onDirectReaction: (emoji: string, message: MessageType) => void;
  serverId: string;
  channelId?: string;
  /** DM context only — used as the message store key for media viewer navigation. */
  privateChatId?: string;
  onRedactMessage?: (message: MessageType) => void;
  hideReply?: boolean;
  isHighlighted?: boolean;
}

// Helper function to get user metadata
const getUserMetadata = (username: string, serverId: string) => {
  // First check localStorage for saved metadata
  const savedMetadata = loadSavedMetadata();
  const serverMetadata = savedMetadata[serverId];
  if (serverMetadata?.[username]) {
    return serverMetadata[username];
  }

  // If not in localStorage, check if user is in any shared channels
  const state = useStore.getState();
  const server = state.servers.find((s) => s.id === serverId);
  if (!server) return null;

  // Search through all channels for this user
  for (const channel of server.channels) {
    const user = channel.users.find(
      (u) => u.username.toLowerCase() === username.toLowerCase(),
    );
    if (user?.metadata && Object.keys(user.metadata).length > 0) {
      return user.metadata;
    }
  }

  return null;
};

// Helper function to get full user object from shared channels
const getUserFromChannels = (username: string, serverId: string) => {
  const state = useStore.getState();
  const server = state.servers.find((s) => s.id === serverId);
  if (!server) return null;

  // Search through all channels for this user
  for (const channel of server.channels) {
    const user = channel.users.find(
      (u) => u.username.toLowerCase() === username.toLowerCase(),
    );
    if (user) {
      return user;
    }
  }

  return null;
};

// When index 0 has no preview (type null), the first known-type entry must be shown
// directly, not collapsed — otherwise there would be 0 visible previews before "Show more".
export function partitionMediaEntries(entries: MediaEntry[]) {
  const extraNullEntries = entries.slice(1).filter((e) => e.type === null);
  const allKnownEntries = entries.filter((e) => e.type !== null);
  const firstKnownNotAtZero =
    entries[0]?.type === null ? (allKnownEntries[0] ?? null) : null;
  const extraKnownEntries = allKnownEntries.slice(1);
  return { extraNullEntries, firstKnownNotAtZero, extraKnownEntries };
}

// Theme is set once at startup and does not change while the app is running.
// Reading it per-render via localStorage.getItem is unnecessary synchronous I/O.
const CURRENT_THEME = localStorage.getItem("theme") || "discord";

export const MessageItem = memo((props: MessageItemProps) => {
  const {
    message,
    showDate,
    showHeader,
    setReplyTo,
    onUsernameContextMenu,
    onOpenProfile,
    onIrcLinkClick,
    onReactClick,
    joinChannel,
    onReactionUnreact,
    onOpenReactionModal,
    onDirectReaction,
    serverId,
    channelId,
    privateChatId,
    onRedactMessage,
    hideReply,
    isHighlighted,
  } = props;
  const { t } = useLingui();
  // channelId is null in DMs (drives avatar lookup); privateChatId is the message store key.
  const mediaChannelId = channelId ?? privateChatId;
  const pmUserCache = useRef(new Map<string, User>());
  const isNarrowView = useMediaQuery();
  const isTouchDevice = useMediaQuery("(pointer: coarse)");
  const collapsibleRef = useRef<CollapsibleMessageHandle>(null);
  const [messageNeedsCollapsing, setMessageNeedsCollapsing] = useState(false);
  const messageRowRef = useRef<HTMLDivElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const longPress = useLongPress({
    onLongPress: () => setSheetOpen(true),
  });

  const handleMessageMouseEnter = () => {
    const el = messageRowRef.current;
    if (!el) return;
    const msgRect = el.getBoundingClientRect();
    // Toolbar: bottom-1 (4px from bottom), right-4 (16px from right), ~90px wide, ~32px tall
    const toolbarTop = msgRect.bottom - 4 - 32;
    const toolbarLeft = msgRect.right - 16 - 90;
    const toolbarRight = msgRect.right - 16;
    const toolbarBottom = msgRect.bottom - 4;

    for (const btn of el.querySelectorAll<HTMLElement>(
      ".copy-button, .inline-copy-button",
    )) {
      const r = btn.getBoundingClientRect();
      const overlaps =
        r.right > toolbarLeft &&
        r.left < toolbarRight &&
        r.bottom > toolbarTop &&
        r.top < toolbarBottom;
      if (overlaps) btn.classList.add("avoid-toolbar");
    }
  };

  const handleMessageMouseLeave = () => {
    for (const el of messageRowRef.current?.querySelectorAll(
      ".avoid-toolbar",
    ) ?? []) {
      el.classList.remove("avoid-toolbar");
    }
  };

  const ircCurrentUser = ircClient.getCurrentUser(message.serverId);
  const isCurrentUser = ircCurrentUser?.username === message.userId;

  // Get the user key using reactive selector
  const userKey = useStore(
    useCallback(
      (state) => {
        if (!serverId) return "none";

        if (!channelId) {
          const server = state.servers.find((s) => s.id === serverId);
          // Prefer channel user — covers current user who has no PrivateChat entry
          if (server) {
            const user = server.channels
              .flatMap((c) => c.users)
              .find(
                (u) =>
                  u.username.toLowerCase() === message.userId.toLowerCase(),
              );
            if (user) {
              return `channel-${user.id}`;
            }
          }
          const privateChat = server?.privateChats?.find(
            (pc) => pc.username === message.userId,
          );
          if (privateChat) {
            return `pm-${privateChat.id}`;
          }
          return "none";
        }

        const server = state.servers.find((s) => s.id === serverId);
        const channel = server?.channels.find((c) => c.id === channelId);
        const user = channel?.users.find(
          (user) => user.username === message.userId,
        );
        return user ? `channel-${user.id}` : "none";
      },
      [serverId, channelId, message.userId],
    ),
  );

  const rawMessageUser = useStore(
    useCallback(
      (state) => {
        if (userKey === "none") return undefined;

        if (userKey.startsWith("pm-")) {
          const privateChatId = userKey.slice(3);
          const privateChat = state.servers
            .find((s) => s.id === serverId)
            ?.privateChats?.find((pc) => pc.id === privateChatId);
          if (privateChat) return privateChat;
        } else if (userKey.startsWith("channel-")) {
          const userId = userKey.slice(8);
          const server = state.servers.find((s) => s.id === serverId);
          if (channelId) {
            const channel = server?.channels.find((c) => c.id === channelId);
            return channel?.users.find((user) => user.id === userId);
          }
          // DM context: no channelId, search all channels
          return server?.channels
            .flatMap((c) => c.users)
            .find((user) => user.id === userId);
        }

        return undefined;
      },
      [userKey, serverId, channelId],
    ),
  );

  const metadataChangeCounter = useStore(
    (state) => state.metadataChangeCounter,
  );

  // useMemo instead of useStore — safe to read localStorage without infinite loop via useSyncExternalStore
  // biome-ignore lint/correctness/useExhaustiveDependencies: metadataChangeCounter is intentional reactive trigger
  const pmUserMetadata = useMemo(() => {
    if (!userKey.startsWith("pm-")) return null;
    const pmUsername = (rawMessageUser as PrivateChat)?.username;
    if (!pmUsername || !serverId) return null;
    return getUserMetadata(pmUsername, serverId);
  }, [metadataChangeCounter, userKey, rawMessageUser, serverId]);

  const messageUser: User | undefined = useMemo(() => {
    if (!rawMessageUser) return undefined;

    // For PM users, rawMessageUser is the privateChat object
    // We need to construct a proper User object
    if (userKey.startsWith("pm-")) {
      const privateChat = rawMessageUser as PrivateChat;
      const user: User = {
        id: privateChat.id,
        username: privateChat.username,
        realname: "",
        account: "",
        isOnline: privateChat.isOnline ?? true,
        isAway: privateChat.isAway ?? false,
        status: "",
        isBot: false,
        isIrcOp: false,
        metadata: pmUserMetadata || {},
      };
      return user;
    }

    // For channel users, rawMessageUser is already a proper User object
    return rawMessageUser as User;
  }, [rawMessageUser, pmUserMetadata, userKey]);

  const avatarUrl = messageUser?.metadata?.avatar?.value;
  const displayName = messageUser?.metadata?.["display-name"]?.value;
  const userColor = messageUser?.metadata?.color?.value;
  const userStatus = messageUser?.metadata?.status?.value;
  const userPronouns = messageUser?.metadata?.pronouns?.value;
  const isSystem = message.type === "system";
  const isBot =
    messageUser?.isBot ||
    messageUser?.metadata?.bot?.value === "true" ||
    message.tags?.bot === "";
  const isVerified = isUserVerified(message.userId, message.tags);
  const isIrcOp = messageUser?.isIrcOp || false;

  // Check if message redaction is supported and possible
  const server = useStore(
    useCallback(
      (state) => state.servers.find((s) => s.id === message.serverId),
      [message.serverId],
    ),
  );
  // Origins trusted for uploaded media: vendor obby.world/FILEHOST plus the
  // tokenless draft/FILEHOST list. fileHostsKey is a stable memo dependency.
  const fileHosts = serverFilehosts(server);
  const fileHostsKey = fileHosts.join(" ");
  const mediaVisibilityLevel = useStore(
    useCallback((state) => state.globalSettings.mediaVisibilityLevel, []),
  );
  const { showSafeMedia, showTrustedSourcesMedia, showExternalContent } =
    mediaLevelToSettings(mediaVisibilityLevel);
  const enableMarkdownRendering = useStore(
    useCallback((state) => state.globalSettings.enableMarkdownRendering, []),
  );
  const openMedia = useStore(useCallback((state) => state.openMedia, []));
  const canRedact =
    !isSystem &&
    isCurrentUser &&
    !!message.msgid &&
    !!server?.capabilities?.includes("draft/message-redaction") &&
    !!onRedactMessage;
  const canReply = !hideReply && message.type === "message";

  // message.content is already combined for multiline messages by the IRC client
  const messageContent = message.content;

  // Author + time + raw markdown source, surfaced as data attributes so the
  // chat copy handler (chatMarkdownCopy) can rebuild a markdown transcript that
  // preserves authorship and markdown the rendered DOM would otherwise strip.
  const copyAuthor = formatCopyAuthor(displayName, message.userId, isSystem);
  const copyTime = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(message.timestamp)),
    [message.timestamp],
  );

  // draft/custom-emoji: gather pack URLs for this message's channel +
  // network in priority order so a channel pack can shadow a network
  // shortcode of the same name.
  const channelEmojiUrl = useMemo(() => {
    const ch = server?.channels.find((c) => c.id === channelId);
    return ch?.metadata?.["draft/emoji"]?.value;
  }, [server, channelId]);
  const { resolve: resolveEmoji } = useEmojiResolver([
    channelEmojiUrl,
    server?.emojiPackUrl,
  ]);

  const htmlContent = useMemo(() => {
    const keyPrefix = message.id || message.msgid || "msg";
    return renderWithCustomEmoji(
      messageContent,
      resolveEmoji,
      (subtext, key) =>
        processMarkdownInText(
          subtext,
          showExternalContent,
          enableMarkdownRendering,
          key,
        ),
      `${keyPrefix}-em`,
    );
  }, [
    messageContent,
    showExternalContent,
    enableMarkdownRendering,
    message.id,
    message.msgid,
    resolveEmoji,
  ]);

  // Create collapsible content wrapper
  const collapsibleContent = (
    <CollapsibleMessage
      ref={collapsibleRef}
      content={htmlContent}
      onNeedsCollapsing={setMessageNeedsCollapsing}
    />
  );

  const theme = CURRENT_THEME;
  const username = message.userId;

  // Strip IRC formatting codes so URL/image detection works even when the URL
  // is wrapped in bold, italic, underline, strikethrough, or color codes.
  const strippedContent = stripIrcFormatting(message.content);

  // A message with no whitespace is a single token (e.g. a bare URL)
  const isSingleToken = !/\s/.test(strippedContent.trim());

  // Kept for isFilehostImage prop passed to ImagePreview (EXIF banner)
  const isFilehostUrl = isUrlFromFilehost(strippedContent.trim(), fileHosts);

  // biome-ignore lint/correctness/useExhaustiveDependencies: strippedContent derived from message.content
  const mediaEntries = useMemo(() => {
    return extractMediaFromMessage(message).filter((e) =>
      canShowMedia(
        e.url,
        { showSafeMedia, showTrustedSourcesMedia, showExternalContent },
        fileHosts,
      ),
    );
  }, [strippedContent, mediaVisibilityLevel, fileHostsKey]);

  const [showAllImages, setShowAllImages] = useState(false);

  // Tracks async probe results for null-type entries (e.g. extensionless filehost URLs).
  // When ProbeablePreview resolves a type, it notifies us so canOpenMedia updates.
  const [resolvedProbeTypes, setResolvedProbeTypes] = useState<
    Map<string, MediaType>
  >(() => new Map());
  const handleTypeResolved = useCallback((url: string, type: MediaType) => {
    setResolvedProbeTypes((prev) => {
      if (prev.get(url) === type) return prev;
      const next = new Map(prev);
      next.set(url, type);
      return next;
    });
  }, []);

  const firstOpenableMedia = mediaEntries.find(
    (e) => e.type !== null || resolvedProbeTypes.has(e.url),
  );
  const canOpenMedia = !!firstOpenableMedia;
  const handleOpenMedia = firstOpenableMedia
    ? () =>
        openMedia(
          firstOpenableMedia.url,
          message.msgid,
          serverId,
          mediaChannelId ?? undefined,
        )
    : undefined;

  // Handle system messages
  if (isSystem) {
    return <SystemMessage message={message} onIrcLinkClick={onIrcLinkClick} />;
  }

  // Handle whisper messages (channel-context tag, ratified or draft variant)
  if (
    message.tags?.["+channel-context"] ||
    message.tags?.["channel-context"] ||
    message.tags?.["+draft/channel-context"] ||
    message.tags?.["draft/channel-context"]
  ) {
    return (
      <>
        {showDate && (
          <DateSeparator date={new Date(message.timestamp)} theme={theme} />
        )}
        <WhisperMessage
          message={message}
          showDate={showDate}
          showHeader={showHeader}
          messageUser={messageUser}
          setReplyTo={setReplyTo}
          onUsernameContextMenu={onUsernameContextMenu}
          onIrcLinkClick={onIrcLinkClick}
          onReactClick={onReactClick}
          onReactionUnreact={onReactionUnreact}
          onDirectReaction={onDirectReaction}
          onRedactMessage={onRedactMessage}
          canRedact={canRedact}
          ircCurrentUser={ircCurrentUser || undefined}
        />
      </>
    );
  }

  // Handle event messages (join, part, quit, nick, mode, kick)
  if (["join", "part", "quit", "nick", "mode", "kick"].includes(message.type)) {
    return (
      <>
        {showDate && (
          <DateSeparator date={new Date(message.timestamp)} theme={theme} />
        )}
        <EventMessage
          message={message}
          messageUser={messageUser}
          showDate={showDate}
          onUsernameContextMenu={onUsernameContextMenu}
        />
      </>
    );
  }

  // Handle invite messages
  if (message.type === "invite") {
    return (
      <>
        {showDate && (
          <DateSeparator date={new Date(message.timestamp)} theme={theme} />
        )}
        <InviteMessage
          message={message}
          messageUser={messageUser}
          onUsernameContextMenu={onUsernameContextMenu}
          joinChannel={joinChannel}
        />
      </>
    );
  }

  // Handle standard reply messages
  if (message.type === "standard-reply") {
    // Ensure all required standard reply properties are present
    if (
      message.standardReplyType &&
      message.standardReplyCommand &&
      message.standardReplyCode &&
      message.standardReplyMessage
    ) {
      return (
        <>
          {showDate && (
            <DateSeparator date={new Date(message.timestamp)} theme={theme} />
          )}
          <StandardReplyNotification
            type={message.standardReplyType}
            command={message.standardReplyCommand}
            code={message.standardReplyCode}
            message={message.standardReplyMessage}
            target={message.standardReplyTarget}
            context={message.standardReplyContext}
            timestamp={new Date(message.timestamp)}
            onIrcLinkClick={onIrcLinkClick}
          />
        </>
      );
    }
  }

  // Handle ACTION messages
  if (message.content.substring(0, 7) === "\u0001ACTION") {
    return (
      <>
        {showDate && (
          <DateSeparator date={new Date(message.timestamp)} theme={theme} />
        )}
        <ActionMessage
          message={message}
          showDate={showDate}
          messageUser={messageUser}
          onUsernameContextMenu={onUsernameContextMenu}
          setReplyTo={setReplyTo}
          onReactClick={onReactClick}
          onReactionUnreact={onReactionUnreact}
          onDirectReaction={onDirectReaction}
        />
      </>
    );
  }

  // Handle JSON log notices
  if (message.type === "notice" && message.jsonLogData) {
    return (
      <JsonLogMessage
        message={message}
        showDate={showDate}
        messageUser={messageUser}
        onUsernameContextMenu={onUsernameContextMenu}
        onIrcLinkClick={onIrcLinkClick}
        joinChannel={joinChannel}
      />
    );
  }

  // Handle regular messages
  const handleReactionClick = (emoji: string, currentUserReacted: boolean) => {
    if (currentUserReacted) {
      onReactionUnreact(emoji, message);
    } else {
      onDirectReaction(emoji, message);
    }
  };

  const handleAvatarClick = (e: React.MouseEvent) => {
    if (message.userId !== "system") {
      onUsernameContextMenu(
        e,
        username,
        message.serverId,
        message.channelId,
        e.currentTarget,
      );
    }
  };

  const handleUsernameClick = (e: React.MouseEvent) => {
    if (message.userId !== "system") {
      // Find the avatar element to position menu over it
      const messageElement = e.currentTarget.closest(".flex");
      const avatarElement = messageElement?.querySelector(".mr-4");
      onUsernameContextMenu(
        e,
        username,
        message.serverId,
        message.channelId,
        avatarElement,
      );
    }
  };

  const handleReplyUsernameClick = (e: React.MouseEvent) => {
    if (message.replyMessage) {
      // Find the avatar element to position menu over it
      const messageElement = e.currentTarget.closest(".flex");
      const avatarElement = messageElement?.querySelector(".mr-4");
      onUsernameContextMenu(
        e,
        message.replyMessage.userId,
        message.serverId,
        message.channelId,
        avatarElement,
      );
    }
  };

  const handleScrollToReply = () => {
    if (!message.replyMessage?.id) return;

    const targetElement = document.querySelector(
      `[data-message-id="${message.replyMessage.id}"]`,
    );

    if (targetElement) {
      // Scroll to the message
      targetElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      // Add flash animation
      targetElement.classList.add("message-flash");

      // Remove the class after animation completes
      setTimeout(() => {
        targetElement.classList.remove("message-flash");
      }, 2000);
    }
  };

  const isClickable =
    message.userId !== "system" && ircCurrentUser?.username !== username;

  return (
    <div
      ref={messageRowRef}
      data-message-id={message.id}
      data-md-author={copyAuthor}
      data-md-time={copyTime}
      data-md-source={messageContent}
      className={`px-4 hover:bg-discord-message-hover group relative transition-colors duration-150 ${
        showHeader ? "mt-4" : "py-0.5"
      }${isHighlighted ? " bg-primary/10 ring-1 ring-primary/30 rounded" : ""}${
        message.status === "pending"
          ? " opacity-60"
          : message.status === "failed"
            ? " opacity-60 line-through text-discord-red"
            : ""
      }`}
      onMouseEnter={handleMessageMouseEnter}
      onMouseLeave={handleMessageMouseLeave}
      onTouchStart={longPress.onTouchStart}
      onTouchMove={longPress.onTouchMove}
      onTouchEnd={longPress.onTouchEnd}
      onTouchCancel={longPress.onTouchCancel}
    >
      {showDate && (
        <DateSeparator date={new Date(message.timestamp)} theme={theme} />
      )}
      <div className="flex">
        <MessageAvatar
          userId={message.userId}
          avatarUrl={avatarUrl}
          userStatus={userStatus}
          pronouns={userPronouns}
          isAway={messageUser?.isAway}
          theme={theme}
          showHeader={showHeader}
          onClick={handleAvatarClick}
          isClickable={isClickable}
          serverId={message.serverId}
        />

        <div
          className={`flex-1 min-w-0 relative ${isCurrentUser ? "text-white" : "text-discord-text-normal"}`}
        >
          {showHeader && (
            <MessageHeader
              userId={message.userId}
              displayName={displayName}
              userColor={userColor}
              timestamp={new Date(message.timestamp)}
              theme={theme}
              isClickable={isClickable}
              onClick={handleUsernameClick}
              isBot={isBot}
              isVerified={isVerified}
              isIrcOp={isIrcOp}
            />
          )}

          <div className="relative min-w-0">
            {message.replyMessage && (
              <MessageReply
                replyMessage={message.replyMessage}
                theme={theme}
                onUsernameClick={handleReplyUsernameClick}
                onIrcLinkClick={onIrcLinkClick}
                onReplyClick={handleScrollToReply}
              />
            )}

            <EnhancedLinkWrapper onIrcLinkClick={onIrcLinkClick}>
              {isSingleToken &&
              mediaEntries.length === 1 &&
              mediaEntries[0].type !== null ? (
                // Known type: hide URL, show only the preview
                <MediaPreview
                  entry={mediaEntries[0]}
                  msgid={message.msgid}
                  isFilehostImage={isUrlFromFilehost(
                    mediaEntries[0].url,
                    fileHosts,
                  )}
                  serverId={message.serverId}
                  channelId={mediaChannelId}
                  onOpenProfile={onOpenProfile}
                />
              ) : (
                // Unknown type (needs probe) or multi-URL: show text body
                <div
                  className="overflow-hidden"
                  style={{
                    whiteSpace: "pre-wrap",
                    overflowWrap: "break-word",
                    wordBreak: "break-word",
                  }}
                >
                  {collapsibleContent}
                </div>
              )}
            </EnhancedLinkWrapper>

            {(message.status === "pending" || message.status === "failed") && (
              <span className="inline-flex" style={{ textDecoration: "none" }}>
                <MessageStatusIndicator
                  status={message.status}
                  onRetry={() =>
                    useStore.getState().resendFailedMessage(message.id)
                  }
                />
              </span>
            )}

            {/* Embedded media below text — first always visible,
                  known-type extras collapsed behind a "show more" toggle to prevent floods.
                  Null-type extras render inline since they show nothing if the probe fails. */}
            {!(
              isSingleToken &&
              mediaEntries.length === 1 &&
              mediaEntries[0].type !== null
            ) &&
              mediaEntries.length > 0 &&
              (() => {
                const {
                  extraNullEntries,
                  firstKnownNotAtZero,
                  extraKnownEntries,
                } = partitionMediaEntries(mediaEntries);
                return (
                  <div>
                    <MediaPreview
                      entry={mediaEntries[0]}
                      msgid={message.msgid}
                      isFilehostImage={isUrlFromFilehost(
                        mediaEntries[0].url,
                        fileHosts,
                      )}
                      serverId={message.serverId}
                      channelId={mediaChannelId}
                      onOpenProfile={onOpenProfile}
                      onTypeResolved={handleTypeResolved}
                    />
                    {extraNullEntries.map((entry) => (
                      <MediaPreview
                        key={entry.url}
                        entry={entry}
                        msgid={message.msgid}
                        isFilehostImage={false}
                        serverId={message.serverId}
                        channelId={mediaChannelId}
                        onOpenProfile={onOpenProfile}
                        onTypeResolved={handleTypeResolved}
                      />
                    ))}
                    {firstKnownNotAtZero && (
                      <MediaPreview
                        key={firstKnownNotAtZero.url}
                        entry={firstKnownNotAtZero}
                        msgid={message.msgid}
                        isFilehostImage={isUrlFromFilehost(
                          firstKnownNotAtZero.url,
                          fileHosts,
                        )}
                        serverId={message.serverId}
                        channelId={mediaChannelId}
                        onOpenProfile={onOpenProfile}
                      />
                    )}
                    {extraKnownEntries.length > 0 &&
                      (showAllImages ? (
                        <>
                          {extraKnownEntries.map((entry) => (
                            <MediaPreview
                              key={entry.url}
                              entry={entry}
                              msgid={message.msgid}
                              isFilehostImage={isUrlFromFilehost(
                                entry.url,
                                fileHosts,
                              )}
                              serverId={message.serverId}
                              channelId={mediaChannelId}
                              onOpenProfile={onOpenProfile}
                            />
                          ))}
                          <button
                            type="button"
                            className="mt-1 text-xs text-discord-text-muted hover:text-discord-text cursor-pointer underline"
                            onClick={() => setShowAllImages(false)}
                          >
                            <Trans>Show less</Trans>
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="mt-1 text-xs text-discord-text-muted hover:text-discord-text cursor-pointer underline"
                          onClick={() => setShowAllImages(true)}
                        >
                          <Plural
                            value={extraKnownEntries.length}
                            one="Show 1 more item"
                            other={`Show ${extraKnownEntries.length} more items`}
                          />
                        </button>
                      ))}
                  </div>
                );
              })()}

            {/* Render link preview if available */}
            {(message.linkPreviewTitle ||
              message.linkPreviewSnippet ||
              message.linkPreviewMeta) && (
              <LinkPreview
                title={message.linkPreviewTitle}
                snippet={message.linkPreviewSnippet}
                imageUrl={message.linkPreviewMeta}
                theme={theme}
                messageContent={message.content}
                serverId={serverId}
              />
            )}
          </div>

          <ReactionsWithActions
            message={message}
            currentUserUsername={ircCurrentUser?.username}
            onReactionClick={handleReactionClick}
            onReactClick={(el) => onReactClick(message, el)}
            onReplyClick={() => setReplyTo(message)}
            onRedactClick={
              canRedact ? () => onRedactMessage?.(message) : undefined
            }
            canRedact={canRedact}
            canReply={canReply}
            onOpenMedia={handleOpenMedia}
            canOpenMedia={canOpenMedia}
          />
        </div>
      </div>
      {isTouchDevice && (
        <MessageBottomSheet
          isOpen={sheetOpen}
          onClose={() => setSheetOpen(false)}
          onReply={
            canReply
              ? () => {
                  setReplyTo(message);
                  setSheetOpen(false);
                }
              : undefined
          }
          onReact={
            message.msgid
              ? (el: Element) => onReactClick(message, el)
              : undefined
          }
          onDelete={
            canRedact
              ? () => {
                  onRedactMessage?.(message);
                  setSheetOpen(false);
                }
              : undefined
          }
          onOpenMedia={
            handleOpenMedia
              ? () => {
                  handleOpenMedia();
                  setSheetOpen(false);
                }
              : undefined
          }
          canReply={canReply}
          canReact={!!message.msgid}
          canDelete={canRedact}
          canOpenMedia={canOpenMedia}
        />
      )}
    </div>
  );
});
MessageItem.displayName = "MessageItem";
