import { Trans, useLingui } from "@lingui/react/macro";
import type { EmojiClickData } from "emoji-picker-react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FaGift, FaList, FaPlus, FaTimes } from "react-icons/fa";
import { v4 as uuidv4 } from "uuid";
import { useShallow } from "zustand/react/shallow";
import { useAutoFocusTyping } from "../../hooks/useAutoFocusTyping";
import { useEmojiCompletion } from "../../hooks/useEmojiCompletion";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useMentionAutocorrectGuard } from "../../hooks/useMentionAutocorrectGuard";
import { useMessageHistory } from "../../hooks/useMessageHistory";
import { useMessageSending } from "../../hooks/useMessageSending";
import { useReactions } from "../../hooks/useReactions";
import { isScrolledToBottom } from "../../hooks/useScrollToBottom";
import { useTabCompletion } from "../../hooks/useTabCompletion";
import { useTypingNotification } from "../../hooks/useTypingNotification";
import { waitForAuthToken } from "../../lib/authToken";
import { useEmojiResolver } from "../../lib/customEmoji";
import {
  emojiClickValue,
  packEntriesForPicker,
} from "../../lib/customEmojiPicker";
import ircClient from "../../lib/ircClient";
import { parseIrcUrl } from "../../lib/ircUrlParser";
import {
  fetchUploadInfo,
  uploadFile,
  validateFileAgainstInfo,
} from "../../lib/mediaUpload";
import {
  type FormattingType,
  getPreviewStyles,
  isValidFormattingType,
} from "../../lib/messageFormatter";
import { isMobileDevice, isTauriMobile } from "../../lib/platformUtils";
import useStore from "../../store";
import type { Message as MessageType, User } from "../../types";
import { MessageItem } from "../message/MessageItem";
import { MessageReply } from "../message/MessageReply";
import AutocompleteDropdown from "../ui/AutocompleteDropdown";
import BlankPage from "../ui/BlankPage";
import { BouncerNetworksPanel } from "../ui/BouncerNetworksPanel";
import ChannelSettingsModal from "../ui/ChannelSettingsModal";
import ColorPicker from "../ui/ColorPicker";
import EmojiAutocompleteDropdown from "../ui/EmojiAutocompleteDropdown";
import { EmojiPickerInline } from "../ui/EmojiPickerInline";
import { EmojiPickerModal } from "../ui/EmojiPickerModal";
import GifSelector from "../ui/GifSelector";
import DiscoverGrid from "../ui/HomeScreen";
import { ImagePreviewModal } from "../ui/ImagePreviewModal";
import { InputToolbar } from "../ui/InputToolbar";
import InviteUserModal from "../ui/InviteUserModal";
import { MiniMediaPlayer } from "../ui/MiniMediaPlayer";
import ModerationModal, { type ModerationAction } from "../ui/ModerationModal";
import ReactionModal from "../ui/ReactionModal";
import { ReactionPopover } from "../ui/ReactionPopover";
import {
  getActiveSlashQuery,
  SlashCommandPopover,
} from "../ui/SlashCommandPopover";
import { TextArea } from "../ui/TextInput";
import { TopicMediaStrip } from "../ui/TopicMediaStrip";
import {
  type UploadJob,
  UploadProgressOverlay,
} from "../ui/UploadProgressOverlay";
import UserContextMenu from "../ui/UserContextMenu";
import UserProfileModal from "../ui/UserProfileModal";
import {
  MemoChannelMessageList as ChannelMessageList,
  type ChannelMessageListHandle,
  DEFAULT_VISIBLE_MESSAGE_COUNT,
} from "./ChannelMessageList";
import { ChatHeader } from "./ChatHeader";
import { MemberList } from "./MemberList";

const EMPTY_ARRAY: User[] = [];

interface AliveChannel {
  key: string;
  serverId: string;
  channelId: string | null;
  privateChatId: string | null;
}

export const TypingIndicator: React.FC<{
  serverId: string;
  channelId: string;
}> = ({ serverId, channelId }) => {
  const key = `${serverId}-${channelId}`;
  const { t } = useLingui();

  const typingUsers = useStore(
    (state) => state.typingUsers[key] ?? EMPTY_ARRAY,
  );

  let message = "";
  if (typingUsers.length === 1) {
    message = t`${typingUsers[0].username} is typing...`;
  } else if (typingUsers.length === 2) {
    message = t`${typingUsers[0].username} and ${typingUsers[1].username} are typing...`;
  } else if (typingUsers.length === 3) {
    message = t`${typingUsers[0].username}, ${typingUsers[1].username} and ${typingUsers[2].username} are typing...`;
  } else if (typingUsers.length > 3) {
    message = t`${typingUsers[0].username}, ${typingUsers[1].username}, ${typingUsers[2].username} and ${typingUsers.length - 3} others are typing...`;
  }

  return <div className="h-5 ml-5 text-sm italic">{message}</div>;
};

const isMac =
  typeof navigator !== "undefined" &&
  navigator.platform.toUpperCase().includes("MAC");

