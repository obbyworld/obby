import { Trans, useLingui } from "@lingui/react/macro";
import type { EmojiClickData } from "emoji-picker-react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FaArrowLeft,
  FaCamera,
  FaDesktop,
  FaGift,
  FaList,
  FaMapMarkerAlt,
  FaMicrophone,
  FaPlus,
  FaTimes,
  FaVectorSquare,
} from "react-icons/fa";
import { v4 as uuidv4 } from "uuid";
import { useShallow } from "zustand/react/shallow";
import { useAutoFocusTyping } from "../../hooks/useAutoFocusTyping";
import { useCompletion } from "../../hooks/useCompletion";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useMentionAutocorrectGuard } from "../../hooks/useMentionAutocorrectGuard";
import { useMessageHistory } from "../../hooks/useMessageHistory";
import { useMessageSending } from "../../hooks/useMessageSending";
import { useReactions } from "../../hooks/useReactions";
import { isScrolledToBottom } from "../../hooks/useScrollToBottom";
import { useTypingNotification } from "../../hooks/useTypingNotification";
import { useWindowFileCapture } from "../../hooks/useWindowFileCapture";
import {
  pickRecordingFormat,
  pickVideoRecordingFormat,
} from "../../lib/audioRecording";
import { waitForAuthToken } from "../../lib/authToken";
import { getClientCommands } from "../../lib/clientCommands";
import { useEmojiResolver } from "../../lib/customEmoji";
import {
  emojiClickValue,
  packEntriesForPicker,
} from "../../lib/customEmojiPicker";
import {
  buildMediaDescriptor,
  CIPHERTEXT_EXTENSION,
  canEncryptMedia,
  ciphertextFileName,
  encryptMedia,
  type PlainUploadReason,
  readFileBytes,
  wrapForUpload,
} from "../../lib/e2ee/media";
import { e2eeSessionKey } from "../../lib/e2ee/session";
import { locationSharingSupported } from "../../lib/geolocation";
import { findMessageRow } from "../../lib/highlightRow";
import ircClient from "../../lib/ircClient";
import { parseIrcUrl } from "../../lib/ircUrlParser";
import { listDevices, screenCaptureSupported } from "../../lib/mediaDevices";
import {
  describeUploadFailure,
  fetchUploadInfo,
  type UploadInfo,
  uploadFile,
  uploadFileTokenless,
  validateFileAgainstInfo,
} from "../../lib/mediaUpload";
import {
  type FormattingType,
  getPreviewStyles,
  isValidFormattingType,
} from "../../lib/messageFormatter";
import { GROUP_WINDOW_MS } from "../../lib/messageGrouping";
import { toggleNotificationSound } from "../../lib/notificationVolume";
import { isMac, isMobileDevice, isTauriMobile } from "../../lib/platformUtils";
import { maxRecordingBytes } from "../../lib/recordingLimits";
import { regionRecordingSupported } from "../../lib/screenRecorder";
import {
  focusMainWindow,
  type SelectedRegion,
  selectScreenRegion,
} from "../../lib/screenRegion";
import useStore from "../../store";
import { sendEncryptedMedia } from "../../store/handlers/e2ee";
import { injectSystemNotice } from "../../store/handlers/e2eeConversation";
import {
  pmEncryptionPosture,
  routeOutgoingPM,
} from "../../store/handlers/e2eeOutbound";
import { queryUncachedBotsInChannel } from "../../store/handlers/pushbot";
import type { BotCommand, Message as MessageType, User } from "../../types";
import {
  type EmojiItem,
  emojiProvider,
  getActiveSlashQuery,
  nickProvider,
  type SlashSuggestion,
  slashProvider,
  slashSuggestions,
  useEmojiItems,
} from "../chat/completionProviders";
import { MessageItem } from "../message/MessageItem";
import { MessageReply } from "../message/MessageReply";
import { AttachmentTray, type PendingAttachment } from "../ui/AttachmentTray";
import BlankPage from "../ui/BlankPage";
import { BotToolsTray } from "../ui/BotToolsTray";
import { BouncerNetworksPanel } from "../ui/BouncerNetworksPanel";
import { CameraCaptureModal } from "../ui/CameraCaptureModal";
import ColorPicker from "../ui/ColorPicker";
import CompletionList from "../ui/CompletionList";
import { E2EERequestBanner } from "../ui/E2EERequestBanner";
import E2EEVerifyModal from "../ui/E2EEVerifyModal";
import { EmojiPickerInline } from "../ui/EmojiPickerInline";
import { EmojiPickerModal } from "../ui/EmojiPickerModal";
import GifSelector, { gifProviders } from "../ui/GifSelector";
import DiscoverGrid from "../ui/HomeScreen";
import { InputToolbar } from "../ui/InputToolbar";
import InviteUserModal from "../ui/InviteUserModal";
import { LocationShareModal } from "../ui/LocationShareModal";
import MemberPicker from "../ui/MemberPicker";
import Menu from "../ui/Menu";
import { MiniMediaPlayer } from "../ui/MiniMediaPlayer";
import ModerationModal, { type ModerationAction } from "../ui/ModerationModal";
import PluginsScreen from "../ui/PluginsScreen";
import ReactionModal from "../ui/ReactionModal";
import { ReactionPopover } from "../ui/ReactionPopover";
import { type RecordingKind, RecordingPanel } from "../ui/RecordingPanel";
import {
  type RecordingFailure,
  RegionRecordingBar,
} from "../ui/RegionRecordingBar";
import { SlashCommandParamModal } from "../ui/SlashCommandParamModal";
import { SlashParamHint } from "../ui/SlashParamHint";
import { TextArea } from "../ui/TextInput";
import { TopicMediaStrip } from "../ui/TopicMediaStrip";
import { TypingIndicator } from "../ui/TypingIndicator";
import UnencryptedUploadConfirmModal from "../ui/UnencryptedUploadConfirmModal";
import {
  type UploadJob,
  UploadProgressOverlay,
} from "../ui/UploadProgressOverlay";
import UserContextMenu from "../ui/UserContextMenu";
import {
  MemoChannelMessageList as ChannelMessageList,
  type ChannelMessageListHandle,
  DEFAULT_VISIBLE_MESSAGE_COUNT,
} from "./ChannelMessageList";
import { ChatHeader } from "./ChatHeader";
import { SidePane } from "./SidePane";

interface AliveChannel {
  key: string;
  serverId: string;
  channelId: string | null;
  privateChatId: string | null;
}

/** Whether an upload got as far as the network. "held" waits on a person to
 *  answer the unencrypted-upload warning, which keeps the files itself. */
type UploadOutcome = "started" | "held" | "failed";

