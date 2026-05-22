import { ArrowLeftIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { EmojiClickData } from "emoji-picker-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { FaPlus } from "react-icons/fa";
import { useShallow } from "zustand/react/shallow";
import { useAutoFocusTyping } from "../../hooks/useAutoFocusTyping";
import { useMentionAutocorrectGuard } from "../../hooks/useMentionAutocorrectGuard";
import { useMessageSending } from "../../hooks/useMessageSending";
import { useReactions } from "../../hooks/useReactions";
import { useScrollToBottom } from "../../hooks/useScrollToBottom";
import { useTypingNotification } from "../../hooks/useTypingNotification";
import { canShowImageUrl } from "../../lib/imageUtils";
import ircClient from "../../lib/ircClient";
import { serverFilehosts } from "../../lib/ircUtils";
import {
  detectMediaType,
  getEmbedThumbnailUrl,
  imageCanHaveTransparency,
} from "../../lib/mediaUtils";
import {
  type FormattingType,
  getPreviewStyles,
  stripIrcFormatting,
} from "../../lib/messageFormatter";
import { isMobileDevice, isTauriMobile } from "../../lib/platformUtils";
import useStore from "../../store";
import type { Message } from "../../types";
import { MessageItem } from "../message/MessageItem";
import { MessageReactions } from "../message/MessageReactions";
import AutocompleteDropdown from "./AutocompleteDropdown";
import ColorPicker from "./ColorPicker";
import { EmojiPickerInline } from "./EmojiPickerInline";
import { EmojiPickerModal } from "./EmojiPickerModal";
import { InputToolbar } from "./InputToolbar";
import ReactionModal from "./ReactionModal";
import { ReactionPopover } from "./ReactionPopover";
import { ScrollToBottomButton } from "./ScrollToBottomButton";
import { TextArea } from "./TextInput";

interface MediaCommentsSidebarProps {
  sourceMessage: Message;
  currentImageUrl: string;
  serverId: string;
  channelId: string;
  isAlbum: boolean;
  isMobile: boolean;
  onClose: () => void;
  onCloseAll: () => void;
  onImageClick: (url: string) => void;
}

export function MediaCommentsSidebar({
  sourceMessage,
  currentImageUrl,
  serverId,
  channelId,
  isAlbum,
  isMobile,
  onClose,
  onCloseAll,
  onImageClick,
}: MediaCommentsSidebarProps) {
  const [commentText, setCommentText] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [isEmojiSelectorOpen, setIsEmojiSelectorOpen] = useState(false);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedFormatting, setSelectedFormatting] = useState<
    FormattingType[]
  >([]);
  const [reactionAnchorRect, setReactionAnchorRect] = useState<DOMRect | null>(
    null,
  );
  const sidebarRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isHoveredRef = useRef(false);

  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;
    const onEnter = () => {
      isHoveredRef.current = true;
    };
    const onLeave = () => {
      isHoveredRef.current = false;
    };
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  useAutoFocusTyping(textareaRef, () => !isHoveredRef.current);

  const isNativeMobile = isTauriMobile();
  const isMobileInput = isMobileDevice();
  // Cache line-height + padding after first read — same pattern as ChatArea
  const textareaMetricsRef = useRef<{
    lineHeight: number;
    paddingTop: number;
    paddingBottom: number;
  } | null>(null);

  const { mediaVisibilityLevel, sendTypingNotifications } = useStore(
    (state) => state.globalSettings,
  );
  const filehost = serverFilehosts(
    useStore.getState().servers.find((s) => s.id === serverId),
  );

  // Look up Channel object — useMessageSending needs channel.name for PRIVMSG target
  const selectedChannel = useStore((state) => {
    for (const server of state.servers) {
      if (server.id === serverId) {
        return server.channels.find((c) => c.id === channelId) ?? null;
      }
    }
    return null;
  });

  const channelName = selectedChannel?.name ?? null;
  const currentUser = ircClient.getCurrentUser(serverId);
  const redactMessage = useStore((state) => state.redactMessage);
  const onBeforeInputGuard = useMentionAutocorrectGuard(
    selectedChannel?.users.map((u) => u.username) ?? [],
  );

  const {
    directReaction,
    unreact,
    reactionModal,
    openReactionModal,
    closeReactionModal,
    selectReaction,
  } = useReactions({
    selectedServerId: serverId,
    currentUser,
  });

  const { isScrolledUp, wasAtBottomRef, scrollToBottom } = useScrollToBottom(
    scrollContainerRef,
    bottomRef,
    { channelId },
  );

  const typingNotification = useTypingNotification({
    serverId,
    enabled: sendTypingNotifications,
  });

  // Read live reactions from store — reactionModal.message is stale after optimistic updates.
  // useShallow ensures reference stability: same emoji strings → same array ref → no re-render loop.
  const reactedEmojis = useStore(
    useShallow((state) => {
      const msg = reactionModal.message;
      if (!msg) return [];
      const key = `${msg.serverId}-${msg.channelId}`;
      const live =
        (state.messages[key] ?? []).find((m) => m.id === msg.id) ?? msg;
      return live.reactions
        .filter((r) => r.userId === currentUser?.username)
        .map((r) => r.emoji);
    }),
  );

  // useMessageSending handles reply tag, IRC formatting, long-message splitting
  // localReplyTo = sourceMessage means every send gets @+draft/reply=<msgid> prepended
  const { sendMessage } = useMessageSending({
    selectedServerId: serverId,
    selectedChannelId: channelId,
    selectedPrivateChatId: null,
    selectedChannel,
    selectedPrivateChat: null,
    currentUser,
    selectedColor,
    selectedFormatting,
    localReplyTo: sourceMessage,
  });

  // Live source message — re-reads from store so reactions update in real time
  const liveSourceMessage = useStore(
    useShallow((state) => {
      const key = `${serverId}-${channelId}`;
      return (
        (state.messages[key] ?? []).find((m) => m.id === sourceMessage.id) ??
        sourceMessage
      );
    }),
  );

  // Live comments — useShallow prevents infinite loop from filter() returning a new array ref each call
  const comments = useStore(
    useShallow((state) => {
      const sourceMsgId = sourceMessage.msgid?.trim();
      if (!sourceMsgId) return [];
      const key = `${serverId}-${channelId}`;
      return (state.messages[key] ?? []).filter(
        (m) =>
          (m.tags?.["+reply"] ?? m.tags?.["+draft/reply"])?.trim() ===
          sourceMsgId,
      );
    }),
  );

  const toggleFormatting = (format: FormattingType) => {
    setSelectedFormatting((prev) =>
      prev.includes(format)
        ? prev.filter((f) => f !== format)
        : [...prev, format],
    );
  };

  const handleSend = () => {
    if (!commentText.trim() || !sourceMessage.msgid) return;
    sendMessage(commentText);
    setCommentText("");
    if (channelName) typingNotification.notifyTypingDone(channelName);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isNativeMobile) return;
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleEmojiSelect = (emojiData: EmojiClickData) => {
    setCommentText((prev) => prev + emojiData.emoji);
    setIsEmojiSelectorOpen(false);
  };

  const trackCursor = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    setCursorPosition((e.target as HTMLTextAreaElement).selectionStart ?? 0);
  };

  const handleUsernameSelect = (username: string) => {
    // Replace the @-word before cursor (or just insert @username if @ button triggered)
    const before = commentText.slice(0, cursorPosition);
    const after = commentText.slice(cursorPosition);
    const atIndex = before.lastIndexOf("@");
    const newText =
      atIndex >= 0
        ? `${before.slice(0, atIndex)}@${username} ${after}`
        : `${before}@${username} ${after}`;
    setCommentText(newText);
    setShowMentionDropdown(false);
    textareaRef.current?.focus();
  };

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (!textareaMetricsRef.current) {
      const computed = window.getComputedStyle(textarea);
      textareaMetricsRef.current = {
        lineHeight: Number.parseFloat(computed.lineHeight) || 20,
        paddingTop: Number.parseFloat(computed.paddingTop) || 0,
        paddingBottom: Number.parseFloat(computed.paddingBottom) || 0,
      };
    }
    const { lineHeight, paddingTop, paddingBottom } =
      textareaMetricsRef.current;
    const maxHeight = lineHeight * 5 + paddingTop + paddingBottom;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: commentText drives resize
  useLayoutEffect(() => {
    resizeTextarea();
  }, [resizeTextarea, commentText]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: wasAtBottomRef is a stable ref
  useEffect(() => {
    if (wasAtBottomRef.current) scrollToBottom();
  }, [comments, scrollToBottom]);

  const sourceText = stripIrcFormatting(liveSourceMessage.content);
  const commentCount = comments.length;
  // Only apply previewStyle when the user has actually chosen formatting/color.
  // getPreviewStyles always returns color:"inherit" as a fallback, which as an
  // inline style overrides the Tailwind text-discord-text-normal class and makes
  // the text inherit the browser default (black) in the modal's DOM tree.
  const hasExplicitColor =
    selectedColor !== null && selectedColor !== "inherit";
  const hasActiveFormatting = hasExplicitColor || selectedFormatting.length > 0;
  const previewStyle = hasActiveFormatting
    ? {
        ...getPreviewStyles({
          color: selectedColor ?? "inherit",
          formatting: selectedFormatting,
        }),
        // Don't let getPreviewStyles inject color:"inherit" as an inline style when no
        // color is chosen — that overrides the Tailwind text class and makes text black.
        ...(hasExplicitColor ? {} : { color: undefined }),
      }
    : undefined;

  return (
    <div
      ref={sidebarRef}
      data-comments-sidebar=""
      className="flex flex-col w-full h-full bg-discord-dark-200 border-l border-white/[0.06]"
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 pb-3 pt-3 border-b border-white/[0.06] flex-shrink-0"
        style={
          isMobile
            ? {
                paddingTop: "calc(0.75rem + var(--safe-area-inset-top, 0px))",
              }
            : undefined
        }
      >
        {isMobile ? (
          <>
            <button
              type="button"
              onClick={onClose}
              aria-label={t`Back to image`}
              className="p-1.5 rounded-full hover:bg-white/10 text-discord-text-muted hover:text-discord-text-normal transition-colors"
            >
              <ArrowLeftIcon className="w-4 h-4" />
            </button>
            <span className="flex-1 text-sm font-semibold text-discord-text-normal truncate">
              <Trans>Comments</Trans>
              {commentCount > 0 && (
                <span className="ml-1.5 text-discord-text-muted font-normal">
                  ({commentCount})
                </span>
              )}
              {channelName && (
                <span className="ml-1.5 text-xs text-discord-text-muted font-normal">
                  {channelName}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={onCloseAll}
              aria-label={t`Close viewer`}
              className="p-1.5 rounded-full hover:bg-white/10 text-discord-text-muted hover:text-discord-text-normal transition-colors"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <span className="flex-1 text-sm font-semibold text-discord-text-normal truncate">
              <Trans>Comments</Trans>
              {commentCount > 0 && (
                <span className="ml-1.5 text-discord-text-muted font-normal">
                  ({commentCount})
                </span>
              )}
              {channelName && (
                <span className="ml-1.5 text-xs text-discord-text-muted font-normal">
                  {channelName}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t`Close comments`}
              className="p-1.5 rounded-full hover:bg-white/10 text-discord-text-muted hover:text-discord-text-normal transition-colors"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      {/* Context strip */}
      <div className="flex items-start gap-2.5 px-3 py-2.5 bg-discord-dark-100 border-b border-white/[0.06] flex-shrink-0">
        {(() => {
          const mediaType = detectMediaType(currentImageUrl);
          const embedThumb =
            mediaType === "embed"
              ? getEmbedThumbnailUrl(currentImageUrl)
              : null;
          if (
            mediaType === "image" &&
            canShowImageUrl(currentImageUrl, mediaVisibilityLevel, filehost)
          ) {
            return (
              <img
                src={currentImageUrl}
                alt=""
                className={`w-10 h-10 rounded object-cover flex-shrink-0 ${imageCanHaveTransparency(currentImageUrl) ? "transparency-grid" : ""}`}
                draggable={false}
              />
            );
          }
          if (embedThumb) {
            return (
              <img
                src={embedThumb}
                alt=""
                className="w-10 h-10 rounded object-cover flex-shrink-0"
                draggable={false}
              />
            );
          }
          if (mediaType && mediaType !== "image") {
            return (
              <div className="w-10 h-10 rounded flex-shrink-0 bg-discord-dark-400 flex items-center justify-center text-discord-text-muted text-xs font-bold uppercase">
                {mediaType === "video"
                  ? "VID"
                  : mediaType === "audio"
                    ? "AUD"
                    : mediaType === "pdf"
                      ? "PDF"
                      : "▶"}
              </div>
            );
          }
          return null;
        })()}
        <div className="min-w-0 flex-1">
          <p className="text-xs text-discord-text-muted leading-tight">
            {isAlbum
              ? t`Album`
              : (() => {
                  const mt = detectMediaType(currentImageUrl);
                  if (mt === "video") return t`Video`;
                  if (mt === "audio") return t`Audio`;
                  if (mt === "pdf") return t`PDF`;
                  if (mt === "embed") return t`Embed`;
                  return t`Image`;
                })()}{" "}
            · @{liveSourceMessage.userId}
          </p>
          <p className="text-xs text-discord-text-normal/80 leading-snug mt-0.5 line-clamp-2 break-words">
            {sourceText}
          </p>
          <MessageReactions
            reactions={liveSourceMessage.reactions}
            currentUserUsername={currentUser?.username}
            alwaysShowAdd
            onReactionClick={(emoji, currentUserReacted) => {
              if (currentUserReacted) {
                unreact(emoji, liveSourceMessage);
              } else {
                directReaction(emoji, liveSourceMessage);
              }
            }}
            onAddReaction={(el) => {
              setReactionAnchorRect(el.getBoundingClientRect());
              openReactionModal(liveSourceMessage);
            }}
          />
        </div>
      </div>

      {/* Comments list — event delegation catches img clicks from MessageItem */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto py-2 min-h-0"
        onClick={(e) => {
          const img = (e.target as Element).closest("img");
          if (img) {
            const src = img.getAttribute("src");
            if (src) onImageClick(src);
          }
        }}
      >
        {comments.length === 0 ? (
          <p className="text-center text-xs text-discord-text-muted px-4 py-6">
            <Trans>No comments yet. Be the first!</Trans>
          </p>
        ) : (
          comments.map((comment) => (
            <MessageItem
              key={comment.id}
              message={{ ...comment, replyMessage: null }}
              showDate={false}
              showHeader={true}
              hideReply={true}
              setReplyTo={() => {}}
              onUsernameContextMenu={() => {}}
              onReactClick={(msg, el) => {
                setReactionAnchorRect(el.getBoundingClientRect());
                openReactionModal(msg);
              }}
              onReactionUnreact={unreact}
              onOpenReactionModal={(msg, _pos) => openReactionModal(msg)}
              onDirectReaction={directReaction}
              onRedactMessage={(msg) => {
                if (!msg.msgid || !channelName) return;
                if (
                  window.confirm(t`Delete this message? This cannot be undone.`)
                ) {
                  redactMessage(serverId, channelName, msg.msgid);
                }
              }}
              serverId={serverId}
              channelId={channelId}
            />
          ))
        )}
        <div ref={bottomRef} className="h-px" />
      </div>
      <ScrollToBottomButton isVisible={isScrolledUp} onClick={scrollToBottom} />

      {/* Input — same structure as main ChatArea input.
          keyboard-aware-layout: CSS rule zeroes padding-bottom when keyboard is visible
          (using !important to beat the inline safe-area style below). */}
      <div
        className="px-3 pb-3 pt-1 relative keyboard-aware-layout"
        style={
          isMobile
            ? {
                paddingBottom:
                  "calc(0.75rem + var(--safe-area-inset-bottom, 0px))",
              }
            : undefined
        }
      >
        <div className="bg-discord-dark-100 rounded-lg flex items-center relative flex-nowrap">
          <button
            type="button"
            className="px-2 sm:px-4 text-discord-text-muted hover:text-discord-text-normal flex-shrink-0"
            aria-label={t`Attachment options`}
          >
            <FaPlus />
          </button>
          <TextArea
            ref={textareaRef}
            value={commentText}
            onChange={(e) => {
              setCommentText(e.target.value);
              if (channelName)
                typingNotification.notifyTyping(channelName, e.target.value);
            }}
            onKeyDown={handleKeyDown}
            onKeyUp={trackCursor}
            onClick={trackCursor}
            onBeforeInput={onBeforeInputGuard}
            autoCorrect={isMobileInput ? "on" : "off"}
            autoCapitalize={isMobileInput ? "sentences" : "off"}
            spellCheck={isMobileInput}
            enterKeyHint={isNativeMobile ? "enter" : "send"}
            placeholder={
              sourceMessage.msgid
                ? `Reply in ${channelName ?? "channel"}…`
                : "Replies unavailable (no message ID)"
            }
            disabled={!sourceMessage.msgid}
            rows={1}
            className="bg-transparent border-none outline-none py-3 flex-grow text-discord-text-normal resize-none min-h-[44px] overflow-y-auto placeholder:truncate disabled:opacity-50 disabled:cursor-not-allowed"
            style={previewStyle}
          />
          <InputToolbar
            selectedColor={selectedColor}
            onEmojiClick={() => {
              setIsEmojiSelectorOpen((prev) => !prev);
              setIsColorPickerOpen(false);
              setShowMentionDropdown(false);
            }}
            onColorPickerClick={() => {
              setIsColorPickerOpen((prev) => !prev);
              setIsEmojiSelectorOpen(false);
              setShowMentionDropdown(false);
            }}
            onAtClick={() => {
              setShowMentionDropdown((prev) => !prev);
              setIsEmojiSelectorOpen(false);
              setIsColorPickerOpen(false);
            }}
            onSendClick={handleSend}
            showSendButton={isNativeMobile}
            hideEmoji={isNativeMobile}
            hasText={commentText.trim().length > 0}
          />
        </div>
        {isColorPickerOpen && (
          <ColorPicker
            isNarrowView={isMobile}
            onSelect={(color) => setSelectedColor(color)}
            onClose={() => setIsColorPickerOpen(false)}
            selectedColor={selectedColor}
            selectedFormatting={selectedFormatting}
            toggleFormatting={toggleFormatting}
          />
        )}
        {!isMobile && (
          <EmojiPickerInline
            isOpen={isEmojiSelectorOpen}
            onEmojiClick={(e) => setCommentText((prev) => prev + e.emoji)}
            onClose={() => setIsEmojiSelectorOpen(false)}
          />
        )}
        {!isNativeMobile && isMobile && (
          <EmojiPickerModal
            isOpen={isEmojiSelectorOpen}
            onEmojiClick={handleEmojiSelect}
            onClose={() => setIsEmojiSelectorOpen(false)}
            onBackdropClick={(e) => {
              if (e.target === e.currentTarget) setIsEmojiSelectorOpen(false);
            }}
            zIndex={9999}
          />
        )}
        <AutocompleteDropdown
          users={selectedChannel?.users ?? []}
          isVisible={showMentionDropdown}
          inputValue={commentText}
          cursorPosition={cursorPosition}
          onSelect={handleUsernameSelect}
          onClose={() => setShowMentionDropdown(false)}
          inputElement={textareaRef.current}
          isAtButtonTriggered={showMentionDropdown}
          isNarrowView={isMobile}
        />
      </div>

      {isMobile ? (
        <ReactionModal
          isOpen={reactionModal.isOpen}
          onClose={closeReactionModal}
          onSelectEmoji={selectReaction}
          zIndex={10000}
          reactedEmojis={reactedEmojis}
        />
      ) : (
        <ReactionPopover
          isOpen={reactionModal.isOpen}
          anchorRect={reactionAnchorRect}
          placement="left"
          containerLeft={sidebarRef.current?.getBoundingClientRect().left}
          onClose={() => {
            closeReactionModal();
            setReactionAnchorRect(null);
          }}
          onSelectEmoji={selectReaction}
          zIndex={10000}
          reactedEmojis={reactedEmojis}
        />
      )}
    </div>
  );
}