export const ChatArea: React.FC<{
  onToggleChanList: () => void;
  isChanListVisible: boolean;
  /** Rendered between ChatHeader and TopicMediaStrip. Used by voice/stream
   * channels to inject the VoiceChannelView so the channel header stays
   * at the very top of the panel instead of getting sandwiched between
   * the voice grid and the chat scroll. */
  topSlot?: React.ReactNode;
}> = ({ onToggleChanList, isChanListVisible, topSlot }) => {
  const { t } = useLingui();
  const [localReplyTo, setLocalReplyTo] = useState<MessageType | null>(null);
  const [navHighlightedMsgId, setNavHighlightedMsgId] = useState<string | null>(
    null,
  );
  // Tracks whether keyboard nav was active and whether we were at the bottom before it started.
  // Used to restore auto-scroll after nav ends without corrupting wasAtBottomRef.
  const navWasActiveRef = useRef(false);
  const wasAtBottomBeforeNavRef = useRef(false);
  // messageText is NOT React state — stored in a ref to avoid re-renders on every keystroke.
  // hasText tracks the empty↔non-empty boundary for send-button rendering (rare transitions).
  // autocompleteInputText is updated only when autocomplete dropdowns are visible.
  const [hasText, setHasText] = useState(false);
  const [autocompleteInputText, setAutocompleteInputText] = useState("");
  // Slash-command popover state.  Only updated when the input starts
  // with "/" and we're still completing the command name -- otherwise
  // typing wouldn't trigger a re-render for this popover at all.
  const [slashInputValue, setSlashInputValue] = useState("");
  const [isEmojiSelectorOpen, setIsEmojiSelectorOpen] = useState(false);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedFormatting, setSelectedFormatting] = useState<
    FormattingType[]
  >([]);
  const [isFormattingInitialized, setIsFormattingInitialized] = useState(false);
  const cursorPositionRef = useRef(0);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [showEmojiAutocomplete, setShowEmojiAutocomplete] = useState(false);
  const [showMembersDropdown, setShowMembersDropdown] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [isGifSelectorOpen, setIsGifSelectorOpen] = useState(false);
  const [imagePreview, setImagePreview] = useState<{
    isOpen: boolean;
    file: File | null;
    previewUrl: string | null;
  }>({
    isOpen: false,
    file: null,
    previewUrl: null,
  });
  // Multimedia uploads in flight.  Each job tracks one file's
  // XHR-driven progress; once they all settle we send a single
  // PRIVMSG with the URLs joined.
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>([]);
  const uploadAbortsRef = useRef<Map<string, AbortController>>(new Map());
  const [isServerNoticesPoppedOut, setIsServerNoticesPoppedOut] =
    useState(false);
  const [serverNoticesPopupPosition, setServerNoticesPopupPosition] = useState({
    x: 16,
    y: 16,
  }); // 1rem = 16px
  const serverNoticesScrollRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScrollServerNotices, setShouldAutoScrollServerNotices] =
    useState(true);

  const handleServerNoticesScroll = () => {
    if (serverNoticesScrollRef.current) {
      const isAtBottom = isScrolledToBottom(serverNoticesScrollRef.current, 30);
      setShouldAutoScrollServerNotices(isAtBottom);
    }
  };
  const [isDraggingServerNotices, setIsDraggingServerNotices] = useState(false);
  const [serverNoticesDragStart, setServerNoticesDragStart] = useState({
    x: 0,
    y: 0,
  });
  const [userContextMenu, setUserContextMenu] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
    username: string;
    serverId: string;
    channelId: string;
    userStatusInChannel?: string;
  }>({
    isOpen: false,
    x: 0,
    y: 0,
    username: "",
    serverId: "",
    channelId: "",
    userStatusInChannel: undefined,
  });
  const [moderationModal, setModerationModal] = useState<{
    isOpen: boolean;
    action: ModerationAction;
    username: string;
  }>({
    isOpen: false,
    action: "warn",
    username: "",
  });
  const [channelSettingsModalOpen, setChannelSettingsModalOpen] =
    useState(false);
  const [userProfileModalOpen, setUserProfileModalOpen] = useState(false);
  const [inviteUserModalOpen, setInviteUserModalOpen] = useState(false);
  const [selectedProfileUsername, setSelectedProfileUsername] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Per-channel draft storage. messageTextRef is the source of truth for the input value.
  // It is updated imperatively (never from state), so no re-render occurs on each keystroke.
  const draftMap = useRef<Map<string, string>>(new Map());
  // Per-channel scroll position. null = was at bottom (restore to bottom).
  const scrollPositionMapRef = useRef<
    Map<string, { scrollTop: number; visibleCount: number } | null>
  >(new Map());
  const messageTextRef = useRef("");
  const hasTextRef = useRef(false);
  // platform() is stable at runtime — ref avoids adding it to useCallback deps.
  const isNativeMobileRef = useRef(isTauriMobile());
  // Keep-alive: last 3 visited channels are kept in the DOM (display:none) to preserve
  // scroll position and media element state across channel switches.
  const [aliveChannels, setAliveChannels] = useState<AliveChannel[]>([]);
  const channelListRefs = useRef<Map<string, ChannelMessageListHandle | null>>(
    new Map(),
  );
  // lineHeight/padding are static CSS values — cache them after first read to avoid
  // getComputedStyle on every keystroke, which forces layout flush on mobile WebView.
  const textareaMetricsRef = useRef<{
    lineHeight: number;
    paddingTop: number;
    paddingBottom: number;
  } | null>(null);
  const prevInputLengthRef = useRef(0);
  const resizeTextarea = useCallback(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    if (!textareaMetricsRef.current) {
      const computed = window.getComputedStyle(textarea);
      textareaMetricsRef.current = {
        lineHeight: Number.parseFloat(computed.lineHeight) || 24,
        paddingTop: Number.parseFloat(computed.paddingTop) || 0,
        paddingBottom: Number.parseFloat(computed.paddingBottom) || 0,
      };
    }

    const { lineHeight, paddingTop, paddingBottom } =
      textareaMetricsRef.current;
    const maxHeight = lineHeight * 5 + paddingTop + paddingBottom;

    const currentLength = messageTextRef.current.length;
    const prevLength = prevInputLengthRef.current;
    prevInputLengthRef.current = currentLength;

    if (textarea.scrollHeight > textarea.clientHeight) {
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
      return;
    }

    if (currentLength >= prevLength) {
      // height="auto" causes WKWebView to deliver a transient layout state to
      // ResizeObserver, scrolling the chat on every keystroke. Safe to skip when
      // text only grew and content still fits — height is unchanged.
      return;
    }

    // May have lost a line; remeasure.
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, []);

  // Imperatively set textarea value and update the send-button state.
  // Using a ref as truth means typing never triggers a ChatArea re-render.
  const applyText = useCallback(
    (text: string) => {
      messageTextRef.current = text;
      if (inputRef.current) inputRef.current.value = text;
      resizeTextarea();
      const ht = text.trim().length > 0;
      if (ht !== hasTextRef.current) {
        hasTextRef.current = ht;
        if (isNativeMobileRef.current) setHasText(ht);
      }
    },
    [resizeTextarea],
  );

  const servers = useStore((state) => state.servers);
  const bouncers = useStore((state) => state.bouncers);
  const ui = useStore((state) => state.ui);
  const globalSettings = useStore((state) => state.globalSettings);
  const messages = useStore((state) => state.messages);
  const toggleMemberList = useStore((state) => state.toggleMemberList);
  const openPrivateChat = useStore((state) => state.openPrivateChat);
  const selectPrivateChat = useStore((state) => state.selectPrivateChat);
  const connect = useStore((state) => state.connect);
  const joinChannel = useStore((state) => state.joinChannel);
  const toggleAddServerModal = useStore((state) => state.toggleAddServerModal);
  const stopActiveMedia = useStore((state) => state.stopActiveMedia);
  const redactMessage = useStore((state) => state.redactMessage);
  const warnUser = useStore((state) => state.warnUser);
  const kickUser = useStore((state) => state.kickUser);
  const banUserByNick = useStore((state) => state.banUserByNick);
  const banUserByHostmask = useStore((state) => state.banUserByHostmask);
  const clearChatInputFocus = useStore((state) => state.clearChatInputFocus);
  const shouldFocusChatInput = useStore(
    (state) => state.ui.shouldFocusChatInput,
  );
  const channelSettingsRequest = useStore(
    (state) => state.ui.channelSettingsRequest,
  );
  const inviteUserRequest = useStore((state) => state.ui.inviteUserRequest);
  const setChannelSettingsRequest = useStore(
    (state) => state.setChannelSettingsRequest,
  );
  const setInviteUserRequest = useStore((state) => state.setInviteUserRequest);

  const isAnyModalOpen = useStore((state) => {
    const { ui } = state;
    return !!(
      ui.isAddServerModalOpen ||
      ui.isEditServerModalOpen ||
      ui.isSettingsModalOpen ||
      ui.isQuickActionsOpen ||
      ui.isChannelListModalOpen ||
      ui.contextMenu?.isOpen ||
      ui.isServerNoticesPopupOpen ||
      ui.profileViewRequest ||
      ui.topicModalRequest ||
      ui.isUserProfileModalOpen ||
      ui.channelSettingsRequest ||
      ui.inviteUserRequest ||
      ui.openedMedia ||
      (ui.linkSecurityWarnings?.length ?? 0) > 0
    );
  });

  useAutoFocusTyping(inputRef, () => isAnyModalOpen);

  useEffect(() => {
    if (channelSettingsRequest) {
      setChannelSettingsModalOpen(true);
      setChannelSettingsRequest(null, null);
    }
  }, [channelSettingsRequest, setChannelSettingsRequest]);

  useEffect(() => {
    if (inviteUserRequest) {
      setInviteUserModalOpen(true);
      setInviteUserRequest(null, null);
    }
  }, [inviteUserRequest, setInviteUserRequest]);

  // Focus chat input when requested by other components (e.g., modals closing)
  useEffect(() => {
    if (shouldFocusChatInput && inputRef.current) {
      inputRef.current.focus();
      clearChatInputFocus();
    }
  }, [shouldFocusChatInput, clearChatInputFocus]);

  const selectedServerId = ui.selectedServerId;
  const currentSelection = ui.perServerSelections[selectedServerId || ""] || {
    selectedChannelId: null,
    selectedPrivateChatId: null,
  };
  const { selectedChannelId, selectedPrivateChatId } = currentSelection;
  const {
    isMemberListVisible,
    isSettingsModalOpen,
    isAddServerModalOpen,
    isChannelListModalOpen,
    isServerNoticesPopupOpen,
  } = ui;

  const isMobile = useMediaQuery("(max-width: 768px)");
  const isCompactInput = useMediaQuery("(max-width: 900px)");

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — clear reply state whenever the active channel/server changes
  useEffect(() => {
    setLocalReplyTo(null);
    setNavHighlightedMsgId(null);
    navWasActiveRef.current = false;
    wasAtBottomBeforeNavRef.current = false;
  }, [selectedServerId, selectedChannelId, selectedPrivateChatId]);

  // Get the current user for the selected server with metadata from store
  const currentUser = useMemo(() => {
    if (!selectedServerId) return null;

    // Get the current user's username from IRCClient
    const ircCurrentUser = ircClient.getCurrentUser(selectedServerId);
    if (!ircCurrentUser) return null;

    // Find the current user in the server's channel data to get metadata
    const selectedServer = servers.find((s) => s.id === selectedServerId);
    if (!selectedServer) return ircCurrentUser;

    // Look for the user in any channel to get their metadata
    for (const channel of selectedServer.channels) {
      const userWithMetadata = channel.users.find(
        (u) => u.username === ircCurrentUser.username,
      );
      if (userWithMetadata) {
        return userWithMetadata;
      }
    }

    // If not found in channels, return the basic IRC user
    return ircCurrentUser;
  }, [selectedServerId, servers]);

  // Auto-scroll server notices popup when new messages arrive
  useEffect(() => {
    if (shouldAutoScrollServerNotices && serverNoticesScrollRef.current) {
      serverNoticesScrollRef.current.scrollTop =
        serverNoticesScrollRef.current.scrollHeight;
    }
  }, [shouldAutoScrollServerNotices]);

  // Scroll to bottom when popup is first opened
  useEffect(() => {
    if (isServerNoticesPoppedOut && serverNoticesScrollRef.current) {
      serverNoticesScrollRef.current.scrollTop =
        serverNoticesScrollRef.current.scrollHeight;
      setShouldAutoScrollServerNotices(true); // Enable auto-scroll for future messages
    }
  }, [isServerNoticesPoppedOut]);

  // Get current user's status in the selected channel
  const currentUserStatus = useMemo(() => {
    if (!selectedServerId || !selectedChannelId) return undefined;

    const selectedServer = servers.find((s) => s.id === selectedServerId);
    const selectedChannel = selectedServer?.channels.find(
      (c) => c.id === selectedChannelId,
    );

    if (!selectedChannel || !currentUser) return undefined;

    const userInChannel = selectedChannel.users.find(
      (u) => u.username === currentUser.username,
    );

    return userInChannel?.status;
  }, [selectedServerId, selectedChannelId, servers, currentUser]);

  // Tab completion hook
  const tabCompletion = useTabCompletion();

  // draft/custom-emoji: gather pack URLs (channel-scoped first so it
  // shadows the network-wide pack on shortcode collisions) and surface
  // the resulting shortcodes to the emoji picker + completion.
  const networkEmojiPackUrl = useMemo(
    () => servers.find((s) => s.id === selectedServerId)?.emojiPackUrl,
    [servers, selectedServerId],
  );
  const channelEmojiPackUrl = useMemo(() => {
    const srv = servers.find((s) => s.id === selectedServerId);
    return srv?.channels.find((c) => c.id === selectedChannelId)?.metadata?.[
      "draft/emoji"
    ]?.value;
  }, [servers, selectedServerId, selectedChannelId]);
  const { shortcodes: customEmojiShortcodes } = useEmojiResolver([
    channelEmojiPackUrl,
    networkEmojiPackUrl,
  ]);
  const pickerCustomEmojis = useMemo(
    () => packEntriesForPicker(customEmojiShortcodes),
    [customEmojiShortcodes],
  );

  // Emoji completion hook
  const emojiCompletion = useEmojiCompletion(customEmojiShortcodes);

  // Typing notification hook
  const typingNotification = useTypingNotification({
    serverId: selectedServerId,
    enabled: globalSettings.sendTypingNotifications,
  });

  // Media query hooks
  const isNarrowView = useMediaQuery();
  const isTooNarrowForMemberList = useMediaQuery("(max-width: 1080px)");
  const isNativeMobile = isTauriMobile();
  const isMobileInput = isMobileDevice();

  const handleIrcLinkClick = useCallback(
    (rawUrl: string) => {
      const ircCurrentUser = selectedServerId
        ? ircClient.getCurrentUser(selectedServerId)
        : null;
      const parsed = parseIrcUrl(rawUrl, ircCurrentUser?.username || "user");

      // Open the connect modal with pre-filled server details
      toggleAddServerModal(true, {
        name: parsed.host,
        host: parsed.host,
        port: parsed.port.toString(),
        nickname: parsed.nick || "user",
      });
    },
    [selectedServerId, toggleAddServerModal],
  );

  // Handle setting reply and focusing input
  const handleSetReplyTo = useCallback((message: MessageType | null) => {
    // Focus synchronously before the state update so iOS treats it as a
    // direct user-gesture response and opens the keyboard immediately.
    inputRef.current?.focus();
    setLocalReplyTo(message);
  }, []);

  // Toggle notification sound volume
  const handleToggleNotificationVolume = async () => {
    const currentVolume = globalSettings.notificationVolume;
    const newVolume = currentVolume > 0 ? 0 : 0.4; // Toggle between 0 (muted) and 0.4 (40%)

    useStore.getState().updateGlobalSettings({
      notificationVolume: newVolume,
    });

    // Play test sound when enabling (not when disabling)
    if (newVolume > 0) {
      try {
        const audio = new Audio();
        audio.volume = newVolume;
        audio.src = "/sounds/notif2.mp3";
        // Wait for the audio to be loaded before playing
        audio.load();
        await audio.play();
      } catch (error) {
        console.error("Failed to play notification sound:", error);
      }
    }
  };

  // Load saved settings from local storage on mount
  useEffect(() => {
    const savedColor = localStorage.getItem("selectedColor");
    const savedFormatting = localStorage.getItem("selectedFormatting");

    if (savedColor) {
      setSelectedColor(savedColor); // Apply the saved color
    }

    if (savedFormatting) {
      try {
        const parsedFormatting = JSON.parse(savedFormatting);
        if (Array.isArray(parsedFormatting)) {
          // Validate that all items are valid formatting types
          const validFormatting = parsedFormatting.filter(
            isValidFormattingType,
          );
          setSelectedFormatting(validFormatting); // Apply the saved formatting
          setIsFormattingInitialized(true); // Mark formatting as initialized
        }
      } catch (error) {
        console.error("Failed to parse saved formatting:", error);
        setSelectedFormatting([]); // Fallback to an empty array
        setIsFormattingInitialized(true); // Mark formatting as initialized
      }
    } else {
      setIsFormattingInitialized(true); // Mark formatting as initialized even if nothing is saved
    }
  }, []);

  // Save selectedColor to local storage whenever it changes
  useEffect(() => {
    if (selectedColor) {
      localStorage.setItem("selectedColor", selectedColor);
    }
  }, [selectedColor]);

  // Save selectedFormatting to local storage whenever it changes
  useEffect(() => {
    if (isFormattingInitialized) {
      localStorage.setItem(
        "selectedFormatting",
        JSON.stringify(selectedFormatting),
      );
    }
  }, [selectedFormatting, isFormattingInitialized]);

  // Get selected server and channel/private chat - memoized to prevent re-renders
  const selectedServer = useMemo(
    () => servers.find((s) => s.id === selectedServerId),
    [servers, selectedServerId],
  );

  const selectedChannel = useMemo(
    () => selectedServer?.channels.find((c) => c.id === selectedChannelId),
    [selectedServer, selectedChannelId],
  );

  const selectedPrivateChat = useMemo(
    () =>
      selectedServer?.privateChats?.find(
        (pc) => pc.id === selectedPrivateChatId,
      ),
    [selectedServer, selectedPrivateChatId],
  );

  const onBeforeInputGuard = useMentionAutocorrectGuard(
    selectedChannel?.users.map((u) => u.username) ?? [],
  );

  // Member list overlay: show when desktop is too narrow for sidebar
  const showMemberListOverlay =
    !isNarrowView &&
    isTooNarrowForMemberList &&
    isMemberListVisible &&
    !!selectedChannel &&
    !selectedPrivateChat;

  // Track previous width state to detect transitions
  const prevIsTooNarrowRef = useRef(isTooNarrowForMemberList);

  // Auto-hide/show member list based on screen size transitions (desktop only)
  useEffect(() => {
    // Only apply auto-hide/show logic on desktop (not mobile)
    if (isNarrowView) {
      prevIsTooNarrowRef.current = isTooNarrowForMemberList;
      return;
    }

    const wasWide = !prevIsTooNarrowRef.current;
    const isNowNarrow = isTooNarrowForMemberList;
    const wasNarrow = prevIsTooNarrowRef.current;
    const isNowWide = !isTooNarrowForMemberList;

    // On transition from narrow to wide: auto-show as sidebar
    if (wasNarrow && isNowWide && !isMemberListVisible) {
      toggleMemberList(true);
    }
    // On transition from wide to narrow: auto-hide
    else if (wasWide && isNowNarrow && isMemberListVisible) {
      toggleMemberList(false);
    }

    prevIsTooNarrowRef.current = isTooNarrowForMemberList;
  }, [
    isNarrowView,
    isTooNarrowForMemberList,
    isMemberListVisible,
    toggleMemberList,
  ]);

  // Message sending hook
  const { sendMessage } = useMessageSending({
    selectedServerId,
    selectedChannelId,
    selectedPrivateChatId,
    selectedChannel: selectedChannel ?? null,
    selectedPrivateChat: selectedPrivateChat ?? null,
    currentUser,
    selectedColor,
    selectedFormatting,
    localReplyTo,
  });

  // Reactions hook
  const {
    reactionModal,
    openReactionModal,
    closeReactionModal,
    selectReaction,
    directReaction,
    unreact,
  } = useReactions({
    selectedServerId,
    currentUser,
  });
  const [reactionAnchorRect, setReactionAnchorRect] = useState<DOMRect | null>(
    null,
  );

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

  // Memoize preview styles — selectedColor/selectedFormatting don't change while typing,
  // so recomputing this on every keystroke is unnecessary object churn.
  const previewStyle = useMemo(
    () =>
      getPreviewStyles({
        color: selectedColor || "inherit",
        formatting: selectedFormatting,
      }),
    [selectedColor, selectedFormatting],
  );

  // Get messages for current channel or private chat - memoized
  const channelKey = useMemo(
    () =>
      selectedServerId && (selectedChannelId || selectedPrivateChatId)
        ? `${selectedServerId}-${selectedChannelId || selectedPrivateChatId}`
        : "",
    [selectedServerId, selectedChannelId, selectedPrivateChatId],
  );

  const channelMessages = useMemo(
    () => (channelKey ? messages[channelKey] || [] : []),
    [messages, channelKey],
  );

  // Messages the user can navigate to with Cmd/Ctrl+↑↓ to set as reply target.
  // Capped to the visible window so navigation stays within what's on screen.
  const repliableMessages = useMemo(
    () =>
      channelMessages
        .filter((m) => m.type === "message" && !!m.msgid)
        .slice(-DEFAULT_VISIBLE_MESSAGE_COUNT),
    [channelMessages],
  );

  // scrollIntoView fires scroll events that corrupt wasAtBottomRef in useScrollToBottom —
  // snapshot bottom state before the first scroll so nav exit can restore it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: channelKey and refs don't need to retrigger; navHighlightedMsgId drives all transitions
  useEffect(() => {
    if (navHighlightedMsgId !== null) {
      if (!navWasActiveRef.current) {
        wasAtBottomBeforeNavRef.current =
          channelListRefs.current.get(channelKey)?.getScrollState()
            .isAtBottom ?? false;
        navWasActiveRef.current = true;
      }
      const el = document.querySelector(
        `[data-message-id="${navHighlightedMsgId}"]`,
      );
      el?.scrollIntoView({ block: "nearest", behavior: "instant" });
    } else if (navWasActiveRef.current) {
      if (wasAtBottomBeforeNavRef.current) {
        channelListRefs.current.get(channelKey)?.scrollToBottom();
      }
      navWasActiveRef.current = false;
      wasAtBottomBeforeNavRef.current = false;
    }
  }, [navHighlightedMsgId]);

  // prevClientHeight in useScrollToBottom can race with flex relayout on WKWebView —
  // track bottom state here and restore it explicitly when reply exits without keyboard nav.
  // biome-ignore lint/correctness/useExhaustiveDependencies: channelKey and refs don't need to retrigger; localReplyTo drives all transitions
  useEffect(() => {
    if (localReplyTo !== null) {
      if (!navWasActiveRef.current) {
        wasAtBottomBeforeNavRef.current =
          channelListRefs.current.get(channelKey)?.getScrollState()
            .isAtBottom ?? false;
      }
    } else if (!navWasActiveRef.current && wasAtBottomBeforeNavRef.current) {
      // rAF lets the banner-removal relayout settle before scrollTop can reach the new maximum
      requestAnimationFrame(() => {
        channelListRefs.current.get(channelKey)?.scrollToBottom();
      });
      wasAtBottomBeforeNavRef.current = false;
    }
  }, [localReplyTo]);

  // Message history hook (must be after channelMessages is defined)
  const messageHistory = useMessageHistory({
    messages: channelMessages,
    currentUsername: currentUser?.username || null,
    selectedChannelId,
    selectedPrivateChatId,
  });

  // Save outgoing channel's draft on cleanup; messageText read through ref so the
  // cleanup always sees the latest typed value, not the stale closure at effect-run time.
  useEffect(() => {
    const key = channelKey;
    return () => {
      if (key) draftMap.current.set(key, messageTextRef.current);
    };
  }, [channelKey]);

  // Save outgoing channel's scroll position on cleanup (same pattern as draftMap).
  useEffect(() => {
    const key = channelKey;
    return () => {
      if (key) {
        const handle = channelListRefs.current.get(key);
        if (handle) {
          const { scrollTop, isAtBottom, visibleCount } =
            handle.getScrollState();
          scrollPositionMapRef.current.set(
            key,
            isAtBottom ? null : { scrollTop, visibleCount },
          );
        }
      }
    };
  }, [channelKey]);

  // Restore the new channel's draft (empty string if none saved yet).
  useEffect(() => {
    if (channelKey) {
      applyText(draftMap.current.get(channelKey) ?? "");
    }
  }, [channelKey, applyText]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: channelKey intentionally triggers search clear without being used in the body
  useEffect(() => {
    setSearchQuery("");
  }, [channelKey]);

  const handleClearSearch = useCallback(() => setSearchQuery(""), []);

  // Keep-alive: maintain last 3 visited channels in an LRU list so their message list
  // DOMs are preserved with display:none (scroll position + media elements stay alive).
  useEffect(() => {
    if (!channelKey || !selectedServerId) return;
    setAliveChannels((prev) => {
      const filtered = prev.filter((c) => c.key !== channelKey);
      return [
        {
          key: channelKey,
          serverId: selectedServerId,
          channelId: selectedChannelId,
          privateChatId: selectedPrivateChatId,
        },
        ...filtered,
      ].slice(0, 3);
    });
  }, [channelKey, selectedServerId, selectedChannelId, selectedPrivateChatId]);

  // Stop embed media (YouTube, etc.) when switching channels.
  // HTML5 video/audio keep playing via MiniMediaPlayer's hidden element,
  // but embedded iframes are suspended by display:none anyway — stopping them
  // keeps the store consistent and resets the player for the next visit.
  // biome-ignore lint/correctness/useExhaustiveDependencies: stopActiveMedia is a stable store action
  useEffect(() => {
    if (ui.activeMedia?.type === "embed") stopActiveMedia();
  }, [channelKey]);

  // Close plus menu on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showPlusMenu && !(event.target as Element).closest(".plus-menu")) {
        setShowPlusMenu(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showPlusMenu]);

  const handleSendMessage = () => {
    if (!hasTextRef.current) return;

    // Block sending to offline PM targets — isOnline is explicitly false (MONITOR tracked).
    // undefined means the server doesn't support MONITOR, so we let it through.
    if (selectedPrivateChat?.isOnline === false && selectedServerId) {
      useStore.getState().addGlobalNotification({
        type: "warn",
        command: "PRIVMSG",
        code: "ERR_OFFLINE",
        message: `${selectedPrivateChat.username} is offline. Your message was not sent.`,
        target: selectedPrivateChat.username,
        serverId: selectedServerId,
      });
      return;
    }

    channelListRefs.current.get(channelKey)?.setAtBottom();
    sendMessage(messageTextRef.current);

    applyText("");
    setAutocompleteInputText("");
    draftMap.current.delete(channelKey);
    setLocalReplyTo(null);
    setNavHighlightedMsgId(null);
    setShowAutocomplete(false);
    messageHistory.resetHistory();
    if (tabCompletion.isActive) {
      tabCompletion.resetCompletion();
    }

    // Keep the textarea focused so the keyboard stays open on mobile.
    inputRef.current?.focus();
  };

  const handleImageUpload = async (file: File) => {
    if (!selectedServer?.filehost || !selectedServerId) return;

    // draft/authtoken: always mint a fresh token per upload, since the
    // server may scope or expire them aggressively.  The reply URL is
    // what the server tells us to talk to; fall back to filehost.
    useStore.setState((state) => ({
      servers: state.servers.map((server) =>
        server.id === selectedServerId
          ? {
              ...server,
              authToken: undefined,
              authTokenUrl: undefined,
              authTokenService: undefined,
            }
          : server,
      ),
    }));
    ircClient.requestToken(selectedServerId, "filehost");
    const authToken = await waitForAuthToken(selectedServerId);
    if (!authToken) {
      console.error("draft/authtoken: server did not return a filehost token");
      return;
    }
    const refreshed = useStore
      .getState()
      .servers.find((s) => s.id === selectedServerId);
    const baseUrl = refreshed?.authTokenUrl || refreshed?.filehost || "";

    const formData = new FormData();
    formData.append("image", file);

    try {
      const uploadUrl = `${baseUrl}/upload`;
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        body: formData,
      });

      console.log("📡 Response status:", response.status);
      console.log(
        "📡 Response headers:",
        Object.fromEntries(response.headers.entries()),
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Upload failed with status:", response.status);
        console.error("❌ Error response:", errorText);
        throw new Error(`Upload failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log("✅ Upload successful:", data);
      if (data.saved_url) {
        // saved_url is a path under the filehost the server told us to
        // use, so prepend the same base we uploaded to.
        const fullImageUrl = `${baseUrl}${data.saved_url}`;

        // Send the link directly to the current channel/user
        const target =
          selectedChannel?.name ?? selectedPrivateChat?.username ?? "";

        if (target) {
          // Send via IRC
          if (selectedServerId) {
            ircClient.sendRaw(
              selectedServerId,
              `PRIVMSG ${target} :${fullImageUrl}`,
            );
          }

          // Add to store for immediate display (only for private chats, channels echo back)
          if (selectedPrivateChat && currentUser && selectedServerId) {
            const outgoingMessage = {
              id: uuidv4(),
              content: fullImageUrl,
              timestamp: new Date(),
              userId: currentUser.username || currentUser.id,
              channelId: selectedPrivateChat.id,
              serverId: selectedServerId,
              type: "message" as const,
              reactions: [],
              replyMessage: null,
              mentioned: [],
            };

            const { addMessage } = useStore.getState();
            addMessage(outgoingMessage);
          }
        }
      }
    } catch (error) {
      console.error("Image upload failed:", error);
      // TODO: Show error to user
    }
  };

  // Multi-file upload entry point.  Picks up an auth token (one-shot
  // per batch -- the backend accepts the same token across many
  // uploads), kicks off N uploads in parallel, surfaces per-file
  // progress, and on full success sends a single PRIVMSG containing
  // all the resulting URLs separated by spaces.
  const handleFilesUpload = async (files: File[]) => {
    if (!selectedServer?.filehost || !selectedServerId || files.length === 0) {
      return;
    }
    const filehostUrl = selectedServer.filehost;
    const target = selectedChannel?.name ?? selectedPrivateChat?.username;
    if (!target) return;

    // Pre-flight: pull the policy so we can reject obviously-bad
    // files before pushing bytes.
    const info = await fetchUploadInfo(filehostUrl);

    // Acquire auth token (reuse existing EXTJWT flow).  The backend
    // doesn't need a fresh token per file -- the same Bearer is
    // accepted until expiry, so we mint once.
    let jwtToken = selectedServer?.jwtToken;
    if (!jwtToken) {
      useStore.setState((state) => ({
        servers: state.servers.map((server) =>
          server.id === selectedServerId
            ? { ...server, jwtToken: undefined }
            : server,
        ),
      }));
      ircClient.requestExtJwt(selectedServerId, "*", "filehost");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const updated = useStore
        .getState()
        .servers.find((s) => s.id === selectedServerId);
      jwtToken = updated?.jwtToken;
    }
    if (!jwtToken) {
      console.error("Failed to obtain auth token for file upload");
      return;
    }

    // Build the job list in one go so the progress strip appears
    // immediately, before any network roundtrip.
    const initialJobs: UploadJob[] = files.map((f) => ({
      id: uuidv4(),
      file: f,
      loaded: 0,
      total: f.size,
      status: "pending",
    }));
    setUploadJobs((prev) => [...prev, ...initialJobs]);

    const updateJob = (id: string, patch: Partial<UploadJob>) =>
      setUploadJobs((prev) =>
        prev.map((j) => (j.id === id ? { ...j, ...patch } : j)),
      );

    // Run all uploads in parallel; collect URLs in original input order.
    const results = await Promise.all(
      initialJobs.map(async (job) => {
        // Cheap client-side validation -- saves a server round-trip
        // and gives the user immediate feedback.
        const validationError = validateFileAgainstInfo(job.file, info);
        if (validationError) {
          updateJob(job.id, {
            status: "failed",
            error: validationError,
          });
          return null;
        }
        const ac = new AbortController();
        uploadAbortsRef.current.set(job.id, ac);
        updateJob(job.id, { status: "uploading" });
        try {
          const url = await uploadFile(job.file, {
            filehostUrl,
            bearerToken: jwtToken as string,
            signal: ac.signal,
            onProgress: (loaded, total) => updateJob(job.id, { loaded, total }),
          });
          updateJob(job.id, {
            status: "done",
            loaded: job.file.size,
            total: job.file.size,
            url,
          });
          uploadAbortsRef.current.delete(job.id);
          return url;
        } catch (err) {
          uploadAbortsRef.current.delete(job.id);
          const msg = typeof err === "string" ? err : String(err);
          updateJob(job.id, { status: "failed", error: msg });
          return null;
        }
      }),
    );

    const urls = results.filter((u): u is string => !!u);
    if (urls.length === 0) {
      // All failed: leave the strip up so the user sees error reasons.
      return;
    }

    // Send a single PRIVMSG carrying all successful URLs space-joined.
    // Channels echo back; PMs need a local insert so the user sees
    // their own message immediately.
    const line = urls.join(" ");
    ircClient.sendRaw(selectedServerId, `PRIVMSG ${target} :${line}`);
    if (selectedPrivateChat && currentUser) {
      const outgoing = {
        id: uuidv4(),
        content: line,
        timestamp: new Date(),
        userId: currentUser.username || currentUser.id,
        channelId: selectedPrivateChat.id,
        serverId: selectedServerId,
        type: "message" as const,
        reactions: [],
        replyMessage: null,
        mentioned: [],
      };
      useStore.getState().addMessage(outgoing);
    }

    // Clear the strip after a short pause so the user can see
    // "done" before it disappears.
    setTimeout(() => {
      setUploadJobs((prev) =>
        prev.filter((j) => !initialJobs.find((i) => i.id === j.id)),
      );
    }, 1500);
  };

  const cancelUploadJob = (id: string) => {
    const ac = uploadAbortsRef.current.get(id);
    if (ac) ac.abort();
    setUploadJobs((prev) => prev.filter((j) => j.id !== id));
  };

  const handleGifSend = (gifUrl: string) => {
    // Send the GIF URL directly to the current channel/user
    const target = selectedChannel?.name ?? selectedPrivateChat?.username ?? "";

    if (target && selectedServerId) {
      // Send via IRC
      ircClient.sendRaw(selectedServerId, `PRIVMSG ${target} :${gifUrl}`);

      // Add to store for immediate display (only for private chats, channels echo back)
      if (selectedPrivateChat && currentUser) {
        const outgoingMessage = {
          id: uuidv4(),
          content: gifUrl,
          timestamp: new Date(),
          userId: currentUser.username || currentUser.id,
          channelId: selectedPrivateChat.id,
          serverId: selectedServerId,
          type: "message" as const,
          reactions: [],
          replyMessage: null,
          mentioned: [],
        };

        const { addMessage } = useStore.getState();
        addMessage(outgoingMessage);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const isModKey = isMac ? e.metaKey || e.ctrlKey : e.ctrlKey;

    // Reply navigation: Cmd/Ctrl+↑ moves to older repliable message, ↓ moves newer / cancels
    if (isModKey && e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const currentIdx =
        navHighlightedMsgId !== null
          ? repliableMessages.findIndex((m) => m.id === navHighlightedMsgId)
          : repliableMessages.length; // one past end → first press lands on last
      const nextIdx = currentIdx - 1;
      if (nextIdx >= 0) {
        const msg = repliableMessages[nextIdx];
        setNavHighlightedMsgId(msg.id);
        setLocalReplyTo(msg);
      }
      return;
    }

    if (isModKey && e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      if (navHighlightedMsgId !== null) {
        const currentIdx = repliableMessages.findIndex(
          (m) => m.id === navHighlightedMsgId,
        );
        const nextIdx = currentIdx + 1;
        if (nextIdx < repliableMessages.length) {
          const msg = repliableMessages[nextIdx];
          setNavHighlightedMsgId(msg.id);
          setLocalReplyTo(msg);
        } else {
          // Past the newest message → cancel reply
          setNavHighlightedMsgId(null);
          setLocalReplyTo(null);
        }
      }
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();

      // If emoji completion is already active, continue with emoji completion
      if (emojiCompletion.isActive) {
        handleEmojiCompletion();
      } else {
        // Check if we're starting emoji completion context
        const textBeforeCursor = messageTextRef.current.substring(
          0,
          cursorPositionRef.current,
        );
        const emojiMatch = textBeforeCursor.match(/:([a-zA-Z_]*)$/);

        if (emojiMatch) {
          handleEmojiCompletion();
        } else {
          handleTabCompletion();
        }
      }
      return;
    }

    // Handle keys when autocomplete dropdown is visible
    if (
      (showAutocomplete || showEmojiAutocomplete) &&
      (e.key === "ArrowUp" ||
        e.key === "ArrowDown" ||
        e.key === "Escape" ||
        e.key === "Enter" ||
        e.key === " ")
    ) {
      // Let the dropdown handle these keys, don't interfere
      return;
    }

    // Escape cancels active reply navigation (and the reply itself)
    if (e.key === "Escape" && navHighlightedMsgId !== null) {
      setNavHighlightedMsgId(null);
      setLocalReplyTo(null);
      return;
    }

    // Handle message history navigation with arrow keys
    if (e.key === "ArrowUp") {
      // Only activate if input is empty or already in history mode
      if (
        messageTextRef.current === "" ||
        messageHistory.messageHistoryIndex >= 0
      ) {
        e.preventDefault();

        if (messageHistory.userMessageHistory.length === 0) return;

        const previousMessage = messageHistory.navigateUp(
          messageTextRef.current,
        );
        if (previousMessage !== null) {
          applyText(previousMessage);

          // Move cursor to end of text
          setTimeout(() => {
            if (inputRef.current) {
              inputRef.current.setSelectionRange(
                previousMessage.length,
                previousMessage.length,
              );
            }
          }, 0);
        }
      }
      return;
    }

    if (e.key === "ArrowDown") {
      // Only handle if we're in history mode
      if (messageHistory.messageHistoryIndex >= 0) {
        e.preventDefault();

        const nextMessage = messageHistory.navigateDown();
        if (nextMessage !== null) {
          applyText(nextMessage);

          // Move cursor to end
          setTimeout(() => {
            if (inputRef.current) {
              inputRef.current.setSelectionRange(
                nextMessage.length,
                nextMessage.length,
              );
            }
          }, 0);
        }
      }
      return;
    }

    // Handle Enter key behavior based on settings
    if (e.key === "Enter") {
      if (isNativeMobile && globalSettings.enableMultilineInput) {
        return;
      }

      const shouldCreateNewline =
        globalSettings.enableMultilineInput &&
        (globalSettings.multilineOnShiftEnter ? e.shiftKey : !e.shiftKey);

      if (shouldCreateNewline) {
        // Allow the default behavior (add newline)
        return;
      }

      // Prevent newline from being added before sending message
      e.preventDefault();

      // Force clear any newlines that might have been added to the textarea
      if (inputRef.current) {
        inputRef.current.value = messageTextRef.current.trim();
      }

      handleSendMessage();
      // Send typing done notification
      const storeState = useStore.getState();
      if (storeState.globalSettings.sendTypingNotifications) {
        if (selectedChannel?.name) {
          ircClient.sendTyping(
            selectedServerId ?? "",
            selectedChannel.name,
            false,
          );
        } else if (selectedPrivateChat?.username) {
          ircClient.sendTyping(
            selectedServerId ?? "",
            selectedPrivateChat.username,
            false,
          );
        }
      }
      return;
    }

    // Reset tab completion on any other key
    if (tabCompletion.isActive) {
      tabCompletion.resetCompletion();
    }
    setShowAutocomplete(false);

    // Any normal keystroke exits nav mode but keeps the reply so the user can type
    if (navHighlightedMsgId !== null) {
      setNavHighlightedMsgId(null);
    }
  };

  const handleTabCompletion = () => {
    if ((!selectedChannel && !selectedPrivateChat) || !inputRef.current) return;

    // For channels, use channel users; for private chats, use both participants
    const users =
      selectedChannel?.users ||
      (selectedPrivateChat
        ? [
            ...(currentUser ? [currentUser] : []),
            {
              id: `${selectedPrivateChat.serverId}-${selectedPrivateChat.username}`,
              username: selectedPrivateChat.username,
              isOnline: true,
            },
          ]
        : []);
    const result = tabCompletion.handleTabCompletion(
      messageTextRef.current,
      cursorPositionRef.current,
      users,
    );

    if (result) {
      applyText(result.newText);
      setAutocompleteInputText(result.newText);
      cursorPositionRef.current = result.newCursorPosition;

      // Show dropdown when there are any matches available
      const shouldShow = tabCompletion.matches.length > 0;
      setShowAutocomplete(shouldShow);

      // Update input cursor position
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.setSelectionRange(
            result.newCursorPosition,
            result.newCursorPosition,
          );
        }
      }, 0);
    } else {
      // No completion result, hide dropdown
      setShowAutocomplete(false);
    }
  };

  const handleEmojiCompletion = () => {
    if (!inputRef.current) return;

    const result = emojiCompletion.handleEmojiCompletion(
      messageTextRef.current,
      cursorPositionRef.current,
    );

    if (result) {
      applyText(result.newText);
      setAutocompleteInputText(result.newText);
      cursorPositionRef.current = result.newCursorPosition;

      // Show dropdown when there are any matches available
      const shouldShow = emojiCompletion.matches.length > 0;
      setShowEmojiAutocomplete(shouldShow);

      // Update input cursor position
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.setSelectionRange(
            result.newCursorPosition,
            result.newCursorPosition,
          );
        }
      }, 0);
    } else {
      // No completion result, hide dropdown
      setShowEmojiAutocomplete(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    const newCursorPosition = e.target.selectionStart || 0;

    // Update ref — no state setter, so no ChatArea re-render on every keystroke.
    messageTextRef.current = newText;
    resizeTextarea();

    // Only trigger re-render when send-button state changes (empty ↔ non-empty).
    // On desktop the send button is never shown, so the re-render has no effect.
    const ht = newText.trim().length > 0;
    if (ht !== hasTextRef.current) {
      hasTextRef.current = ht;
      if (isNativeMobile) setHasText(ht);
    }

    cursorPositionRef.current = newCursorPosition;
    handleUpdatedText(newText);

    // obsidianirc/cmdslist: update slash state only when relevant.
    // When the input doesn't look like a command (no leading slash,
    // or already past the command name), re-render only on the
    // active->inactive transition to clear the popover.
    const slashActive =
      getActiveSlashQuery(newText, newCursorPosition) !== null;
    if (slashActive) {
      setSlashInputValue(newText);
    } else if (slashInputValue !== "") {
      setSlashInputValue("");
    }

    // Exit history mode if user starts typing
    messageHistory.exitHistory();

    // Reset tab completion if text changed from non-tab input
    if (tabCompletion.isActive) {
      tabCompletion.resetCompletion();
    }

    // Reset emoji completion if text changed from non-tab input
    if (emojiCompletion.isActive) {
      emojiCompletion.resetCompletion();
    }

    // Hide autocomplete when typing (only show on Tab completion)
    if (showAutocomplete) setShowAutocomplete(false);
    if (showEmojiAutocomplete) setShowEmojiAutocomplete(false);
  };

  const handleInputClick = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    const newCursorPos = target.selectionStart || 0;
    cursorPositionRef.current = newCursorPos;
  };

  const handleUsernameSelect = (username: string) => {
    if (tabCompletion.isActive) {
      // Use tab completion state for accurate replacement
      const isAtMessageStart =
        tabCompletion.originalText
          .substring(0, tabCompletion.completionStart)
          .trim() === tabCompletion.originalPrefix;
      const suffix = isAtMessageStart ? ": " : " ";
      const newText =
        tabCompletion.originalText.substring(0, tabCompletion.completionStart) +
        username +
        suffix +
        tabCompletion.originalText.substring(
          tabCompletion.completionStart + tabCompletion.originalPrefix.length,
        );

      applyText(newText);
      setAutocompleteInputText(newText);
      const newCursorPosition =
        tabCompletion.completionStart + username.length + suffix.length;
      cursorPositionRef.current = newCursorPosition;

      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.setSelectionRange(
            newCursorPosition,
            newCursorPosition,
          );
          inputRef.current.focus();
        }
      }, 0);
    } else {
      // Fallback to current logic when tab completion is not active
      const textBeforeCursor = messageTextRef.current.substring(
        0,
        cursorPositionRef.current,
      );
      const words = textBeforeCursor.split(/\s+/);
      const currentWord = words[words.length - 1];
      const completionStart = cursorPositionRef.current - currentWord.length;

      const isAtMessageStart = textBeforeCursor.trim() === currentWord;
      const suffix = isAtMessageStart ? ": " : " ";
      const newText =
        messageTextRef.current.substring(0, completionStart) +
        username +
        suffix +
        messageTextRef.current.substring(cursorPositionRef.current);

      applyText(newText);
      setAutocompleteInputText(newText);
      const newCursorPosition =
        completionStart + username.length + suffix.length;
      cursorPositionRef.current = newCursorPosition;

      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.setSelectionRange(
            newCursorPosition,
            newCursorPosition,
          );
          inputRef.current.focus();
        }
      }, 0);
    }

    setShowAutocomplete(false);
    tabCompletion.resetCompletion();
  };

  const handleEmojiAutocompleteSelect = (emoji: string) => {
    if (emojiCompletion.isActive) {
      // Use emoji completion state for accurate replacement
      const newText =
        emojiCompletion.originalText.substring(
          0,
          emojiCompletion.completionStart,
        ) +
        emoji +
        emojiCompletion.originalText.substring(
          emojiCompletion.completionStart +
            emojiCompletion.originalPrefix.length,
        );

      applyText(newText);
      setAutocompleteInputText(newText);
      const newCursorPosition = emojiCompletion.completionStart + emoji.length;
      cursorPositionRef.current = newCursorPosition;

      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.setSelectionRange(
            newCursorPosition,
            newCursorPosition,
          );
          inputRef.current.focus();
        }
      }, 0);
    }

    setShowEmojiAutocomplete(false);
    emojiCompletion.resetCompletion();
  };

  const handleEmojiAutocompleteClose = () => {
    setShowEmojiAutocomplete(false);
    emojiCompletion.resetCompletion();
  };

  const handleEmojiAutocompleteNavigate = (emoji: string) => {
    if (emojiCompletion.isActive) {
      // Find the index of the selected emoji to sync state
      const selectedIndex = emojiCompletion.matches.findIndex(
        (match) => match.emoji === emoji,
      );
      if (selectedIndex !== -1) {
        emojiCompletion.setCurrentIndex(selectedIndex);
      }

      // Update text in real-time like Tab completion does
      const newText =
        emojiCompletion.originalText.substring(
          0,
          emojiCompletion.completionStart,
        ) +
        emoji +
        emojiCompletion.originalText.substring(
          emojiCompletion.completionStart +
            emojiCompletion.originalPrefix.length,
        );

      applyText(newText);
      setAutocompleteInputText(newText);
      const newCursorPosition = emojiCompletion.completionStart + emoji.length;
      cursorPositionRef.current = newCursorPosition;

      // Update the hook's internal previousTextRef to prevent reset on next tab
      emojiCompletion.updatePreviousText(newText);

      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.setSelectionRange(
            newCursorPosition,
            newCursorPosition,
          );
          inputRef.current.focus();
        }
      }, 0);
    }
  };

  const handleAutocompleteClose = () => {
    setShowAutocomplete(false);
    tabCompletion.resetCompletion();
  };

  const handleAutocompleteNavigate = (username: string) => {
    if (tabCompletion.isActive) {
      // Update text in real-time like Tab completion does
      const isAtMessageStart =
        tabCompletion.originalText
          .substring(0, tabCompletion.completionStart)
          .trim() === tabCompletion.originalPrefix;
      const suffix = isAtMessageStart ? ": " : " ";
      const newText =
        tabCompletion.originalText.substring(0, tabCompletion.completionStart) +
        username +
        suffix +
        tabCompletion.originalText.substring(
          tabCompletion.completionStart + tabCompletion.originalPrefix.length,
        );

      applyText(newText);
      setAutocompleteInputText(newText);
      const newCursorPosition =
        tabCompletion.completionStart + username.length + suffix.length;
      cursorPositionRef.current = newCursorPosition;

      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.setSelectionRange(
            newCursorPosition,
            newCursorPosition,
          );
          inputRef.current.focus();
        }
      }, 0);
    }
  };

  const handleInputKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Skip if it was Tab key (handled by keyDown)
    if (e.key === "Tab") return;

    const target = e.target as HTMLTextAreaElement;
    const newCursorPos = target.selectionStart || 0;
    cursorPositionRef.current = newCursorPos;
  };

  const handleUpdatedText = (text: string) => {
    const target = selectedChannel?.name ?? selectedPrivateChat?.username;
    if (!target) return;
    typingNotification.notifyTyping(target, text);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: reads servers/currentUser via getState() to avoid stale deps and prevent re-creation on every store update
  const handleUsernameClick = useCallback(
    (
      e: React.MouseEvent,
      username: string,
      serverId: string,
      channelId: string,
      avatarElement?: Element | null,
    ) => {
      e.preventDefault();
      e.stopPropagation();

      // Read fresh state to avoid closure staleness without adding frequently-changing deps
      const { servers: currentServers } = useStore.getState();
      const ircCurrentUser = ircClient.getCurrentUser(serverId);

      // Don't show context menu for own username
      if (ircCurrentUser?.username === username) {
        return;
      }

      let x = e.clientX;
      let y = e.clientY;

      // If avatar element is provided, position menu relative to it
      if (avatarElement) {
        const rect = avatarElement.getBoundingClientRect();
        x = rect.left;
        y = rect.top - 5; // Position above the avatar with small gap
      }

      // Calculate user's status in the specific channel
      let userStatusInChannel: string | undefined;
      if (channelId && channelId !== "server-notices") {
        const selectedServer = currentServers.find((s) => s.id === serverId);
        const channel = selectedServer?.channels.find(
          (c) => c.id === channelId,
        );
        if (channel && ircCurrentUser) {
          const userInChannel =
            channel.users.find(
              (u) =>
                u.username.toLowerCase() ===
                ircCurrentUser.username.toLowerCase(),
            ) ||
            selectedServer?.users.find(
              (u) =>
                u.username.toLowerCase() ===
                ircCurrentUser.username.toLowerCase(),
            );
          userStatusInChannel = userInChannel?.status;
        }
      }

      setUserContextMenu({
        isOpen: true,
        x,
        y,
        username,
        serverId,
        channelId,
        userStatusInChannel,
      });
    },
    [setUserContextMenu],
  );

  const handleCloseUserContextMenu = () => {
    setUserContextMenu({
      isOpen: false,
      x: 0,
      y: 0,
      username: "",
      serverId: "",
      channelId: "",
    });
  };

  const handleOpenPM = (username: string) => {
    if (selectedServerId) {
      openPrivateChat(selectedServerId, username);
      // Read fresh store state so newly-created DMs are visible (stale closure fix)
      const server = useStore
        .getState()
        .servers.find((s) => s.id === selectedServerId);
      const privateChat = server?.privateChats?.find(
        (pc) => pc.username === username,
      );
      if (privateChat) {
        selectPrivateChat(privateChat.id, { navigate: true });
      }
    }
  };

  const handleOpenProfile = useCallback((username: string) => {
    setSelectedProfileUsername(username);
    setUserProfileModalOpen(true);
  }, []);

  // Server notices popup drag handlers
  const handleServerNoticesMouseDown = (e: React.MouseEvent) => {
    setIsDraggingServerNotices(true);
    setServerNoticesDragStart({
      x: e.clientX - serverNoticesPopupPosition.x,
      y: e.clientY - serverNoticesPopupPosition.y,
    });
  };

  const handleServerNoticesMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDraggingServerNotices) return;

      const newX = e.clientX - serverNoticesDragStart.x;
      const newY = e.clientY - serverNoticesDragStart.y;

      // Constrain to viewport bounds (with some margin)
      const maxX = window.innerWidth - 620; // 600px width + 20px margin
      const maxY = window.innerHeight - 520; // 500px height + 20px margin

      setServerNoticesPopupPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
    },
    [isDraggingServerNotices, serverNoticesDragStart],
  );

  const handleServerNoticesMouseUp = useCallback(() => {
    setIsDraggingServerNotices(false);
  }, []);

  // Server notices popup drag effect
  useEffect(() => {
    if (isDraggingServerNotices) {
      document.addEventListener("mousemove", handleServerNoticesMouseMove);
      document.addEventListener("mouseup", handleServerNoticesMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleServerNoticesMouseMove);
      document.removeEventListener("mouseup", handleServerNoticesMouseUp);
    };
  }, [
    isDraggingServerNotices,
    handleServerNoticesMouseMove,
    handleServerNoticesMouseUp,
  ]);

  const handleReactClick = useCallback(
    (message: MessageType, buttonElement: Element) => {
      setReactionAnchorRect(buttonElement.getBoundingClientRect());
      openReactionModal(message);
    },
    [openReactionModal],
  );

  const handleCloseModerationModal = () => {
    setModerationModal({
      isOpen: false,
      action: "warn",
      username: "",
    });
  };

  const handleModerationConfirm = (
    action: ModerationAction,
    reason: string,
  ) => {
    const { username } = moderationModal;
    switch (action) {
      case "warn":
        if (selectedServerId && selectedChannel?.name) {
          warnUser(selectedServerId, selectedChannel.name, username, reason);
        }
        break;
      case "kick":
        if (selectedServerId && selectedChannel?.name) {
          kickUser(selectedServerId, selectedChannel.name, username, reason);
        }
        break;
      case "ban-nick":
        if (selectedServerId && selectedChannel?.name) {
          banUserByNick(
            selectedServerId,
            selectedChannel.name,
            username,
            reason,
          );
        }
        break;
      case "ban-hostmask":
        if (selectedServerId && selectedChannel?.name) {
          banUserByHostmask(
            selectedServerId,
            selectedChannel.name,
            username,
            reason,
          );
        }
        break;
    }
    handleCloseModerationModal();
  };

  const handleRedactMessage = useCallback(
    (message: MessageType) => {
      if (message.msgid && selectedServerId) {
        const confirmed = window.confirm(
          t`Are you sure you want to delete this message? This action cannot be undone.`,
        );
        if (confirmed) {
          const { servers: currentServers } = useStore.getState();
          const server = currentServers.find((s) => s.id === selectedServerId);
          if (!server) return;

          let target: string | undefined;
          if (message.channelId) {
            const channel = server.channels.find(
              (c) => c.id === message.channelId,
            );
            target = channel?.name;
          } else {
            // Private message, find by userId
            const privateChat = server.privateChats?.find(
              (pc) => pc.username === message.userId,
            );
            target = privateChat?.username;
          }

          if (target) {
            redactMessage(selectedServerId, target, message.msgid);
          }
        }
      }
    },
    [selectedServerId, redactMessage, t],
  );

  const handleEmojiSelect = (emojiData: EmojiClickData) => {
    applyText(messageTextRef.current + emojiClickValue(emojiData));
    setIsEmojiSelectorOpen(false);
  };

  const handleEmojiModalBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setIsEmojiSelectorOpen(false);
    }
  };

  const handleAtButtonClick = () => {
    setShowMembersDropdown((prev) => {
      const newValue = !prev;
      // Close other dropdowns when opening members dropdown
      if (newValue) {
        setAutocompleteInputText(messageTextRef.current);
        setShowAutocomplete(false);
        setShowEmojiAutocomplete(false);
        setIsEmojiSelectorOpen(false);
        setIsColorPickerOpen(false);
        emojiCompletion.resetCompletion();
        tabCompletion.resetCompletion();
      }
      return newValue;
    });
  };

  const toggleFormatting = (format: FormattingType) => {
    setSelectedFormatting((prev) =>
      prev.includes(format)
        ? prev.filter((f) => f !== format)
        : [...prev, format],
    );
  };

  // Focus input on channel change
  // biome-ignore lint/correctness/useExhaustiveDependencies(selectedChannelId): Only focus when channel changes
  // biome-ignore lint/correctness/useExhaustiveDependencies(selectedPrivateChatId): Only focus when private chat changes
  useEffect(() => {
    if (isTauriMobile()) return;
    // Don't steal focus if any modal is open
    if (
      isSettingsModalOpen ||
      userProfileModalOpen ||
      isAddServerModalOpen ||
      isChannelListModalOpen
    )
      return;
    inputRef.current?.focus();
  }, [
    selectedChannelId,
    selectedPrivateChatId,
    isSettingsModalOpen,
    userProfileModalOpen,
    isAddServerModalOpen,
    isChannelListModalOpen,
  ]);

  return (
    <div className="flex flex-col h-full">
      {/* Channel header */}
      <ChatHeader
        selectedChannel={selectedChannel ?? null}
        selectedPrivateChat={selectedPrivateChat ?? null}
        selectedServerId={selectedServerId}
        selectedChannelId={selectedChannelId}
        currentUser={currentUser}
        isChanListVisible={isChanListVisible}
        isMemberListVisible={isMemberListVisible}
        isNarrowView={isNarrowView}
        globalSettings={globalSettings}
        searchQuery={searchQuery}
        onToggleChanList={onToggleChanList}
        onToggleMemberList={() => toggleMemberList(!isMemberListVisible)}
        onSearchQueryChange={setSearchQuery}
        onToggleNotificationVolume={handleToggleNotificationVolume}
        onOpenChannelSettings={() => setChannelSettingsModalOpen(true)}
        onOpenInviteUser={() => setInviteUserModalOpen(true)}
      />

      {topSlot && (
        <div className="flex-shrink-0 max-h-[60%] overflow-y-auto border-b border-discord-dark-300">
          {topSlot}
        </div>
      )}

      <TopicMediaStrip />
      <MiniMediaPlayer />
      {/* Member list overlay replaces messages when desktop is too narrow for sidebar */}
      {showMemberListOverlay && (
        <div className="flex-grow overflow-hidden bg-discord-dark-100">
          <MemberList />
        </div>
      )}
      {/* Messages area */}
      {!showMemberListOverlay && (
        <>
          {selectedServer &&
            !selectedChannel &&
            !selectedPrivateChat &&
            selectedChannelId !== "server-notices" &&
            (bouncers[selectedServer.id]?.supported &&
            !selectedServer.bouncerNetid ? (
              <div className="flex-grow min-h-0 flex flex-col">
                <BouncerNetworksPanel bouncerServerId={selectedServer.id} />
              </div>
            ) : (
              <div className="flex-grow flex flex-col items-center justify-center bg-discord-dark-200">
                <BlankPage />
              </div>
            ))}
          {!selectedServer && <DiscoverGrid />}

          {/* Keep-alive channel message lists — last 3 channels stay in DOM with
              display:none to preserve scroll position across channel switches.
              HTML5 <video>/<audio> elements keep playing inside display:none (no
              suspension), so video/audio background playback continues uninterrupted.
              Embedded iframes (YouTube) are suspended by the browser, but we
              explicitly stop embed media on channel switch (see effect below). */}
          <div
            className={`flex flex-col min-h-0 ${channelKey ? "flex-grow" : ""}`}
          >
            {aliveChannels.map(
              ({
                key,
                serverId: aServerId,
                channelId: aChannelId,
                privateChatId: aPrivateChatId,
              }) => {
                const isKeyActive = key === channelKey;
                const savedScrollState = scrollPositionMapRef.current.get(key);
                return (
                  <div
                    key={key}
                    className={
                      isKeyActive ? "flex flex-col flex-grow min-h-0" : "hidden"
                    }
                  >
                    <ChannelMessageList
                      ref={(handle) => {
                        if (handle) channelListRefs.current.set(key, handle);
                        else channelListRefs.current.delete(key);
                      }}
                      channelKey={key}
                      initialScrollState={savedScrollState}
                      serverId={aServerId}
                      channelId={aChannelId}
                      privateChatId={aPrivateChatId}
                      isActive={isKeyActive}
                      searchQuery={isKeyActive ? searchQuery : ""}
                      isMemberListVisible={isMemberListVisible}
                      onReply={handleSetReplyTo}
                      highlightedMessageId={
                        isKeyActive
                          ? (navHighlightedMsgId ?? undefined)
                          : undefined
                      }
                      onUsernameContextMenu={handleUsernameClick}
                      onIrcLinkClick={handleIrcLinkClick}
                      onReactClick={handleReactClick}
                      onReactionUnreact={unreact}
                      onOpenReactionModal={openReactionModal}
                      onDirectReaction={directReaction}
                      onRedactMessage={handleRedactMessage}
                      onOpenProfile={handleOpenProfile}
                      joinChannel={joinChannel}
                      onClearSearch={handleClearSearch}
                    />
                  </div>
                );
              },
            )}
          </div>

          {/* Input area */}
          {(selectedChannel || selectedPrivateChat) && (
            <div
              className={`${!isNarrowView && "px-4"} pb-4 relative chat-input-area`}
            >
              {localReplyTo && (
                <MessageReply
                  replyMessage={localReplyTo}
                  theme="discord"
                  onClose={() => {
                    setLocalReplyTo(null);
                    setNavHighlightedMsgId(null);
                  }}
                />
              )}
              <TypingIndicator
                serverId={selectedServerId ?? ""}
                channelId={selectedChannelId || selectedPrivateChatId || ""}
              />
              <div
                className={`bg-discord-dark-100 ${localReplyTo ? "rounded-b-lg" : "rounded-lg"} flex items-center relative flex-nowrap`}
              >
                <button
                  className="px-2 sm:px-4 text-discord-text-muted hover:text-discord-text-normal flex-shrink-0"
                  onClick={() => setShowPlusMenu((prev) => !prev)}
                >
                  <FaPlus />
                </button>

                <TextArea
                  ref={inputRef}
                  defaultValue=""
                  onChange={handleInputChange}
                  onClick={handleInputClick}
                  onKeyUp={handleInputKeyUp}
                  onKeyDown={handleKeyDown}
                  onBeforeInput={onBeforeInputGuard}
                  autoCorrect={isMobileInput ? "on" : "off"}
                  autoCapitalize={isMobileInput ? "sentences" : "off"}
                  spellCheck={isMobileInput}
                  placeholder={
                    selectedChannel
                      ? globalSettings.enableMultilineInput &&
                        !isNativeMobile &&
                        !isCompactInput
                        ? globalSettings.multilineOnShiftEnter
                          ? t`Message #${selectedChannel.name.replace(/^#/, "")} (Shift+Enter for new line)`
                          : t`Message #${selectedChannel.name.replace(/^#/, "")} (Enter for new line, Shift+Enter to send)`
                        : t`Message #${selectedChannel.name.replace(/^#/, "")}`
                      : selectedPrivateChat
                        ? globalSettings.enableMultilineInput &&
                          !isMobile &&
                          !isCompactInput
                          ? globalSettings.multilineOnShiftEnter
                            ? t`Message @${selectedPrivateChat.username} (Shift+Enter for new line)`
                            : t`Message @${selectedPrivateChat.username} (Enter for new line, Shift+Enter to send)`
                          : t`Message @${selectedPrivateChat.username}`
                        : t`Type a message...`
                  }
                  enterKeyHint={
                    isNativeMobile && globalSettings.enableMultilineInput
                      ? "enter"
                      : "send"
                  }
                  className="bg-transparent border-none outline-none py-3 flex-grow text-discord-text-normal resize-none min-h-[44px] overflow-y-auto placeholder:truncate"
                  style={previewStyle}
                  rows={1}
                />
                <InputToolbar
                  selectedColor={selectedColor}
                  onEmojiClick={() => {
                    setIsEmojiSelectorOpen((prev) => !prev);
                    setIsColorPickerOpen(false);
                    setShowMembersDropdown(false);
                  }}
                  onColorPickerClick={() => {
                    setIsColorPickerOpen((prev) => !prev);
                    setIsEmojiSelectorOpen(false);
                    setShowMembersDropdown(false);
                  }}
                  onAtClick={handleAtButtonClick}
                  onSendClick={handleSendMessage}
                  showSendButton={isNativeMobile}
                  hideEmoji={isNativeMobile}
                  hasText={hasText}
                />
              </div>

              {/* Plus menu */}
              {showPlusMenu && (
                <div
                  className="plus-menu absolute bg-discord-dark-200 rounded-lg shadow-lg border border-discord-dark-300 min-w-48 z-50"
                  style={{
                    bottom: "calc(100% + 8px)",
                    left: "16px",
                  }}
                >
                  {selectedServer?.filehost && (
                    <button
                      className="w-full text-left px-4 py-2 text-discord-text-normal hover:bg-discord-dark-300 rounded-lg flex items-center"
                      onClick={() => {
                        // Multi-file picker: images, videos, audio.
                        // The backend's allowlist is the source of
                        // truth, but we hint accept= so the OS file
                        // dialog filters sensibly.
                        const input = document.createElement("input");
                        input.type = "file";
                        input.multiple = true;
                        input.accept = "image/*,video/*,audio/*";
                        input.onchange = (e) => {
                          const files = Array.from(
                            (e.target as HTMLInputElement).files ?? [],
                          );
                          if (files.length === 0) return;
                          // For a single image, keep the legacy
                          // confirm-then-upload preview UX so users
                          // can see the picture before sending.
                          if (
                            files.length === 1 &&
                            files[0].type.startsWith("image/")
                          ) {
                            const previewUrl = URL.createObjectURL(files[0]);
                            setImagePreview({
                              isOpen: true,
                              file: files[0],
                              previewUrl,
                            });
                            return;
                          }
                          // Multi-file or non-image: go straight to
                          // upload with the progress strip.
                          handleFilesUpload(files);
                        };
                        input.click();
                        setShowPlusMenu(false);
                      }}
                    >
                      <FaPlus className="mr-2" />
                      <Trans>Upload Files</Trans>
                    </button>
                  )}
                  <button
                    className="w-full text-left px-4 py-2 text-discord-text-normal hover:bg-discord-dark-300 rounded-lg flex items-center"
                    onClick={() => {
                      setIsGifSelectorOpen(true);
                      setShowPlusMenu(false);
                    }}
                  >
                    <FaGift className="mr-2" />
                    <Trans>Send a GIF</Trans>
                  </button>
                  {/* Add more menu items here if needed */}
                </div>
              )}

              {isNarrowView && (
                <EmojiPickerModal
                  isOpen={isEmojiSelectorOpen}
                  onEmojiClick={handleEmojiSelect}
                  onClose={() => setIsEmojiSelectorOpen(false)}
                  onBackdropClick={handleEmojiModalBackdropClick}
                  customEmojis={pickerCustomEmojis}
                />
              )}

              <GifSelector
                isOpen={isGifSelectorOpen}
                onClose={() => setIsGifSelectorOpen(false)}
                onSelectGif={(gifUrl) => {
                  // Send the GIF URL directly to the channel
                  handleGifSend(gifUrl);
                  setIsGifSelectorOpen(false);
                }}
              />

              {isColorPickerOpen && (
                <ColorPicker
                  isNarrowView={isNarrowView}
                  onSelect={(color) => setSelectedColor(color)}
                  onClose={() => setIsColorPickerOpen(false)}
                  selectedColor={selectedColor} // Pass the selected color
                  selectedFormatting={selectedFormatting}
                  toggleFormatting={toggleFormatting}
                />
              )}

              {!isNarrowView && (
                <EmojiPickerInline
                  isOpen={isEmojiSelectorOpen}
                  onEmojiClick={(e) =>
                    applyText(messageTextRef.current + emojiClickValue(e))
                  }
                  onClose={() => setIsEmojiSelectorOpen(false)}
                  customEmojis={pickerCustomEmojis}
                />
              )}

              {/* Multi-file upload progress strip, anchored above input */}
              <UploadProgressOverlay
                jobs={uploadJobs}
                onCancel={cancelUploadJob}
              />

              <AutocompleteDropdown
                users={
                  selectedChannel?.users ||
                  (selectedPrivateChat
                    ? [
                        ...(currentUser ? [currentUser] : []),
                        {
                          id: `${selectedPrivateChat.serverId}-${selectedPrivateChat.username}`,
                          username: selectedPrivateChat.username,
                          isOnline: true,
                        },
                      ]
                    : [])
                }
                isVisible={showAutocomplete}
                inputValue={autocompleteInputText}
                cursorPosition={cursorPositionRef.current}
                tabCompletionMatches={tabCompletion.matches}
                currentMatchIndex={tabCompletion.currentIndex}
                onSelect={handleUsernameSelect}
                onClose={handleAutocompleteClose}
                onNavigate={handleAutocompleteNavigate}
                inputElement={inputRef.current}
              />

              <EmojiAutocompleteDropdown
                isVisible={showEmojiAutocomplete || emojiCompletion.isActive}
                inputValue={autocompleteInputText}
                cursorPosition={cursorPositionRef.current}
                emojiMatches={emojiCompletion.matches}
                currentMatchIndex={emojiCompletion.currentIndex}
                onSelect={handleEmojiAutocompleteSelect}
                onClose={handleEmojiAutocompleteClose}
                onNavigate={handleEmojiAutocompleteNavigate}
                inputElement={inputRef.current}
              />

              {/* obsidianirc/cmdslist: slash-command suggestion popover */}
              {(() => {
                const srv = servers.find((s) => s.id === selectedServerId);
                const cmds = srv?.cmdsAvailable ?? [];
                if (cmds.length === 0) return null;
                const slashActive =
                  getActiveSlashQuery(
                    slashInputValue,
                    cursorPositionRef.current,
                  ) !== null;
                return (
                  <SlashCommandPopover
                    isVisible={slashActive}
                    inputValue={slashInputValue}
                    commands={cmds}
                    inputElement={inputRef.current}
                    onSelect={(cmd) => {
                      // Replace the partial command with /<cmd> + space
                      // and put the cursor right after the space.
                      const next = `/${cmd} `;
                      applyText(next);
                      cursorPositionRef.current = next.length;
                      setSlashInputValue("");
                      inputRef.current?.focus();
                      inputRef.current?.setSelectionRange(
                        next.length,
                        next.length,
                      );
                    }}
                    onClose={() => {
                      setSlashInputValue("");
                    }}
                  />
                );
              })()}

              {/* Members dropdown triggered by @ button */}
              <AutocompleteDropdown
                isNarrowView={isNarrowView}
                users={
                  selectedChannel?.users ||
                  (selectedPrivateChat
                    ? [
                        ...(currentUser ? [currentUser] : []),
                        {
                          id: `${selectedPrivateChat.serverId}-${selectedPrivateChat.username}`,
                          username: selectedPrivateChat.username,
                          isOnline: true,
                        },
                      ]
                    : [])
                }
                isVisible={showMembersDropdown}
                inputValue={autocompleteInputText}
                cursorPosition={cursorPositionRef.current}
                tabCompletionMatches={[]}
                currentMatchIndex={-1}
                onSelect={(username) => {
                  const isAtMessageStart = messageTextRef.current.trim() === "";
                  const suffix = isAtMessageStart ? ": " : " ";
                  applyText(messageTextRef.current + username + suffix);
                  setShowMembersDropdown(false);
                }}
                onClose={() => setShowMembersDropdown(false)}
                onNavigate={() => {}}
                inputElement={inputRef.current}
                isAtButtonTriggered={true}
              />
            </div>
          )}
        </>
      )}
      <UserContextMenu
        isOpen={userContextMenu.isOpen}
        x={userContextMenu.x}
        y={userContextMenu.y}
        username={userContextMenu.username}
        serverId={userContextMenu.serverId}
        channelId={userContextMenu.channelId}
        onClose={handleCloseUserContextMenu}
        onOpenPM={handleOpenPM}
        onOpenProfile={handleOpenProfile}
        currentUserStatus={userContextMenu.userStatusInChannel}
        currentUsername={
          ircClient.getCurrentUser(userContextMenu.serverId)?.username
        }
        onOpenModerationModal={(action) => {
          setModerationModal({
            isOpen: true,
            action,
            username: userContextMenu.username,
          });
        }}
      />
      {isNarrowView ? (
        <ReactionModal
          isOpen={reactionModal.isOpen}
          onClose={closeReactionModal}
          onSelectEmoji={selectReaction}
          reactedEmojis={reactedEmojis}
        />
      ) : (
        <ReactionPopover
          isOpen={reactionModal.isOpen}
          anchorRect={reactionAnchorRect}
          onClose={closeReactionModal}
          onSelectEmoji={selectReaction}
          reactedEmojis={reactedEmojis}
        />
      )}
      <ModerationModal
        isOpen={moderationModal.isOpen}
        onClose={handleCloseModerationModal}
        onConfirm={handleModerationConfirm}
        username={moderationModal.username}
        action={moderationModal.action}
      />
      {selectedChannel && (
        <ChannelSettingsModal
          isOpen={channelSettingsModalOpen}
          onClose={() => setChannelSettingsModalOpen(false)}
          serverId={selectedServerId || ""}
          channelName={selectedChannel.name}
        />
      )}
      {selectedChannel && selectedServerId && (
        <InviteUserModal
          isOpen={inviteUserModalOpen}
          onClose={() => setInviteUserModalOpen(false)}
          serverId={selectedServerId}
          channelName={selectedChannel.name}
        />
      )}
      {selectedServerId && (
        <UserProfileModal
          isOpen={userProfileModalOpen}
          onClose={() => setUserProfileModalOpen(false)}
          serverId={selectedServerId}
          username={selectedProfileUsername}
        />
      )}
      {/* Image Preview Dialog */}
      <ImagePreviewModal
        isOpen={imagePreview.isOpen}
        file={imagePreview.file}
        previewUrl={imagePreview.previewUrl}
        onCancel={() => {
          // Clean up preview URL
          if (imagePreview.previewUrl) {
            URL.revokeObjectURL(imagePreview.previewUrl);
          }
          setImagePreview({
            isOpen: false,
            file: null,
            previewUrl: null,
          });
        }}
        onUpload={() => {
          if (imagePreview.file) {
            // Route through the new progress-aware path so single-file
            // uploads also get the "uploading…" overlay.
            handleFilesUpload([imagePreview.file]);
          }
          // Clean up preview URL
          if (imagePreview.previewUrl) {
            URL.revokeObjectURL(imagePreview.previewUrl);
          }
          setImagePreview({
            isOpen: false,
            file: null,
            previewUrl: null,
          });
        }}
      />
      {/* Popped out server notices window */}
      {isServerNoticesPoppedOut &&
        createPortal(
          <div
            className="fixed w-[600px] h-[500px] bg-discord-dark-200 border border-discord-dark-400 rounded-lg shadow-xl z-[10002] flex flex-col"
            style={{
              left: serverNoticesPopupPosition.x,
              top: serverNoticesPopupPosition.y,
            }}
          >
            <div
              className="h-12 min-h-[48px] px-4 border-b border-discord-dark-400 flex items-center justify-between shadow-sm bg-discord-dark-400 cursor-move"
              onMouseDown={handleServerNoticesMouseDown}
            >
              <div className="flex items-center">
                <FaList className="text-discord-text-muted mr-2" />
                <h2 className="font-bold text-white">
                  <Trans>Server Notices</Trans>
                </h2>
              </div>
              <button
                className="text-discord-text-muted hover:text-discord-text-normal"
                onClick={() => setIsServerNoticesPoppedOut(false)}
                title={t`Close popped out server notices`}
              >
                <FaTimes />
              </button>
            </div>
            <div
              ref={serverNoticesScrollRef}
              onScroll={handleServerNoticesScroll}
              className="flex-grow overflow-y-auto p-4 space-y-2"
            >
              {(
                messages[
                  selectedServerId ? `${selectedServerId}-server-notices` : ""
                ] || []
              )
                .filter((msg: MessageType) => msg.type === "notice")
                .slice(-50) // Show last 50 messages
                .map(
                  (message: MessageType, index: number, arr: MessageType[]) => {
                    const previousMessage = arr[index - 1];
                    const showHeader =
                      !previousMessage ||
                      previousMessage.userId !== message.userId ||
                      new Date(message.timestamp).getTime() -
                        new Date(previousMessage.timestamp).getTime() >
                        5 * 60 * 1000;

                    return (
                      <MessageItem
                        key={message.id}
                        message={message}
                        showDate={
                          index === 0 ||
                          new Date(message.timestamp).toDateString() !==
                            new Date(previousMessage?.timestamp).toDateString()
                        }
                        showHeader={showHeader}
                        setReplyTo={handleSetReplyTo}
                        onUsernameContextMenu={(
                          e,
                          username,
                          serverId,
                          channelId,
                          avatarElement,
                        ) =>
                          handleUsernameClick(
                            e,
                            username,
                            serverId,
                            channelId,
                            avatarElement,
                          )
                        }
                        onIrcLinkClick={handleIrcLinkClick}
                        onReactClick={handleReactClick}
                        joinChannel={joinChannel}
                        onReactionUnreact={unreact}
                        onOpenReactionModal={openReactionModal}
                        onDirectReaction={directReaction}
                        serverId={selectedServerId || ""}
                        channelId={undefined}
                        onRedactMessage={handleRedactMessage}
                        onOpenProfile={handleOpenProfile}
                      />
                    );
                  },
                )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default ChatArea;