/** A stable empty list, so a conversation with nothing attached does not hand
 *  the tray a new array on every render. */
const NO_ATTACHMENTS: PendingAttachment[] = [];

const NO_COMPLETION_INPUT = { text: "", caret: 0 };
const MODIFIER_KEYS = ["Shift", "Control", "Alt", "Meta"];

function previewable(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    file.type.startsWith("video/") ||
    file.type.startsWith("audio/")
  );
}

function releasePreview(attachment: PendingAttachment): void {
  if (attachment.kind === "file" && attachment.previewUrl) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

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
  // completionInput mirrors the text only while a completion can be open.
  const [hasText, setHasText] = useState(false);
  const [completionInput, setCompletionInput] = useState(NO_COMPLETION_INPUT);
  const [paramModal, setParamModal] = useState<{
    botNick: string;
    command: BotCommand;
  } | null>(null);
  const [isEmojiSelectorOpen, setIsEmojiSelectorOpen] = useState(false);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [selectedFormatting, setSelectedFormatting] = useState<
    FormattingType[]
  >([]);
  const [isFormattingInitialized, setIsFormattingInitialized] = useState(false);
  const cursorPositionRef = useRef(0);
  const [showMembersDropdown, setShowMembersDropdown] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [isGifSelectorOpen, setIsGifSelectorOpen] = useState(false);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [recordingRegion, setRecordingRegion] = useState<SelectedRegion | null>(
    null,
  );
  const [regionRecordingReady, setRegionRecordingReady] = useState(false);
  const [recordingKind, setRecordingKind] = useState<RecordingKind | null>(
    null,
  );
  const plusButtonRef = useRef<HTMLButtonElement>(null);
  // We check once on mount and again whenever the plus menu opens, so a
  // device plugged in mid-session is picked up there.
  const [hasMicrophoneInput, setHasMicrophoneInput] = useState(false);
  const [hasCameraInput, setHasCameraInput] = useState(false);
  // We treat null, meaning no queryable policy or a fetch still in flight, as
  // unrestricted.
  const [uploadInfo, setUploadInfo] = useState<UploadInfo | null>(null);
  // Keyed the way drafts are, so walking to another conversation never carries
  // a file along to be sent there.
  const [attachmentsByChannel, setAttachmentsByChannel] = useState<
    Record<string, PendingAttachment[]>
  >({});
  // Multimedia uploads in flight.  Each job tracks one file's
  // XHR-driven progress; once they all settle we send a single
  // PRIVMSG with the URLs joined.
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>([]);
  const uploadAbortsRef = useRef<Map<string, AbortController>>(new Map());
  // Files held back because sending them would break the lock this
  // conversation is showing. Released only by an explicit confirmation.
  const [pendingPlainUpload, setPendingPlainUpload] = useState<{
    files: File[];
    caption: string;
    links: string[];
    reason: PlainUploadReason;
    // The upload path reads the current selection, so the conversation the
    // warning was raised about is pinned here. Otherwise a confirmation aimed
    // at one peer would send to whichever chat is open when it is answered.
    nick: string;
  } | null>(null);
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
  const [inviteUserModalOpen, setInviteUserModalOpen] = useState(false);
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
  // The lists are memoized and React.memo also compares refs, so each list
  // keeps one ref callback for its lifetime.
  const listRefCallbacks = useRef(
    new Map<string, (handle: ChannelMessageListHandle | null) => void>(),
  );
  const listRefFor = (key: string) => {
    let callback = listRefCallbacks.current.get(key);
    if (!callback) {
      callback = (handle) => {
        if (handle) channelListRefs.current.set(key, handle);
        else channelListRefs.current.delete(key);
      };
      listRefCallbacks.current.set(key, callback);
    }
    return callback;
  };
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
  const e2eeVerifyTarget = useStore((state) => state.e2eeVerifyTarget);
  const closeE2EEVerify = useStore((state) => state.closeE2EEVerify);
  const messages = useStore((state) => state.messages);
  const toggleMemberList = useStore((state) => state.toggleMemberList);
  const openPrivateChat = useStore((state) => state.openPrivateChat);
  const selectPrivateChat = useStore((state) => state.selectPrivateChat);
  const connect = useStore((state) => state.connect);
  const joinChannel = useStore((state) => state.joinChannel);
  const toggleAddServerModal = useStore((state) => state.toggleAddServerModal);
  const openPage = useStore((state) => state.openPage);
  const openProfile = useStore((state) => state.openProfile);
  const redactMessage = useStore((state) => state.redactMessage);
  const warnUser = useStore((state) => state.warnUser);
  const kickUser = useStore((state) => state.kickUser);
  const banUserByNick = useStore((state) => state.banUserByNick);
  const banUserByHostmask = useStore((state) => state.banUserByHostmask);
  const clearChatInputFocus = useStore((state) => state.clearChatInputFocus);
  const shouldFocusChatInput = useStore(
    (state) => state.ui.shouldFocusChatInput,
  );
  const inviteUserRequest = useStore((state) => state.ui.inviteUserRequest);
  const setInviteUserRequest = useStore((state) => state.setInviteUserRequest);

  const isAnyModalOpen = useStore((state) => {
    const { ui } = state;
    return !!(
      ui.isAddServerModalOpen ||
      ui.page ||
      ui.sidePane?.kind === "profile" ||
      ui.contextMenu?.isOpen ||
      ui.isServerNoticesPopupOpen ||
      ui.topicModalRequest ||
      ui.inviteUserRequest ||
      ui.openedMedia ||
      (ui.linkSecurityWarnings?.length ?? 0) > 0
    );
  });

  useAutoFocusTyping(inputRef, () => isAnyModalOpen);

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
    isAddServerModalOpen,
    isServerNoticesPopupOpen,
    page,
    sidePane,
  } = ui;
  const isProfileOpen = sidePane?.kind === "profile";
  const searchPane = sidePane?.kind === "search" ? sidePane : null;

  const isMobile = useMediaQuery("(max-width: 768px)");
  const isCompactInput = useMediaQuery("(max-width: 900px)");

  const pendingBotCommandPick = useStore(
    (state) => state.ui.pendingBotCommandPick,
  );
  const clearBotCommandPickRequest = useStore(
    (state) => state.clearBotCommandPickRequest,
  );
  useEffect(() => {
    if (
      pendingBotCommandPick &&
      pendingBotCommandPick.serverId === selectedServerId
    ) {
      setParamModal({
        botNick: pendingBotCommandPick.botNick,
        command: pendingBotCommandPick.command,
      });
      clearBotCommandPickRequest();
    }
  }, [pendingBotCommandPick, selectedServerId, clearBotCommandPickRequest]);

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

  const emojiItems = useEmojiItems(customEmojiShortcodes);

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

  const homeView = useStore((state) => state.ui.homeView);
  const searchHitMessageId = useStore((state) =>
    state.ui.sidePane?.kind === "search"
      ? state.ui.sidePane.hitMessageId
      : undefined,
  );

  // Get selected server and channel/private chat - memoized to prevent re-renders
  const selectedServer = useMemo(
    () => servers.find((s) => s.id === selectedServerId),
    [servers, selectedServerId],
  );

  // The server offers file uploads via either the vendor token uploader
  // (obby.world/FILEHOST) or the standard tokenless one (draft/FILEHOST).
  const canUpload = !!(
    selectedServer?.filehost || selectedServer?.fileHosts?.length
  );

  const isTouch = useIsTouchInput();

  // MediaRecorder support doesn't change at runtime, so these only need
  // picking once.
  const audioRecordingFormat = useMemo(() => pickRecordingFormat(), []);
  const videoRecordingFormat = useMemo(() => pickVideoRecordingFormat(), []);

  useEffect(() => {
    void listDevices("audioinput").then((devices) => {
      setHasMicrophoneInput(devices.length > 0);
    });
    void listDevices("videoinput").then((devices) => {
      setHasCameraInput(devices.length > 0);
    });
  }, []);

  // Only the vendor token uploader exposes a queryable policy.
  useEffect(() => {
    const filehostUrl = selectedServer?.filehost;
    if (!filehostUrl) {
      setUploadInfo(null);
      return;
    }
    let cancelled = false;
    void fetchUploadInfo(filehostUrl).then((info) => {
      if (!cancelled) setUploadInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedServer?.filehost]);

  const extensionAllowed = (extension: string): boolean =>
    !uploadInfo ||
    uploadInfo.allowed_extensions.length === 0 ||
    uploadInfo.allowed_extensions
      .map((e) => e.toLowerCase())
      .includes(`.${extension}`);

  const canRecordAudio =
    canUpload &&
    typeof window.MediaRecorder !== "undefined" &&
    hasMicrophoneInput &&
    !!audioRecordingFormat &&
    extensionAllowed(audioRecordingFormat.extension);

  const canRecordVideo =
    canUpload &&
    typeof window.MediaRecorder !== "undefined" &&
    hasCameraInput &&
    !!videoRecordingFormat &&
    extensionAllowed(videoRecordingFormat.extension);

  const canRecordScreen =
    canUpload &&
    typeof window.MediaRecorder !== "undefined" &&
    screenCaptureSupported() &&
    !isTouch &&
    !!videoRecordingFormat &&
    extensionAllowed(videoRecordingFormat.extension);

  // Unlike recording, sharing a location never needs the file host -- a
  // rounded or exact link works with no attachment at all.
  const canShareLocation = locationSharingSupported();
  // The native recorder always writes MP4, so it needs none of what the
  // browser's own screen capture is gated on.
  const canRecordRegion =
    canUpload && regionRecordingReady && extensionAllowed("mp4");

  useEffect(() => {
    void regionRecordingSupported().then(setRegionRecordingReady);
  }, []);

  const describeRecordingFailure = (failure: RecordingFailure): string =>
    failure === "screen-gone"
      ? t`That screen is no longer available. Choose another screen.`
      : t`The recording could not be made.`;

  // The rectangle is drawn on the desktop first, then the screen it sits on is
  // captured and cropped to it.
  const startRegionRecording = async () => {
    const selection = await selectScreenRegion();
    if (!selection) return;
    await focusMainWindow();
    setRecordingRegion(selection);
  };

  const recordingMaxBytes = useMemo(
    () => maxRecordingBytes(uploadInfo),
    [uploadInfo],
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

  const completionUsers = useMemo<User[]>(
    () =>
      selectedChannel?.users ??
      (selectedPrivateChat
        ? [
            ...(currentUser ? [currentUser] : []),
            {
              id: `${selectedPrivateChat.serverId}-${selectedPrivateChat.username}`,
              username: selectedPrivateChat.username,
              isOnline: true,
            },
          ]
        : []),
    [selectedChannel?.users, selectedPrivateChat, currentUser],
  );
  const memberProvider = useMemo(
    () => nickProvider(completionUsers),
    [completionUsers],
  );
  const slashCommandProvider = useMemo(
    () =>
      slashProvider(
        slashSuggestions(selectedServer, selectedChannel),
        (cmd) => {
          if (cmd.source.kind !== "bot") return;
          setParamModal({
            botNick: cmd.source.botNick,
            command: {
              name: cmd.name,
              description: cmd.description,
              options: cmd.options,
            },
          });
          applyText("");
          setCompletionInput(NO_COMPLETION_INPUT);
        },
      ),
    [selectedServer, selectedChannel, applyText],
  );
  const completionProviders = useMemo(
    () => [slashCommandProvider, emojiProvider(emojiItems), memberProvider],
    [slashCommandProvider, emojiItems, memberProvider],
  );
  const completion = useCompletion<SlashSuggestion | EmojiItem | User>({
    providers: completionProviders,
    text: completionInput.text,
    caret: completionInput.caret,
    onReplace: (text, caret) => {
      applyText(text);
      setCompletionInput({ text, caret });
      cursorPositionRef.current = caret;
      setTimeout(() => {
        inputRef.current?.setSelectionRange(caret, caret);
        inputRef.current?.focus();
      }, 0);
    },
  });

  const onBeforeInputGuard = useMentionAutocorrectGuard(
    selectedChannel?.users.map((u) => u.username) ?? [],
  );

  // Member list overlay: show when desktop is too narrow for sidebar
  const setSearchChatShown = useStore((state) => state.setSearchChatShown);
  const closeSearchResults = useStore((state) => state.closeSearchResults);
  const isOverlayMode = !isNarrowView && isTooNarrowForMemberList;
  const isSearchOverlayHidden = isOverlayMode && !!searchPane?.isChatShown;
  const showMemberListOverlay =
    isOverlayMode &&
    ((isMemberListVisible && !!selectedChannel && !selectedPrivateChat) ||
      isProfileOpen ||
      !!searchPane);
  const showMessages = !showMemberListOverlay || isSearchOverlayHidden;
  const isHitChatOpen =
    !!searchPane?.hitChatId &&
    searchPane.hitChatId === (selectedChannelId ?? selectedPrivateChatId);
  const showSearchReturn =
    isHitChatOpen && (isNarrowView || isSearchOverlayHidden);

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
      const el = findMessageRow(document, navHighlightedMsgId);
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

  // An embed pauses when we switch channels and keeps its position, so the
  // next visit shows it where it stopped; HTML5 video and audio keep playing
  // through MiniMediaPlayer's hidden element.
  // biome-ignore lint/correctness/useExhaustiveDependencies: store actions have unstable refs
  useEffect(() => {
    const active = useStore.getState().ui.activeMedia;
    if (active?.type === "embed" && active.isPlaying)
      useStore.getState().pauseActiveMedia();
  }, [channelKey]);

  const attachments = attachmentsByChannel[channelKey] ?? NO_ATTACHMENTS;

  const reportUploadFailure = (message: string) =>
    useStore.getState().addGlobalNotification({
      type: "fail",
      command: "UPLOAD",
      code: "UPLOAD_FAILED",
      message,
      serverId: selectedServerId ?? "",
    });

  const updateAttachments = (
    key: string,
    next: (prev: PendingAttachment[]) => PendingAttachment[],
  ) =>
    setAttachmentsByChannel((prev) => ({
      ...prev,
      [key]: next(prev[key] ?? NO_ATTACHMENTS),
    }));

  const handleSendMessage = () => {
    if (!hasTextRef.current && attachments.length === 0) return;

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
    if (attachments.length > 0) {
      const files = attachments.flatMap((a) =>
        a.kind === "file" ? [a.file] : [],
      );
      const links = attachments.flatMap((a) =>
        a.kind === "link" ? [a.url] : [],
      );
      const caption = messageTextRef.current.trim();
      if (files.length > 0) {
        if (!canUpload) return;
        // The composer empties before the host has been reached, so the
        // thumbnails stay alive until an upload is known to have started and
        // an upload that never starts hands the words and the files back.
        const held = attachments;
        updateAttachments(channelKey, () => NO_ATTACHMENTS);
        void handleFilesUpload(files, caption, links).then((outcome) => {
          if (outcome === "failed") {
            updateAttachments(channelKey, () => held);
            applyText(caption);
            return;
          }
          for (const attachment of held) releasePreview(attachment);
        });
      } else {
        if (sendMessage([caption, ...links].join(" ")) === "withheld") return;
        clearAttachments();
      }
    } else if (sendMessage(messageTextRef.current) === "withheld") {
      // Withheld under an engaged-but-not-ready lock: keep the draft so the
      // user doesn't lose what they typed when nothing was actually sent.
      return;
    }

    applyText("");
    setCompletionInput(NO_COMPLETION_INPUT);
    draftMap.current.delete(channelKey);
    setLocalReplyTo(null);
    setNavHighlightedMsgId(null);
    messageHistory.resetHistory();

    // Keep the textarea focused so the keyboard stays open on mobile.
    inputRef.current?.focus();
  };

  // Multi-file upload entry point.  Picks up an auth token (one-shot
  // per batch -- the backend accepts the same token across many
  // uploads), kicks off N uploads in parallel, surfaces per-file
  // progress, and on full success sends a single PRIVMSG carrying what was
  // typed and all the resulting URLs.
  const handleFilesUpload = async (
    files: File[],
    caption: string,
    links: string[],
    confirmedForNick: string | null = null,
  ): Promise<UploadOutcome> => {
    if (!selectedServerId || files.length === 0) return "failed";
    // Prefer the standard tokenless draft/FILEHOST when offered; otherwise
    // fall back to the vendor token-authenticated obby.world/FILEHOST.
    const tokenlessEndpoint = selectedServer?.fileHosts?.[0];
    const filehostUrl = selectedServer?.filehost;
    if (!tokenlessEndpoint && !filehostUrl) {
      reportUploadFailure(
        t`This server has no file host. Connect to a server with a file host to upload files.`,
      );
      return "failed";
    }
    const target = selectedChannel?.name ?? selectedPrivateChat?.username;
    if (!target) return "failed";
    // A confirmation names the conversation it was given for. Answering it
    // after moving to another chat must not redirect the files there.
    if (confirmedForNick !== null && confirmedForNick !== target)
      return "failed";
    const plainUploadConfirmed = confirmedForNick !== null;

    // The token path pulls the in-house policy and mints one single-use
    // draft/authtoken Bearer per file (the IRCd burns each on validate, so
    // they can't be shared across the batch). The tokenless path needs
    // neither -- it POSTs straight to the advertised endpoint.
    let info: Awaited<ReturnType<typeof fetchUploadInfo>> = null;
    const tokens: string[] = [];
    if (!tokenlessEndpoint && filehostUrl) {
      info = await fetchUploadInfo(filehostUrl);
      // Serialised because waitForAuthToken resolves on the first matching
      // TOKEN_GENERATE event -- parallel mints would race for the reply.
      const scope = target.startsWith("#") ? `channel:${target}` : undefined;
      for (let i = 0; i < files.length; i++) {
        ircClient.requestToken(selectedServerId, "filehost", scope);
        const tok = await waitForAuthToken(selectedServerId, "filehost");
        if (!tok) {
          console.error(
            "draft/authtoken: server did not return a filehost token",
          );
          reportUploadFailure(t`The file host refused the upload. Try again.`);
          return "failed";
        }
        tokens.push(tok);
      }
    }

    // Attachments encrypt only in a live Obby PM: OTR has no frame for them,
    // and a channel has no session at all. A conversation whose lock is
    // engaged but not ready withholds the upload for the same reason it
    // withholds text, since the bytes reach the host before any message does.
    const posture = selectedPrivateChat
      ? pmEncryptionPosture(selectedServerId, selectedPrivateChat.username)
      : "plain";
    if (posture === "blocked" && selectedPrivateChat) {
      // "Blocked" covers three different states and only one of them is worth
      // waiting out, so the row says which one the conversation is in.
      const blockedStatus =
        useStore.getState().e2eeSessions[
          e2eeSessionKey(selectedServerId, selectedPrivateChat.username)
        ]?.status;
      injectSystemNotice(
        selectedServerId,
        selectedPrivateChat.username,
        blockedStatus === "key-changed"
          ? t`File not uploaded: the encryption key changed. Review the new key, or end encryption to upload unencrypted.`
          : blockedStatus === "error"
            ? t`File not uploaded: encryption stopped working. Start encryption again, or end encryption to upload unencrypted.`
            : t`File not uploaded: encryption is still being set up. Upload it again once encryption is active, or end encryption to upload unencrypted.`,
      );
      return "failed";
    }
    const encryptHere = posture === "encrypt" && !!selectedPrivateChat;
    // Each file decides for itself, so one file past the size ceiling cannot
    // quietly drag the rest of the batch into the clear.
    const plainFiles = encryptHere
      ? files.filter((f) => !canEncryptMedia(f.size))
      : posture === "unencryptable"
        ? files
        : [];
    if (plainFiles.length > 0 && !plainUploadConfirmed) {
      setPendingPlainUpload({
        files,
        caption,
        links,
        reason: encryptHere ? "too-large" : "scheme",
        nick: target,
      });
      return "held";
    }
    const encryptTarget =
      encryptHere && selectedPrivateChat
        ? { nick: selectedPrivateChat.username }
        : null;

    // An encrypted attachment is its own frame and carries no text, so what was
    // typed goes ahead of the files as a message of its own.
    const said = [caption, ...links].filter(Boolean).join(" ");
    if (encryptTarget && said) sendMessage(said);

    // Build the job list in one go so the progress strip appears
    // immediately, before any network roundtrip.
    const initialJobs: UploadJob[] = files.map((f) => {
      const encrypts = !!encryptTarget && canEncryptMedia(f.size);
      // The badge is for conversations that show a lock: a channel or an
      // unencrypted PM has nothing to contradict, so it stays off there.
      const underLock = encryptHere || posture === "unencryptable";
      return {
        id: uuidv4(),
        file: f,
        loaded: 0,
        total: f.size,
        status: "pending" as const,
        encrypted: underLock ? encrypts : undefined,
        plainReason: !underLock
          ? undefined
          : posture === "unencryptable"
            ? ("scheme" as const)
            : encrypts
              ? undefined
              : ("too-large" as const),
      };
    });
    setUploadJobs((prev) => [...prev, ...initialJobs]);

    const updateJob = (id: string, patch: Partial<UploadJob>) =>
      setUploadJobs((prev) =>
        prev.map((j) => (j.id === id ? { ...j, ...patch } : j)),
      );

    // Run all uploads in parallel; collect URLs in original input order.
    const results = await Promise.all(
      initialJobs.map(async (job, jobIdx) => {
        const ac = new AbortController();
        uploadAbortsRef.current.set(job.id, ac);
        updateJob(job.id, { status: "uploading" });
        try {
          const onProgress = (loaded: number, total: number) =>
            updateJob(job.id, { loaded, total });
          // Ciphertext uploads under its own extension and header: the real
          // name and type travel in the descriptor, where the host can't read
          // them, and nothing on the host tries to re-encode the bytes.
          const media =
            encryptTarget && canEncryptMedia(job.file.size)
              ? encryptMedia(await readFileBytes(job.file))
              : null;
          const upload = media
            ? new File(
                // Handed over as the view itself: File copies it once anyway,
                // and slicing first would hold a second full copy meanwhile.
                [wrapForUpload(media.ciphertext)],
                ciphertextFileName(),
                { type: "application/octet-stream" },
              )
            : job.file;
          // Checked against what actually goes to the host, which for an
          // encrypted attachment is the ciphertext under its own extension.
          // Checking the original would clear a jpeg the host never sees and
          // then fail on the upload it does.
          let validationError = validateFileAgainstInfo(upload, info);
          if (validationError && filehostUrl) {
            // The policy is a server setting that can change while this tab is
            // open, so a refusal is re-checked against a fresh copy before it
            // stops an upload the host would now take.
            const current = await fetchUploadInfo(filehostUrl, {
              refresh: true,
            });
            validationError = validateFileAgainstInfo(upload, current);
          }
          if (validationError) {
            uploadAbortsRef.current.delete(job.id);
            updateJob(job.id, {
              status: "failed",
              error: media
                ? t`This file host refuses ${CIPHERTEXT_EXTENSION} files, the format Obby uses for encrypted attachments. End encryption to send the file unencrypted.`
                : validationError,
            });
            return null;
          }
          const url = tokenlessEndpoint
            ? await uploadFileTokenless(upload, {
                endpoint: tokenlessEndpoint,
                signal: ac.signal,
                onProgress,
              })
            : await uploadFile(upload, {
                // biome-ignore lint/style/noNonNullAssertion: filehostUrl is set when tokenlessEndpoint isn't (guarded above)
                filehostUrl: filehostUrl!,
                bearerToken: tokens[jobIdx],
                signal: ac.signal,
                onProgress,
              });
          updateJob(job.id, {
            status: "done",
            loaded: job.file.size,
            total: job.file.size,
            url,
          });
          uploadAbortsRef.current.delete(job.id);
          return media ? buildMediaDescriptor(url, media, job.file) : url;
        } catch (err) {
          uploadAbortsRef.current.delete(job.id);
          updateJob(job.id, {
            status: "failed",
            error: describeUploadFailure(err),
          });
          return null;
        }
      }),
    );

    let anyFailed = results.some((r) => r === null);

    // Encrypted attachments each become their own frame, since the descriptor
    // carries the file key and is never message text.
    if (encryptTarget) {
      for (const [index, result] of results.entries()) {
        if (!result || typeof result === "string") continue;
        // The descriptor holds the only copy of the file key, so a session that
        // ended mid-upload leaves unreadable bytes on the host. Say so on the
        // row rather than reporting a delivery that never happened.
        if (!sendEncryptedMedia(selectedServerId, encryptTarget.nick, result)) {
          anyFailed = true;
          updateJob(initialJobs[index].id, {
            status: "failed",
            error: t`Encryption ended before this file was sent. It was not delivered.`,
          });
        }
      }
    }

    // Encrypted attachments have already been delivered as their own frames, so
    // only plain uploads leave a URL to post.
    const urls = results.filter((u): u is string => typeof u === "string");
    if (urls.length > 0 || (!encryptTarget && said)) {
      const line = [said, ...urls].filter(Boolean).join(" ");
      const encrypted =
        !!selectedPrivateChat &&
        routeOutgoingPM(
          selectedServerId,
          selectedPrivateChat.username,
          line,
        ) !== "none";
      if (!encrypted) {
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
      }
    }

    // Clear the strip after a pause so the user can see the outcome first. A
    // failure is worth reading, so it gets longer than a plain "done".
    setTimeout(
      () => {
        setUploadJobs((prev) =>
          prev.filter((j) => !initialJobs.some((i) => i.id === j.id)),
        );
      },
      anyFailed ? 8000 : 1500,
    );
    return "started";
  };

  const cancelUploadJob = (id: string) => {
    const ac = uploadAbortsRef.current.get(id);
    if (ac) ac.abort();
    setUploadJobs((prev) => prev.filter((j) => j.id !== id));
  };

  // Every path that picks a file lands here, and nothing leaves the device
  // until the message it belongs to is sent.
  const handleSelectedFiles = (files: File[]) => {
    if (files.length === 0) return;
    updateAttachments(channelKey, (prev) => [
      ...prev,
      ...files.map((file) => ({
        id: uuidv4(),
        kind: "file" as const,
        file,
        previewUrl: previewable(file) ? URL.createObjectURL(file) : null,
      })),
    ]);
    inputRef.current?.focus();
  };

  const removeAttachment = (id: string) =>
    updateAttachments(channelKey, (prev) => {
      const going = prev.find((a) => a.id === id);
      if (going) releasePreview(going);
      return prev.filter((a) => a.id !== id);
    });

  const clearAttachments = () => {
    for (const attachment of attachments) releasePreview(attachment);
    updateAttachments(channelKey, () => NO_ATTACHMENTS);
  };

  // A drop or a paste anywhere over the app means the conversation on screen.
  // Touch has no drag and no clipboard gesture of its own, so this is for
  // pointer devices.
  const isDraggingFile = useWindowFileCapture({
    enabled:
      canUpload && !isTouch && !!(selectedChannel || selectedPrivateChat),
    onFiles: handleSelectedFiles,
  });

  // A file on the clipboard is the same gesture as dropping one. A copy from a
  // file manager carries the name as text too, so the files decide.
  const handlePaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (!canUpload || files.length === 0) return;
    e.preventDefault();
    handleSelectedFiles(files);
  };

  // Shared by anything that sends a plain URL as its whole message -- a GIF
  // pick or a location link with no image to attach.
  const sendUrlMessage = (url: string) => {
    const target = selectedChannel?.name ?? selectedPrivateChat?.username ?? "";
    if (!target || !selectedServerId) return;
    if (
      selectedPrivateChat &&
      routeOutgoingPM(selectedServerId, selectedPrivateChat.username, url) !==
        "none"
    ) {
      return;
    }

    ircClient.sendRaw(selectedServerId, `PRIVMSG ${target} :${url}`);

    // A channel echoes our own line back, and so does a private message once
    // the server negotiates echo-message, so we only place a local copy where
    // nothing is coming back to place it for us.
    if (
      selectedPrivateChat &&
      currentUser &&
      !ircClient.hasCapability(selectedServerId, "echo-message")
    ) {
      const outgoingMessage = {
        id: uuidv4(),
        content: url,
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
  };

  const handleLocationShare = (url: string) => {
    updateAttachments(channelKey, (prev) => [
      ...prev,
      { id: uuidv4(), kind: "link", url, label: t`Location` },
    ]);
    setIsLocationModalOpen(false);
    inputRef.current?.focus();
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
      completion.cycle(
        messageTextRef.current,
        cursorPositionRef.current,
        e.shiftKey ? -1 : 1,
      );
      return;
    }

    // Escape cancels active reply navigation (and the reply itself)
    if (e.key === "Escape" && navHighlightedMsgId !== null) {
      setNavHighlightedMsgId(null);
      setLocalReplyTo(null);
      return;
    }

    if (e.key === "Escape" && attachments.length > 0) {
      clearAttachments();
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

    if (!MODIFIER_KEYS.includes(e.key)) completion.stopCycling();

    // Any normal keystroke exits nav mode but keeps the reply so the user can type
    if (navHighlightedMsgId !== null) {
      setNavHighlightedMsgId(null);
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

    // We re-render on keystrokes only while the user types a slash command
    // name, and once after that to close any open completion.
    if (getActiveSlashQuery(newText, newCursorPosition) !== null) {
      // The first slash in this channel asks the +B users we have no schema
      // for, so their commands join the list as soon as they answer.
      const wasCompletingSlash =
        getActiveSlashQuery(completionInput.text, completionInput.caret) !==
        null;
      if (!wasCompletingSlash && selectedServerId && selectedChannel) {
        queryUncachedBotsInChannel(selectedServerId, selectedChannel.name);
      }
      setCompletionInput({ text: newText, caret: newCursorPosition });
    } else if (completionInput !== NO_COMPLETION_INPUT) {
      setCompletionInput(NO_COMPLETION_INPUT);
    }

    // Exit history mode if user starts typing
    messageHistory.exitHistory();
  };

  const handleInputClick = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement;
    const newCursorPos = target.selectionStart || 0;
    cursorPositionRef.current = newCursorPos;
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

  const handleOpenProfile = useCallback(
    (username: string) => {
      if (selectedServerId) openProfile(selectedServerId, username);
    },
    [selectedServerId, openProfile],
  );

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

  const handleAtButtonClick = () => {
    setShowMembersDropdown((prev) => {
      const newValue = !prev;
      // Close other dropdowns when opening members dropdown
      if (newValue) {
        setIsEmojiSelectorOpen(false);
        setIsColorPickerOpen(false);
        completion.stopCycling();
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
    if (page || isProfileOpen || isAddServerModalOpen) return;
    inputRef.current?.focus();
  }, [
    selectedChannelId,
    selectedPrivateChatId,
    page,
    isProfileOpen,
    isAddServerModalOpen,
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
        onToggleChanList={onToggleChanList}
        onToggleMemberList={() => toggleMemberList(!isMemberListVisible)}
        onToggleNotificationVolume={toggleNotificationSound}
        onOpenChannelSettings={() =>
          selectedServerId &&
          selectedChannel &&
          openPage({
            kind: "channelSettings",
            serverId: selectedServerId,
            channelName: selectedChannel.name,
          })
        }
        onOpenInviteUser={() => setInviteUserModalOpen(true)}
        onOpenBots={() =>
          selectedServerId &&
          openPage({ kind: "bots", serverId: selectedServerId })
        }
      />

      {topSlot && (
        <div className="flex-shrink-0 max-h-[60%] flex flex-col overflow-hidden border-b border-discord-dark-300">
          {topSlot}
        </div>
      )}

      <TopicMediaStrip />
      <MiniMediaPlayer />
      {/* Member list overlay replaces messages when desktop is too narrow for sidebar */}
      {showMemberListOverlay && (
        <div
          className={`flex-grow overflow-hidden bg-discord-dark-100 ${isSearchOverlayHidden ? "hidden" : ""}`}
        >
          <SidePane />
        </div>
      )}
      {showSearchReturn && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bar-divider bg-discord-dark-200">
          <button
            type="button"
            className={`chip-action shadow-none min-w-0 ${isTouch ? "min-h-11 px-4 text-sm" : ""}`}
            onClick={() => setSearchChatShown(false)}
          >
            <FaArrowLeft className="text-[10px] shrink-0" />
            <span className="truncate">
              <Trans>Show search results</Trans>
            </span>
          </button>
          <button
            type="button"
            className={`icon-button ml-auto rounded-lg ${isTouch ? "w-11 h-11" : "w-8 h-8"}`}
            onClick={closeSearchResults}
            aria-label={t`Close search`}
            title={t`Close search`}
          >
            <FaTimes className="text-xs" />
          </button>
        </div>
      )}
      {/* Messages area */}
      {showMessages && (
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
          {!selectedServer &&
            (homeView === "plugins" ? <PluginsScreen /> : <DiscoverGrid />)}

          {/* Keep-alive channel message lists — last 3 channels stay in DOM with
              display:none to preserve scroll position across channel switches.
              HTML5 <video>/<audio> elements keep playing inside display:none (no
              suspension), so video/audio background playback continues uninterrupted.
              Embedded iframes (YouTube) are suspended by the browser, but we
              explicitly stop embed media on channel switch (see effect below). */}
          <div
            className={`relative flex flex-col min-h-0 ${channelKey ? "flex-grow" : ""}`}
          >
            <BotToolsTray
              serverId={selectedServerId}
              channel={
                selectedChannel?.name ?? selectedPrivateChat?.username ?? null
              }
            />
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
                      ref={listRefFor(key)}
                      channelKey={key}
                      initialScrollState={savedScrollState}
                      serverId={aServerId}
                      channelId={aChannelId}
                      privateChatId={aPrivateChatId}
                      isActive={isKeyActive}
                      isMemberListVisible={isMemberListVisible}
                      onReply={handleSetReplyTo}
                      highlightedMessageId={
                        isKeyActive
                          ? (navHighlightedMsgId ?? undefined)
                          : undefined
                      }
                      searchHitMessageId={
                        isKeyActive ? searchHitMessageId : undefined
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
                    />
                  </div>
                );
              },
            )}
          </div>

          {/* Input area */}
          {(selectedChannel || selectedPrivateChat) && (
            <div
              className={`${isNarrowView ? "" : "px-4"} relative chat-input-area`}
            >
              {selectedPrivateChat && selectedServerId && (
                <E2EERequestBanner
                  serverId={selectedServerId}
                  nick={selectedPrivateChat.username}
                />
              )}
              {e2eeVerifyTarget && (
                <E2EEVerifyModal
                  isOpen
                  serverId={e2eeVerifyTarget.serverId}
                  nick={e2eeVerifyTarget.nick}
                  onClose={closeE2EEVerify}
                />
              )}
              {isDraggingFile &&
                createPortal(
                  <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-discord-dark-100/80 p-6">
                    <div className="flex h-full w-full items-center justify-center rounded-2xl border-2 border-dashed border-discord-primary">
                      <span className="flex items-center text-lg font-medium text-discord-text-normal">
                        <FaPlus className="mr-3" />
                        <Trans>Drop files to attach</Trans>
                      </span>
                    </div>
                  </div>,
                  document.body,
                )}
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
                className={`bg-discord-dark-100 ${localReplyTo ? "rounded-b-lg" : "rounded-lg"}`}
              >
                <AttachmentTray
                  attachments={attachments}
                  onRemove={removeAttachment}
                />
                {/* We align to the bottom so the buttons stay beside the last line while the box grows. */}
                <div className="relative flex flex-nowrap items-end pr-2">
                  <button
                    ref={plusButtonRef}
                    aria-label={t`Attach`}
                    aria-haspopup="menu"
                    aria-expanded={showPlusMenu}
                    className="flex h-[52px] w-11 shrink-0 items-center justify-center text-discord-text-muted hover:text-discord-text-normal"
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
                    onPaste={handlePaste}
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
                            ? t`Message ${selectedChannel.name} (Shift+Enter for new line)`
                            : t`Message ${selectedChannel.name} (Enter for new line, Shift+Enter to send)`
                          : t`Message ${selectedChannel.name}`
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
                    className="min-w-0 flex-1 resize-none overflow-y-auto border-none bg-transparent py-[15px] leading-[22px] text-discord-text-normal outline-none placeholder:truncate"
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
              </div>

              <Menu
                isOpen={showPlusMenu}
                onClose={() => setShowPlusMenu(false)}
                anchorElement={plusButtonRef.current}
                menuItems={[
                  {
                    id: "upload",
                    show: canUpload,
                    icon: <FaPlus />,
                    label: <Trans>Upload Files</Trans>,
                    onClick: () => {
                      // Multi-file picker: images, videos, audio. The
                      // backend's allowlist is the source of truth, but we
                      // hint accept= so the OS file dialog filters sensibly.
                      const input = document.createElement("input");
                      input.type = "file";
                      input.multiple = true;
                      input.accept = "image/*,video/*,audio/*";
                      input.onchange = (e) => {
                        handleSelectedFiles(
                          Array.from(
                            (e.target as HTMLInputElement).files ?? [],
                          ),
                        );
                      };
                      input.click();
                    },
                  },
                  {
                    id: "gif",
                    show: gifProviders.length > 0,
                    icon: <FaGift />,
                    label: <Trans>Send a GIF</Trans>,
                    onClick: () => setIsGifSelectorOpen(true),
                  },
                  {
                    id: "record-audio",
                    show: canRecordAudio,
                    divider: canRecordAudio,
                    icon: <FaMicrophone />,
                    label: <Trans>Record Audio</Trans>,
                    onClick: () => setRecordingKind("audio"),
                  },
                  {
                    id: "camera",
                    show: canRecordVideo,
                    divider: !canRecordAudio && canRecordVideo,
                    icon: <FaCamera />,
                    label: <Trans>Take Photo or Video</Trans>,
                    onClick: () => setIsCameraOpen(true),
                  },
                  {
                    id: "record-region",
                    show: canRecordRegion,
                    icon: <FaVectorSquare />,
                    label: <Trans>Record Screen Area</Trans>,
                    onClick: () => void startRegionRecording(),
                  },
                  {
                    id: "record-screen",
                    show: canRecordScreen,
                    divider:
                      !canRecordAudio && !canRecordVideo && canRecordScreen,
                    icon: <FaDesktop />,
                    label: <Trans>Record Screen</Trans>,
                    onClick: () => setRecordingKind("screen"),
                  },
                  {
                    id: "location",
                    show: canShareLocation,
                    divider: true,
                    icon: <FaMapMarkerAlt />,
                    label: <Trans>Share Location</Trans>,
                    onClick: () => setIsLocationModalOpen(true),
                  },
                ]}
              />

              {isNarrowView && (
                <EmojiPickerModal
                  isOpen={isEmojiSelectorOpen}
                  onEmojiClick={handleEmojiSelect}
                  onClose={() => setIsEmojiSelectorOpen(false)}
                  customEmojis={pickerCustomEmojis}
                />
              )}

              <GifSelector
                isOpen={isGifSelectorOpen}
                onClose={() => setIsGifSelectorOpen(false)}
                onSelectGif={(gifUrl) => {
                  sendUrlMessage(gifUrl);
                  setIsGifSelectorOpen(false);
                }}
              />

              {isColorPickerOpen && (
                <ColorPicker
                  isNarrowView={isNarrowView}
                  onSelect={(color) => setSelectedColor(color)}
                  onClose={() => {
                    setIsColorPickerOpen(false);
                    inputRef.current?.focus();
                  }}
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

              {completion.isOpen && (
                <CompletionList
                  completion={completion}
                  anchor={inputRef.current}
                  className={
                    completion.provider === slashCommandProvider
                      ? "min-w-72"
                      : ""
                  }
                  rowClassName={isTouch ? "min-h-12" : ""}
                />
              )}

              {/* Per-arg hint shown after the cmd name + a space.
                  Pulls schemas from both client-side commands and
                  any cached PushBot schemas. */}
              {(() => {
                const srv = servers.find((s) => s.id === selectedServerId);
                const schemas: Record<
                  string,
                  {
                    command: import("../../types").BotCommand;
                    source: "client" | "bot";
                    botNick?: string;
                    scope: "channel" | "server" | "dm";
                  }
                > = {};

                // Client-side commands first; bot schemas overwrite
                // only if there's a real collision (none in practice
                // because the client owns /me, /msg, etc).
                for (const c of getClientCommands()) {
                  schemas[c.name.toLowerCase()] = {
                    command: {
                      name: c.name,
                      description: c.description,
                      options: c.options,
                    },
                    source: "client",
                    scope: "dm",
                  };
                }

                if (srv?.botCommands) {
                  const chanUsers = new Set<string>(
                    selectedChannel?.users.map((u) =>
                      u.username.toLowerCase(),
                    ) ?? [],
                  );
                  for (const [botNick, list] of Object.entries(
                    srv.botCommands,
                  )) {
                    const botScope: "channel" | "server" =
                      srv.bots?.[botNick]?.scope ?? "channel";
                    const inChannel = chanUsers.has(botNick.toLowerCase());
                    if (
                      botScope === "channel" &&
                      (!selectedChannel || !inChannel)
                    )
                      continue;
                    for (const c of list) {
                      const entry = {
                        command: c,
                        source: "bot" as const,
                        botNick,
                        scope: botScope,
                      };
                      // Specific key handles `/cmd@bot foo` lookups;
                      // bare key is a fallback for `/cmd foo` (last
                      // bot wins, which matches dispatch's fallback
                      // ordering).
                      schemas[
                        `${c.name.toLowerCase()}@${botNick.toLowerCase()}`
                      ] = entry;
                      schemas[c.name.toLowerCase()] = entry;
                    }
                  }
                }

                if (Object.keys(schemas).length === 0) return null;
                return (
                  <SlashParamHint
                    inputValue={messageTextRef.current ?? ""}
                    cursorPosition={cursorPositionRef.current}
                    schemas={schemas}
                    inputElement={inputRef.current}
                  />
                );
              })()}

              {/* Members dropdown triggered by @ button */}
              <MemberPicker
                isNarrowView={isNarrowView}
                provider={memberProvider}
                isOpen={showMembersDropdown}
                onSelect={(username) => {
                  const isAtMessageStart = messageTextRef.current.trim() === "";
                  const suffix = isAtMessageStart ? ": " : " ";
                  applyText(messageTextRef.current + username + suffix);
                  setShowMembersDropdown(false);
                  inputRef.current?.focus();
                }}
                onClose={() => {
                  setShowMembersDropdown(false);
                  inputRef.current?.focus();
                }}
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
        onClose={handleCloseUserContextMenu}
        onOpenPM={handleOpenPM}
        onOpenProfile={handleOpenProfile}
        currentUserStatus={userContextMenu.userStatusInChannel}
        currentUsername={
          ircClient.getCurrentUser(userContextMenu.serverId)?.username
        }
        onPickBotCommand={(botNick, command) =>
          setParamModal({ botNick, command })
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
      {selectedChannel && selectedServerId && (
        <InviteUserModal
          isOpen={inviteUserModalOpen}
          onClose={() => setInviteUserModalOpen(false)}
          serverId={selectedServerId}
          channelName={selectedChannel.name}
        />
      )}
      <CameraCaptureModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCaptured={(file) => handleSelectedFiles([file])}
        maxBytes={recordingMaxBytes}
      />
      <RegionRecordingBar
        selection={recordingRegion}
        onRecorded={(file) => handleSelectedFiles([file])}
        onError={(failure) =>
          useStore.getState().addGlobalNotification({
            type: "fail",
            command: "RECORD SCREEN",
            code: "RECORDING_FAILED",
            message: describeRecordingFailure(failure),
            serverId: selectedServerId ?? "",
          })
        }
        onFinished={() => setRecordingRegion(null)}
      />
      <RecordingPanel
        kind={recordingKind ?? "audio"}
        isOpen={recordingKind !== null}
        anchor={plusButtonRef.current}
        onClose={() => setRecordingKind(null)}
        onRecorded={(file) => handleSelectedFiles([file])}
        maxBytes={recordingMaxBytes}
      />
      <LocationShareModal
        isOpen={isLocationModalOpen}
        target={selectedChannel?.name ?? selectedPrivateChat?.username ?? ""}
        onCancel={() => setIsLocationModalOpen(false)}
        onShare={handleLocationShare}
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
                        GROUP_WINDOW_MS;

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
      {pendingPlainUpload && (
        <UnencryptedUploadConfirmModal
          isOpen={true}
          files={pendingPlainUpload.files}
          reason={pendingPlainUpload.reason}
          nick={pendingPlainUpload.nick}
          onConfirm={() => {
            const { files, caption, links, nick } = pendingPlainUpload;
            setPendingPlainUpload(null);
            void handleFilesUpload(files, caption, links, nick);
          }}
          onCancel={() => setPendingPlainUpload(null)}
        />
      )}
      {paramModal &&
        selectedServerId &&
        createPortal(
          <SlashCommandParamModal
            serverId={selectedServerId}
            botNick={paramModal.botNick}
            command={paramModal.command}
            channel={selectedChannel ?? null}
            privateChat={selectedPrivateChat ?? null}
            channelMembers={selectedChannel?.users.map((u) => u.username) ?? []}
            joinedChannels={
              servers
                .find((s) => s.id === selectedServerId)
                ?.channels.map((c) => c.name) ?? []
            }
            onClose={() => setParamModal(null)}
          />,
          document.body,
        )}
    </div>
  );
};

export default ChatArea;
