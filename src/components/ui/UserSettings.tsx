import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  FaBell,
  FaChevronLeft,
  FaChevronRight,
  FaCog,
  FaImage,
  FaServer,
  FaShareSquare,
  FaShieldAlt,
  FaTimes,
  FaUser,
} from "react-icons/fa";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useModalBehavior } from "../../hooks/useModalBehavior";
import ircClient from "../../lib/ircClient";
import { openExternalUrl } from "../../lib/openUrl";
import { isTauri } from "../../lib/platformUtils";
import { settingsRegistry } from "../../lib/settings";
import type { SettingValue } from "../../lib/settings/types";
import useStore, {
  type GlobalSettings,
  loadSavedServers,
  serverSupportsMetadata,
} from "../../store";
import AvatarUpload from "./AvatarUpload";
import EmojiPackAdminModal from "./EmojiPackAdminModal";
import InvitationsPanel from "./InvitationsPanel";
import PersistenceSettingsPanel from "./PersistenceSettingsPanel";
import { SettingField } from "./settings/SettingRenderer";
import { TextInput } from "./TextInput";
import UserProfileModal from "./UserProfileModal";

// Deep clone utility for settings values
const deepClone = <T,>(value: T): T => {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }

  const cloned: Record<string, unknown> = {};
  for (const key in value) {
    if (Object.hasOwn(value, key)) {
      cloned[key] = deepClone((value as Record<string, unknown>)[key]);
    }
  }
  return cloned as T;
};

// Deep equality check for comparing setting values
const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  if (typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) =>
      deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ),
    );
  }

  return false;
};

type SettingsCategory =
  | "profile"
  | "notifications"
  | "preferences"
  | "media"
  | "account"
  | "invitations"
  | "privacy";

interface CategoryInfo {
  id: SettingsCategory;
  title: string;
  icon: React.ReactNode;
  description: string;
}

export const UserSettings: React.FC = React.memo(() => {
  const {
    toggleSettingsModal,
    setProfileViewRequest,
    clearSettingsNavigation,
    servers,
    ui,
    isConnecting,
    metadataSet,
    sendRaw,
    setName,
    changeNick,
    updateServer,
    globalSettings,
    updateGlobalSettings,
    addToIgnoreList,
    removeFromIgnoreList,
  } = useStore();

  const currentServer = useMemo(
    () => servers.find((s) => s.id === ui.selectedServerId),
    [servers, ui.selectedServerId],
  );

  const savedServers = loadSavedServers();
  const serverConfig = savedServers.find((s) => s.id === ui.selectedServerId);

  const currentUser = useMemo(() => {
    if (!currentServer) return null;

    const ircCurrentUser = ircClient.getCurrentUser(currentServer.id);
    if (!ircCurrentUser) return null;

    for (const channel of currentServer.channels) {
      const userWithMetadata = channel.users.find(
        (u) => u.username === ircCurrentUser.username,
      );
      if (userWithMetadata) {
        return userWithMetadata;
      }
    }

    return ircCurrentUser;
  }, [currentServer]);

  const supportsMetadata = useMemo(
    () => (currentServer ? serverSupportsMetadata(currentServer.id) : false),
    [currentServer],
  );
  const isMobile = useMediaQuery("(max-width: 768px)");

  const { i18n } = useLingui();
  const categories: CategoryInfo[] = [
    {
      id: "profile",
      title: t`Profile`,
      icon: <FaUser className="w-5 h-5" />,
      description: t`Manage your profile information and metadata`,
    },
    {
      id: "notifications",
      title: t`Notifications`,
      icon: <FaBell className="w-5 h-5" />,
      description: t`Configure notification sounds and highlights`,
    },
    {
      id: "preferences",
      title: t`Preferences`,
      icon: <FaCog className="w-5 h-5" />,
      description: t`Customize your IRC client experience`,
    },
    {
      id: "media",
      title: t`Media`,
      icon: <FaImage className="w-5 h-5" />,
      description: t`Control media display and external content`,
    },
    {
      id: "account",
      title: t`Account`,
      icon: <FaServer className="w-5 h-5" />,
      description: t`Manage your account and authentication`,
    },
    {
      id: "invitations",
      title: t`Invitations`,
      icon: <FaShareSquare className="w-5 h-5" />,
      description: t`Create and manage your invite links`,
    },
    {
      id: "privacy",
      title: t`Privacy`,
      icon: <FaShieldAlt className="w-5 h-5" />,
      description: t`View our privacy policy and data practices`,
    },
  ];

  // Category state
  const [activeCategory, setActiveCategory] =
    useState<SettingsCategory>("profile");
  const [mobileView, setMobileView] = useState<"categories" | "content">(
    "categories",
  );
  const [highlightedSetting, setHighlightedSetting] = useState<string | null>(
    null,
  );

  // Refs to store timeout IDs to prevent premature clearing
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Clear highlight when modal closes
  useEffect(() => {
    if (!ui.isSettingsModalOpen) {
      setMobileView("categories");
      setHighlightedSetting(null);
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
        highlightTimeoutRef.current = null;
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = null;
      }
    }
  }, [ui.isSettingsModalOpen]);

  // Apply navigation from Quick Actions
  useEffect(() => {
    if (!ui.settingsNavigation) return;

    if (ui.settingsNavigation.category) {
      setActiveCategory(ui.settingsNavigation.category);
    }

    if (ui.settingsNavigation.highlightedSettingId) {
      const settingId = ui.settingsNavigation.highlightedSettingId;
      setHighlightedSetting(settingId);

      // Clear any existing timeouts
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Scroll to the highlighted element after a brief delay
      scrollTimeoutRef.current = setTimeout(() => {
        const element = document.getElementById(`setting-${settingId}`);
        if (element) {
          // Find the scrollable container
          const scrollContainer = element.closest(".overflow-y-auto");
          if (scrollContainer) {
            // Scroll within the container
            const elementTop = element.offsetTop;
            const containerHeight = scrollContainer.clientHeight;
            const scrollTo =
              elementTop - containerHeight / 2 + element.clientHeight / 2;
            scrollContainer.scrollTo({ top: scrollTo, behavior: "smooth" });
          } else {
            // Fallback to normal scrollIntoView
            element.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }
        scrollTimeoutRef.current = null;
      }, 200);

      // Clear highlight after 2 seconds
      highlightTimeoutRef.current = setTimeout(() => {
        setHighlightedSetting(null);
        highlightTimeoutRef.current = null;
      }, 2000);

      // Clear navigation state
      clearSettingsNavigation();
    } else {
      // Clear navigation state if no highlighted setting
      clearSettingsNavigation();
    }
  }, [ui.settingsNavigation, clearSettingsNavigation]);

  // User Profile Modal state
  const [viewProfileModalOpen, setViewProfileModalOpen] = useState(false);

  // Profile metadata state
  const [avatar, setAvatar] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [realname, setRealname] = useState("");
  const [homepage, setHomepage] = useState("");
  const [status, setStatus] = useState("");
  const [color, setColor] = useState("");
  const [bot, setBot] = useState("");
  const [pronouns, setPronouns] = useState("");

  // Settings state - consolidated
  const [settings, setSettings] = useState<Record<string, SettingValue>>({});

  // Account state
  const [newNickname, setNewNickname] = useState(currentUser?.username || "");
  const [operName, setOperName] = useState(serverConfig?.operUsername || "");
  const [operPassword, setOperPassword] = useState("");
  const [operOnConnect, setOperOnConnect] = useState(
    serverConfig?.operOnConnect || false,
  );
  const [isEmojiAdminOpen, setIsEmojiAdminOpen] = useState(false);

  // Status messages state
  const [awayMessage, setAwayMessage] = useState("");
  const [quitMessage, setQuitMessage] = useState("");

  // Original values for change tracking
  const [originalValues, setOriginalValues] = useState<Record<
    string,
    unknown
  > | null>(null);

  // Notification sound file
  const [notificationSoundFile, setNotificationSoundFile] =
    useState<File | null>(null);

  // Refs for input fields
  const nicknameInputRef = useRef<HTMLInputElement>(null);
  const displayNameInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const statusInputRef = useRef<HTMLInputElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const botInputRef = useRef<HTMLInputElement>(null);
  const pronounsInputRef = useRef<HTMLInputElement>(null);
  const realnameInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const awayMessageInputRef = useRef<HTMLInputElement>(null);
  const quitMessageInputRef = useRef<HTMLInputElement>(null);

  // Track if we've initialized for this modal open
  const initializedRef = useRef(false);

  // Initialize settings from global state and current user metadata
  useEffect(() => {
    if (!ui.isSettingsModalOpen) {
      initializedRef.current = false;
      return;
    }

    // Only initialize once per modal open
    if (initializedRef.current) return;
    initializedRef.current = true;

    const initialSettings: Record<string, SettingValue> = {
      ...globalSettings,
      customMentions: deepClone(globalSettings.customMentions),
      ignoreList: deepClone(globalSettings.ignoreList),
    };

    setSettings(initialSettings);

    const initialNickname = currentUser?.username || "";
    const initialRealname = currentUser?.realname || "";
    setNewNickname(initialNickname);
    setRealname(initialRealname);

    let initialAvatar = "";
    let initialDisplayName = "";
    let initialHomepage = "";
    let initialStatus = "";
    let initialColor = "";
    let initialBot = "";
    let initialPronouns = "";

    if (currentUser && supportsMetadata) {
      const meta = currentUser.metadata || {};
      initialAvatar =
        typeof meta.avatar === "object"
          ? meta.avatar.value || ""
          : meta.avatar || "";
      initialDisplayName =
        typeof meta["display-name"] === "object"
          ? meta["display-name"].value || ""
          : meta["display-name"] || "";
      initialHomepage =
        typeof meta.homepage === "object"
          ? meta.homepage.value || ""
          : meta.homepage || "";
      initialStatus =
        typeof meta.status === "object"
          ? meta.status.value || ""
          : meta.status || "";
      initialColor =
        typeof meta.color === "object"
          ? meta.color.value || ""
          : meta.color || "";
      initialBot =
        typeof meta.bot === "object" ? meta.bot.value || "" : meta.bot || "";
      initialPronouns =
        typeof meta.pronouns === "object"
          ? meta.pronouns.value || ""
          : meta.pronouns || "";

      setAvatar(initialAvatar);
      setDisplayName(initialDisplayName);
      setHomepage(initialHomepage);
      setStatus(initialStatus);
      setColor(initialColor);
      setBot(initialBot);
      setPronouns(initialPronouns);
    }

    const initialOperName = serverConfig?.operUsername || "";
    const initialOperPassword = "";
    const initialOperOnConnect = serverConfig?.operOnConnect || false;
    setOperName(initialOperName);
    setOperPassword(initialOperPassword);
    setOperOnConnect(initialOperOnConnect);

    const initialAwayMessage = globalSettings.awayMessage || "";
    const initialQuitMessage =
      globalSettings.quitMessage || t`ObsidianIRC - Bringing IRC to the future`;
    setAwayMessage(initialAwayMessage);
    setQuitMessage(initialQuitMessage);

    setOriginalValues({
      ...deepClone(initialSettings),
      avatar: initialAvatar,
      displayName: initialDisplayName,
      realname: initialRealname,
      homepage: initialHomepage,
      status: initialStatus,
      color: initialColor,
      bot: initialBot,
      pronouns: initialPronouns,
      newNickname: initialNickname,
      operName: initialOperName,
      operPassword: initialOperPassword,
      operOnConnect: initialOperOnConnect,
      awayMessage: initialAwayMessage,
      quitMessage: initialQuitMessage,
    });
  }, [
    ui.isSettingsModalOpen,
    currentUser,
    supportsMetadata,
    globalSettings,
    serverConfig,
  ]);

  // Track if there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (!originalValues) return false;

    // Check profile metadata
    if (
      avatar !== originalValues.avatar ||
      displayName !== originalValues.displayName ||
      realname !== originalValues.realname ||
      homepage !== originalValues.homepage ||
      status !== originalValues.status ||
      color !== originalValues.color ||
      bot !== originalValues.bot ||
      pronouns !== originalValues.pronouns ||
      newNickname !== originalValues.newNickname ||
      operName !== originalValues.operName ||
      operPassword !== originalValues.operPassword ||
      operOnConnect !== originalValues.operOnConnect ||
      awayMessage !== originalValues.awayMessage ||
      quitMessage !== originalValues.quitMessage
    ) {
      return true;
    }

    // Check settings using deep equality
    for (const [key, value] of Object.entries(settings)) {
      if (!deepEqual(originalValues[key], value)) {
        return true;
      }
    }

    return false;
  }, [
    originalValues,
    settings,
    avatar,
    displayName,
    realname,
    homepage,
    status,
    color,
    bot,
    pronouns,
    newNickname,
    operName,
    operPassword,
    operOnConnect,
    awayMessage,
    quitMessage,
  ]);

  const handleSettingChange = useCallback(
    (settingKey: string, value: SettingValue) => {
      setSettings((prev) => ({
        ...prev,
        [settingKey]: value,
      }));
    },
    [],
  );

  // Profile field change handlers
  const handleAvatarChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setAvatar(e.target.value);
      setTimeout(() => {
        if (document.activeElement !== avatarInputRef.current) {
          avatarInputRef.current?.focus();
        }
      }, 0);
    },
    [],
  );

  const handleAvatarUrlChange = useCallback((url: string) => {
    setAvatar(url);
  }, []);

  const handleDisplayNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setDisplayName(e.target.value);
      setTimeout(() => {
        if (document.activeElement !== displayNameInputRef.current) {
          displayNameInputRef.current?.focus();
        }
      }, 0);
    },
    [],
  );

  const handleRealnameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setRealname(e.target.value);
      setTimeout(() => {
        if (document.activeElement !== realnameInputRef.current) {
          realnameInputRef.current?.focus();
        }
      }, 0);
    },
    [],
  );

  const handleHomepageChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setHomepage(e.target.value);
    },
    [],
  );

  const handleStatusChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setStatus(e.target.value);
      setTimeout(() => {
        if (document.activeElement !== statusInputRef.current) {
          statusInputRef.current?.focus();
        }
      }, 0);
    },
    [],
  );

  const handleColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setColor(e.target.value);
      setTimeout(() => {
        if (document.activeElement !== colorInputRef.current) {
          colorInputRef.current?.focus();
        }
      }, 0);
    },
    [],
  );

  const handleBotChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setBot(e.target.value);
      setTimeout(() => {
        if (document.activeElement !== botInputRef.current) {
          botInputRef.current?.focus();
        }
      }, 0);
    },
    [],
  );

  const handlePronounsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setPronouns(e.target.value);
    },
    [],
  );

  const handleNewNicknameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setNewNickname(e.target.value);
      setTimeout(() => {
        if (document.activeElement !== nicknameInputRef.current) {
          nicknameInputRef.current?.focus();
        }
      }, 0);
    },
    [],
  );

  const handleAwayMessageChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setAwayMessage(e.target.value);
    },
    [],
  );

  const handleQuitMessageChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuitMessage(e.target.value);
    },
    [],
  );

  const handleOperUp = () => {
    if (operName.trim() && operPassword.trim() && currentServer) {
      sendRaw(
        currentServer.id,
        `OPER ${operName.trim()} ${operPassword.trim()}`,
      );
    }
  };

  // Audio playback utility
  const playNotificationSound = async (soundFile?: File | string | null) => {
    try {
      if (!soundFile) return;

      let audioUrl: string;

      if (typeof soundFile === "string") {
        audioUrl = soundFile;
      } else {
        audioUrl = URL.createObjectURL(soundFile);
      }

      const audio = new Audio(audioUrl);
      await audio.play();

      if (typeof soundFile !== "string") {
        setTimeout(() => URL.revokeObjectURL(audioUrl), 1000);
      }
    } catch (error) {
      console.error("Failed to play notification sound:", error);
    }
  };

  // Handle save
  const handleSave = useCallback(async () => {
    if (!currentServer) return;

    if (newNickname && newNickname !== currentUser?.username) {
      changeNick(currentServer.id, newNickname);
    }

    if (realname && realname !== currentUser?.realname) {
      setName(currentServer.id, realname);
    }

    if (supportsMetadata) {
      const fields: Array<[string, string, string]> = [
        ["avatar", avatar, (originalValues?.avatar as string) ?? ""],
        [
          "display-name",
          displayName,
          (originalValues?.displayName as string) ?? "",
        ],
        ["homepage", homepage, (originalValues?.homepage as string) ?? ""],
        ["status", status, (originalValues?.status as string) ?? ""],
        ["color", color, (originalValues?.color as string) ?? ""],
        ["bot", bot, (originalValues?.bot as string) ?? ""],
        ["pronouns", pronouns, (originalValues?.pronouns as string) ?? ""],
      ];

      for (const [key, value, original] of fields) {
        if (value !== original) {
          // Bare SET (no trailing value) is the IRCv3 metadata delete command
          sendRaw(
            currentServer.id,
            value ? `METADATA * SET ${key} :${value}` : `METADATA * SET ${key}`,
          );
        }
      }
    }

    updateGlobalSettings({
      ...(settings as Partial<GlobalSettings>),
      awayMessage,
      quitMessage,
    });

    // Save notification sound file
    if (notificationSoundFile) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        updateGlobalSettings({ notificationSound: dataUrl });
      };
      reader.readAsDataURL(notificationSoundFile);
    }

    // Save oper settings for the current server
    if (serverConfig) {
      updateServer(serverConfig.id, {
        ...serverConfig,
        operUsername: operName,
        operOnConnect,
      });
    }

    // Reset original values
    setOriginalValues(null);
    toggleSettingsModal(false);
  }, [
    currentServer,
    supportsMetadata,
    avatar,
    displayName,
    realname,
    homepage,
    status,
    color,
    bot,
    pronouns,
    newNickname,
    currentUser,
    settings,
    notificationSoundFile,
    serverConfig,
    operName,
    operOnConnect,
    awayMessage,
    quitMessage,
    sendRaw,
    setName,
    changeNick,
    updateGlobalSettings,
    updateServer,
    toggleSettingsModal,
    originalValues?.avatar,
    originalValues?.bot,
    originalValues?.color,
    originalValues?.displayName,
    originalValues?.homepage,
    originalValues?.pronouns,
    originalValues?.status,
  ]);

  // Handle close
  const handleClose = useCallback(() => {
    if (hasUnsavedChanges) {
      const confirmClose = window.confirm(
        t`You have unsaved changes. Are you sure you want to close without saving?`,
      );
      if (!confirmClose) {
        return;
      }
    }
    setOriginalValues(null);
    toggleSettingsModal(false);
  }, [hasUnsavedChanges, toggleSettingsModal]);

  // Render media settings with progressive slider
  const renderMediaFields = () => {
    type LevelInfo = { label: string; description: string; warning?: true };
    const LEVELS: LevelInfo[] = [
      { label: t`Off`, description: t`No media previews are loaded.` },
      {
        label: t`Safe`,
        description: t`Shows media from your server's trusted file host. No requests are made to external services.`,
      },
      {
        label: t`Trusted Sources`,
        description: t`Also shows previews from YouTube, Vimeo, SoundCloud, and similar known services.`,
      },
      {
        label: t`All Content`,
        description: t`Shows all external media. Any URL may cause a request to an unknown server.`,
        warning: true,
      },
    ];

    const level = (settings.mediaVisibilityLevel as number | undefined) ?? 1;
    const current = LEVELS[level as 0 | 1 | 2 | 3];
    const fillPct = (level / 3) * 100;

    return (
      <div className="space-y-6">
        <div>
          <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-discord-text-muted">
            <Trans>Display</Trans>
          </p>

          {/* Title row */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-discord-text-normal">
              <Trans>Media Previews</Trans>
            </span>
            <span
              className={`text-xs font-semibold ${current.warning ? "text-yellow-400" : "text-discord-primary"}`}
            >
              {current.label}
            </span>
          </div>
          <p className="mb-5 text-xs text-discord-text-muted">
            <Trans>Control how much external media is loaded in chat.</Trans>
          </p>

          {/* Slider track */}
          <input
            type="range"
            min={0}
            max={3}
            step={1}
            value={level}
            onChange={(e) =>
              handleSettingChange(
                "mediaVisibilityLevel",
                Number(e.target.value),
              )
            }
            className="media-level-slider w-full h-2 cursor-pointer appearance-none rounded-full outline-none"
            style={{
              background: `linear-gradient(to right, #5865f2 ${fillPct}%, #3f4147 ${fillPct}%)`,
            }}
          />

          {/* Tick labels */}
          <div className="mt-2 flex justify-between">
            {LEVELS.map((l, i) => (
              <button
                key={l.label}
                type="button"
                onClick={() => handleSettingChange("mediaVisibilityLevel", i)}
                className={`text-xs leading-tight transition-colors ${
                  i === level
                    ? "font-medium text-discord-text-normal"
                    : "text-discord-text-muted hover:text-discord-text-normal"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-white/[0.06]" />

        {/* Description — updates as slider moves */}
        <div
          className={`text-sm leading-relaxed ${current.warning ? "text-yellow-400" : "text-discord-text-muted"}`}
        >
          {current.warning && (
            <span className="mr-1 font-semibold">⚠ Privacy Warning —</span>
          )}
          {current.description}
        </div>
      </div>
    );
  };

  // Render privacy settings
  const renderPrivacyFields = () => {
    return (
      <div className="space-y-4">
        <div className="space-y-4 p-4 bg-discord-dark-400 rounded">
          <h3 className="text-discord-text-normal font-medium">
            <Trans>Privacy Policy</Trans>
          </h3>
          <p className="text-discord-text-muted text-sm">
            <Trans>
              Learn how we handle your data and protect your privacy.
            </Trans>
          </p>

          <div className="space-y-3">
            <button
              type="button"
              onClick={() => {
                if (isTauri()) {
                  openExternalUrl("https://obsidianirc.pages.dev/privacy");
                } else {
                  window.open("/privacy", "_blank");
                }
              }}
              className="flex items-center justify-between w-full p-3 bg-discord-dark-500 rounded hover:bg-discord-dark-300 transition-colors"
            >
              <span className="text-discord-text-normal">
                <Trans>View Full Privacy Policy</Trans>
              </span>
              <svg
                className="w-4 h-4 text-discord-text-muted"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="space-y-4 p-4 bg-discord-dark-400 rounded">
          <h3 className="text-discord-text-normal font-medium">
            <Trans>Data Collection</Trans>
          </h3>
          <div className="space-y-2 text-discord-text-muted text-sm">
            <p>
              •{" "}
              <strong>
                <Trans>Local Storage:</Trans>
              </strong>{" "}
              <Trans>
                Your messages and settings are stored locally on your device
              </Trans>
            </p>
            <p>
              •{" "}
              <strong>
                <Trans>No Central Server:</Trans>
              </strong>{" "}
              <Trans>
                We don't store your IRC communications on our servers
              </Trans>
            </p>
            <p>
              •{" "}
              <strong>
                <Trans>IRC Servers:</Trans>
              </strong>{" "}
              <Trans>Only connect to servers you choose</Trans>
            </p>
            <p>
              •{" "}
              <strong>
                <Trans>Anonymous Analytics:</Trans>
              </strong>{" "}
              <Trans>Optional crash reports to improve the app</Trans>
            </p>
          </div>
        </div>

        <div className="space-y-4 p-4 bg-discord-dark-400 rounded">
          <h3 className="text-discord-text-normal font-medium">
            <Trans>Contact</Trans>
          </h3>
          <div className="space-y-2 text-discord-text-muted text-sm">
            <p>
              <Trans>Questions about privacy? Contact us:</Trans>
            </p>
            <p>
              •{" "}
              <strong>
                <Trans>Email:</Trans>
              </strong>{" "}
              <a
                href="mailto:support@obby.world"
                className="text-discord-primary hover:text-discord-primary-light"
              >
                support@obby.world
              </a>
            </p>
            <p>
              •{" "}
              <strong>
                <Trans>GitHub:</Trans>
              </strong>{" "}
              <a
                href="https://github.com/obbyworld/obby"
                target="_blank"
                rel="noopener noreferrer"
                className="text-discord-primary hover:text-discord-primary-light"
              >
                github.com/obbyworld/obby
              </a>
            </p>
          </div>
        </div>
      </div>
    );
  };

  const { getBackdropProps, getContentProps } = useModalBehavior({
    onClose: handleClose,
    isOpen: ui.isSettingsModalOpen,
  });

  // Get settings for active category
  const categorySettings = useMemo(() => {
    return settingsRegistry.getByCategory(activeCategory);
  }, [activeCategory]);

  const getProfileSetting = (settingId: string) => {
    return settingsRegistry.get(settingId);
  };

  // Render profile metadata fields
  const renderProfileFields = () => {
    const nicknameSetting = getProfileSetting("profile.nickname");
    const realnameSetting = getProfileSetting("profile.realname");
    const displayNameSetting = getProfileSetting("profile.displayName");
    const avatarSetting = getProfileSetting("profile.avatar");
    const homepageSetting = getProfileSetting("profile.homepage");
    const statusSetting = getProfileSetting("profile.status");
    const colorSetting = getProfileSetting("profile.color");
    const botSetting = getProfileSetting("profile.bot");
    const pronounsSetting = getProfileSetting("profile.pronouns");
    const awayMessageSetting = getProfileSetting("profile.awayMessage");
    const quitMessageSetting = getProfileSetting("profile.quitMessage");

    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="block text-discord-text-normal text-sm font-medium">
            {nicknameSetting ? i18n._(nicknameSetting.title) : t`Nickname`}
          </label>
          <p className="text-discord-text-muted text-xs">
            {nicknameSetting?.description &&
              i18n._(nicknameSetting.description)}
          </p>
          <TextInput
            ref={nicknameInputRef}
            value={newNickname}
            onChange={handleNewNicknameChange}
            className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-discord-primary"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-discord-text-normal text-sm font-medium">
            {realnameSetting ? i18n._(realnameSetting.title) : t`Real Name`}
          </label>
          <p className="text-discord-text-muted text-xs">
            {realnameSetting?.description &&
              i18n._(realnameSetting.description)}
          </p>
          <TextInput
            ref={realnameInputRef}
            value={realname}
            onChange={handleRealnameChange}
            placeholder={
              realnameSetting?.placeholder
                ? i18n._(realnameSetting.placeholder)
                : t`Enter real name`
            }
            className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-discord-primary"
          />
        </div>

        <div className="space-y-4 mt-6 pt-6 border-t border-discord-dark-400">
          <h3 className="text-sm font-semibold text-discord-text-normal uppercase">
            <Trans>Extended Profile</Trans>
          </h3>

          {!supportsMetadata && (
            <div className="p-4 bg-discord-dark-400 rounded">
              <p className="text-discord-text-muted text-sm">
                <Trans>
                  This server does not support extended profile metadata (IRCv3
                  METADATA extension). Additional fields like avatar, display
                  name, and status are not available.
                </Trans>
              </p>
            </div>
          )}

          {supportsMetadata && (
            <>
              <div
                id="setting-profile.displayName"
                className={`space-y-2 p-4 rounded-lg transition-all duration-300 ${
                  highlightedSetting === "profile.displayName"
                    ? "bg-yellow-400/20 ring-2 ring-yellow-400"
                    : ""
                }`}
              >
                <label className="block text-discord-text-normal text-sm font-medium">
                  {displayNameSetting
                    ? i18n._(displayNameSetting.title)
                    : t`Display Name`}
                </label>
                <p className="text-discord-text-muted text-xs">
                  {displayNameSetting?.description &&
                    i18n._(displayNameSetting.description)}
                </p>
                <TextInput
                  ref={displayNameInputRef}
                  value={displayName}
                  onChange={handleDisplayNameChange}
                  placeholder={
                    displayNameSetting?.placeholder
                      ? i18n._(displayNameSetting.placeholder)
                      : t`Enter display name`
                  }
                  className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-discord-primary"
                />
              </div>

              <div
                id="setting-profile.avatar"
                className={`space-y-2 p-4 rounded-lg transition-all duration-300 ${
                  highlightedSetting === "profile.avatar"
                    ? "bg-yellow-400/20 ring-2 ring-yellow-400"
                    : ""
                }`}
              >
                <label className="block text-discord-text-normal text-sm font-medium">
                  {avatarSetting ? i18n._(avatarSetting.title) : t`Avatar`}
                </label>
                <p className="text-discord-text-muted text-xs">
                  {avatarSetting?.description &&
                    i18n._(avatarSetting.description)}
                </p>
                <TextInput
                  ref={avatarInputRef}
                  value={avatar}
                  onChange={handleAvatarChange}
                  placeholder={
                    avatarSetting?.placeholder
                      ? i18n._(avatarSetting.placeholder)
                      : "https://example.com/avatar.png"
                  }
                  className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-discord-primary"
                />
                {currentServer && (
                  <AvatarUpload
                    currentAvatarUrl={avatar}
                    onAvatarUrlChange={handleAvatarUrlChange}
                    serverId={currentServer.id}
                  />
                )}
              </div>

              <div
                id="setting-profile.homepage"
                className={`space-y-2 p-4 rounded-lg transition-all duration-300 ${
                  highlightedSetting === "profile.homepage"
                    ? "bg-yellow-400/20 ring-2 ring-yellow-400"
                    : ""
                }`}
              >
                <label className="block text-discord-text-normal text-sm font-medium">
                  {homepageSetting
                    ? i18n._(homepageSetting.title)
                    : t`Homepage`}
                </label>
                <p className="text-discord-text-muted text-xs">
                  {homepageSetting?.description &&
                    i18n._(homepageSetting.description)}
                </p>
                <TextInput
                  value={homepage}
                  onChange={handleHomepageChange}
                  placeholder={
                    homepageSetting?.placeholder
                      ? i18n._(homepageSetting.placeholder)
                      : "https://example.com"
                  }
                  className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-discord-primary"
                />
              </div>

              <div
                id="setting-profile.status"
                className={`space-y-2 p-4 rounded-lg transition-all duration-300 ${
                  highlightedSetting === "profile.status"
                    ? "bg-yellow-400/20 ring-2 ring-yellow-400"
                    : ""
                }`}
              >
                <label className="block text-discord-text-normal text-sm font-medium">
                  {statusSetting ? i18n._(statusSetting.title) : t`Status`}
                </label>
                <p className="text-discord-text-muted text-xs">
                  {statusSetting?.description &&
                    i18n._(statusSetting.description)}
                </p>
                <TextInput
                  ref={statusInputRef}
                  value={status}
                  onChange={handleStatusChange}
                  placeholder={t`What's on your mind?`}
                  className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-discord-primary"
                />
              </div>

              <div
                id="setting-profile.color"
                className={`space-y-2 p-4 rounded-lg transition-all duration-300 ${
                  highlightedSetting === "profile.color"
                    ? "bg-yellow-400/20 ring-2 ring-yellow-400"
                    : ""
                }`}
              >
                <label className="block text-discord-text-normal text-sm font-medium">
                  {colorSetting ? i18n._(colorSetting.title) : t`Color`}
                </label>
                <p className="text-discord-text-muted text-xs">
                  {colorSetting?.description &&
                    i18n._(colorSetting.description)}
                </p>
                <div className="flex space-x-2">
                  <input
                    type="color"
                    value={color || "#000000"}
                    onChange={handleColorChange}
                    className="w-12 h-8 rounded border-none cursor-pointer"
                  />
                  <TextInput
                    ref={colorInputRef}
                    value={color}
                    onChange={handleColorChange}
                    placeholder="#000000"
                    className="flex-1 bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-discord-primary"
                  />
                </div>
              </div>

              <div
                id="setting-profile.bot"
                className={`space-y-2 p-4 rounded-lg transition-all duration-300 ${
                  highlightedSetting === "profile.bot"
                    ? "bg-yellow-400/20 ring-2 ring-yellow-400"
                    : ""
                }`}
              >
                <label className="block text-discord-text-normal text-sm font-medium">
                  {botSetting ? i18n._(botSetting.title) : t`Bot`}
                </label>
                <p className="text-discord-text-muted text-xs">
                  {botSetting?.description && i18n._(botSetting.description)}
                </p>
                <TextInput
                  ref={botInputRef}
                  value={bot}
                  onChange={handleBotChange}
                  placeholder={
                    botSetting?.placeholder
                      ? i18n._(botSetting.placeholder)
                      : "on"
                  }
                  className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-discord-primary"
                />
              </div>

              <div
                id="setting-profile.pronouns"
                className={`space-y-2 p-4 rounded-lg transition-all duration-300 ${
                  highlightedSetting === "profile.pronouns"
                    ? "bg-yellow-400/20 ring-2 ring-yellow-400"
                    : ""
                }`}
              >
                <label className="block text-discord-text-normal text-sm font-medium">
                  {pronounsSetting
                    ? i18n._(pronounsSetting.title)
                    : t`Pronouns`}
                </label>
                <p className="text-discord-text-muted text-xs">
                  {pronounsSetting?.description &&
                    i18n._(pronounsSetting.description)}
                </p>
                <TextInput
                  ref={pronounsInputRef}
                  list="pronouns-suggestions"
                  value={pronouns}
                  onChange={handlePronounsChange}
                  placeholder={
                    pronounsSetting?.placeholder
                      ? i18n._(pronounsSetting.placeholder)
                      : "she/her"
                  }
                  className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-discord-primary"
                />
                <datalist id="pronouns-suggestions">
                  <option value="she/her" />
                  <option value="he/him" />
                  <option value="they/them" />
                </datalist>
              </div>
            </>
          )}
        </div>

        <div className="space-y-4 mt-6 pt-6 border-t border-discord-dark-400">
          <h3 className="text-sm font-semibold text-discord-text-normal uppercase">
            {awayMessageSetting?.subcategory || t`Status Messages`}
          </h3>

          <div
            id="setting-profile.awayMessage"
            className={`space-y-2 ${
              highlightedSetting === "profile.awayMessage"
                ? "bg-yellow-400/20 ring-2 ring-yellow-400 rounded-lg p-4"
                : ""
            }`}
          >
            <label className="block text-discord-text-normal text-sm font-medium">
              {awayMessageSetting
                ? i18n._(awayMessageSetting.title)
                : t`Away Message`}
            </label>
            <p className="text-discord-text-muted text-xs">
              {awayMessageSetting?.description &&
                i18n._(awayMessageSetting.description)}
            </p>
            <TextInput
              ref={awayMessageInputRef}
              value={awayMessage}
              onChange={handleAwayMessageChange}
              placeholder={
                awayMessageSetting?.placeholder
                  ? i18n._(awayMessageSetting.placeholder)
                  : t`Away from keyboard`
              }
              className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-discord-primary"
            />
          </div>

          <div
            id="setting-profile.quitMessage"
            className={`space-y-2 ${
              highlightedSetting === "profile.quitMessage"
                ? "bg-yellow-400/20 ring-2 ring-yellow-400 rounded-lg p-4"
                : ""
            }`}
          >
            <label className="block text-discord-text-normal text-sm font-medium">
              {quitMessageSetting
                ? i18n._(quitMessageSetting.title)
                : t`Quit Message`}
            </label>
            <p className="text-discord-text-muted text-xs">
              {quitMessageSetting?.description &&
                i18n._(quitMessageSetting.description)}
            </p>
            <TextInput
              ref={quitMessageInputRef}
              value={quitMessage}
              onChange={handleQuitMessageChange}
              placeholder={
                quitMessageSetting?.placeholder
                  ? i18n._(quitMessageSetting.placeholder)
                  : t`ObsidianIRC - Bringing IRC to the future`
              }
              className="w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-discord-primary"
            />
          </div>
        </div>
      </div>
    );
  };

  // Render account settings
  const renderAccountFields = () => {
    if (!currentServer || !serverConfig) {
      return (
        <div className="text-discord-text-muted text-sm italic">
          Connect to a server to manage operator settings.
        </div>
      );
    }

    const supportsTwoFactor =
      currentServer?.capabilities?.some((c) =>
        c.startsWith("draft/account-2fa"),
      ) ?? false;

    return (
      <div className="space-y-4">
        {/* draft/persistence: shown only when the server advertises it */}
        <PersistenceSettingsPanel serverId={currentServer.id} />
        {/* Two-Factor Authentication */}
        {supportsTwoFactor && (
          <div className="space-y-4 p-4 bg-discord-dark-400 rounded">
            <h3 className="text-discord-text-normal font-medium">
              Two-Factor Authentication
            </h3>
            <p className="text-discord-text-muted text-sm">
              Add an authenticator app or biometric / security key to require a
              second factor when logging in.
            </p>
            <button
              type="button"
              onClick={() => {
                useStore
                  .getState()
                  .toggleTwoFactorSettings(true, currentServer.id);
              }}
              className="rounded bg-discord-button-secondary-default px-4 py-2 text-discord-text-normal hover:bg-discord-button-secondary-hover"
            >
              Manage two-factor authentication
            </button>
          </div>
        )}

        {/* IRC Operator Authentication */}
        <div className="space-y-4 p-4 bg-discord-dark-400 rounded">
          <h3 className="text-discord-text-normal font-medium">
            <Trans>IRC Operator</Trans>
          </h3>
          <p className="text-discord-text-muted text-sm">
            <Trans>
              Authenticate as an IRC Operator for administrative access
            </Trans>
          </p>

          <div className="space-y-2">
            <label className="block text-discord-text-normal text-sm font-medium">
              <Trans>Oper Name</Trans>
            </label>
            <TextInput
              value={operName}
              onChange={(e) => setOperName(e.target.value)}
              placeholder={t`Enter oper username`}
              className="w-full bg-discord-dark-500 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-discord-primary"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-discord-text-normal text-sm font-medium">
              <Trans>Oper Password</Trans>
            </label>
            <TextInput
              type="password"
              value={operPassword}
              onChange={(e) => setOperPassword(e.target.value)}
              placeholder={t`Enter oper password`}
              className="w-full bg-discord-dark-500 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-discord-primary"
            />
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="operOnConnect"
              checked={operOnConnect}
              onChange={(e) => setOperOnConnect(e.target.checked)}
              className="accent-discord-primary"
            />
            <label
              htmlFor="operOnConnect"
              className="text-discord-text-normal text-sm"
            >
              Authenticate on connect
            </label>
          </div>

          <button
            type="button"
            onClick={handleOperUp}
            disabled={!operName.trim() || !operPassword.trim()}
            className="w-full rounded bg-discord-button-success-default px-4 py-2 text-white hover:bg-discord-button-success-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Authenticate Now
          </button>
        </div>

        {/* draft/custom-emoji admin: visible only to IRCops on a
            server that advertises the cap. */}
        {currentUser?.isIrcOp && currentServer?.emojiPackUrl && (
          <div className="space-y-4 p-4 bg-discord-dark-400 rounded">
            <h3 className="text-discord-text-normal font-medium">
              Custom emoji packs
            </h3>
            <p className="text-discord-text-muted text-sm">
              Manage the network-wide and channel-scoped emoji packs that this
              server publishes via draft/EMOJI.
            </p>
            <button
              type="button"
              onClick={() => setIsEmojiAdminOpen(true)}
              className="w-full rounded bg-discord-blue px-4 py-2 text-white hover:bg-discord-blue-hover"
            >
              Manage packs
            </button>
          </div>
        )}
      </div>
    );
  };

  if (!ui.isSettingsModalOpen) return null;

  if (isMobile) {
    const portalTarget = document.getElementById("root") || document.body;

    return createPortal(
      <div
        className="fixed inset-0 z-[9999] bg-discord-dark-200 flex flex-col animate-in fade-in"
        style={{
          paddingTop: "var(--safe-area-inset-top, 0px)",
          paddingBottom: "var(--safe-area-inset-bottom, 0px)",
          paddingLeft: "var(--safe-area-inset-left, 0px)",
          paddingRight: "var(--safe-area-inset-right, 0px)",
        }}
      >
        {mobileView === "categories" ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-discord-dark-500 flex-shrink-0">
              <h2 className="text-white text-lg font-semibold">
                User Settings
              </h2>
              <button
                onClick={handleClose}
                className="p-1 rounded-lg hover:bg-discord-dark-400 text-discord-text-muted hover:text-white"
                aria-label={t`Close`}
              >
                <FaTimes />
              </button>
            </div>
            {/* Category list */}
            <div className="flex-1 overflow-y-auto">
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => {
                    setActiveCategory(category.id);
                    setMobileView("content");
                  }}
                  className="w-full flex items-center gap-4 px-4 py-4 border-b border-discord-dark-400 hover:bg-discord-dark-300 text-left transition-colors"
                >
                  <div className="text-discord-text-muted text-lg flex-shrink-0">
                    {category.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-white font-medium">
                      {category.title}
                    </div>
                    <div className="text-discord-text-muted text-sm truncate">
                      {category.description}
                    </div>
                  </div>
                  <FaChevronRight className="text-discord-text-muted flex-shrink-0" />
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* Header with back */}
            <div className="flex items-center justify-between p-4 border-b border-discord-dark-500 flex-shrink-0">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setMobileView("categories")}
                  className="p-1 rounded-lg hover:bg-discord-dark-400 text-discord-text-muted hover:text-white"
                  aria-label={t`Back`}
                >
                  <FaChevronLeft />
                </button>
                <h2 className="text-white text-lg font-semibold">
                  {categories.find((c) => c.id === activeCategory)?.title}
                </h2>
              </div>
              <button
                onClick={handleClose}
                className="p-1 rounded-lg hover:bg-discord-dark-400 text-discord-text-muted hover:text-white"
                aria-label={t`Close`}
              >
                <FaTimes />
              </button>
            </div>
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-4">
              {activeCategory === "profile" && renderProfileFields()}
              {activeCategory === "account" && renderAccountFields()}
              {activeCategory === "media" && renderMediaFields()}
              {activeCategory === "privacy" && renderPrivacyFields()}
              {activeCategory === "invitations" && (
                <InvitationsPanel serverId={currentServer?.id} />
              )}
              {activeCategory !== "profile" &&
                activeCategory !== "account" &&
                activeCategory !== "media" &&
                activeCategory !== "privacy" &&
                activeCategory !== "invitations" && (
                  <div className="space-y-4">
                    {activeCategory === "preferences" && (
                      <div className="flex flex-col gap-1">
                        <label className="text-sm font-medium text-discord-text-normal">
                          <Trans>Language</Trans>
                        </label>
                        <select
                          className="bg-discord-dark-400 text-white rounded px-3 py-2 text-sm border border-discord-dark-300 focus:outline-none focus:border-discord-primary"
                          value={i18n.locale}
                          onChange={(e) => {
                            const next = e.target.value;
                            localStorage.setItem("locale", next);
                            const url = new URL(window.location.href);
                            if (url.searchParams.has("lang")) {
                              url.searchParams.set("lang", next);
                              window.location.href = url.toString();
                            } else {
                              window.location.reload();
                            }
                          }}
                        >
                          <option value="en">English</option>
                          <option value="es">Español</option>
                          <option value="fr">Français</option>
                          <option value="zh">中文 (简体)</option>
                          <option value="zh-TW">中文 (繁體)</option>
                          <option value="pt">Português</option>
                          <option value="de">Deutsch</option>
                          <option value="it">Italiano</option>
                          <option value="ro">Română</option>
                          <option value="ru">Русский</option>
                          <option value="fi">Suomi</option>
                          <option value="ja">日本語</option>
                          <option value="pl">Polski</option>
                          <option value="nl">Nederlands</option>
                          <option value="ko">한국어</option>
                          <option value="tr">Türkçe</option>
                          <option value="uk">Українська</option>
                          <option value="sv">Svenska</option>
                          <option value="cs">Čeština</option>
                        </select>
                      </div>
                    )}
                    {categorySettings.map((setting) => (
                      <SettingField
                        key={setting.id}
                        setting={setting}
                        value={settings[setting.key] ?? setting.defaultValue}
                        onChange={(value) =>
                          handleSettingChange(setting.key, value)
                        }
                        isHighlighted={highlightedSetting === setting.id}
                      />
                    ))}
                  </div>
                )}
            </div>
            {/* Footer */}
            <div className="flex gap-3 p-4 border-t border-discord-dark-500 flex-shrink-0">
              {activeCategory === "profile" && currentServer && currentUser && (
                <button
                  onClick={() => setViewProfileModalOpen(true)}
                  className="px-4 py-2 bg-discord-dark-400 hover:bg-discord-dark-300 text-discord-text-normal rounded font-medium flex items-center gap-2"
                >
                  <FaUser size={12} />
                  <Trans>View Profile</Trans>
                </button>
              )}
              <button
                onClick={handleClose}
                className="flex-1 px-4 py-2 bg-discord-dark-400 text-discord-text-normal rounded font-medium hover:bg-discord-dark-300"
              >
                <Trans>Cancel</Trans>
              </button>
              <button
                onClick={handleSave}
                disabled={!hasUnsavedChanges}
                className={`flex-1 px-4 py-2 text-white rounded font-medium transition-colors ${
                  hasUnsavedChanges
                    ? "bg-discord-primary hover:bg-opacity-80"
                    : "bg-discord-dark-400 text-discord-text-muted cursor-not-allowed"
                }`}
              >
                {hasUnsavedChanges ? (
                  <Trans>Save</Trans>
                ) : (
                  <Trans>No Changes</Trans>
                )}
              </button>
            </div>
          </>
        )}

        {/* User Profile Modal (preserve existing) */}
        {viewProfileModalOpen && currentServer && currentUser && (
          <UserProfileModal
            isOpen={viewProfileModalOpen}
            onClose={() => setViewProfileModalOpen(false)}
            onBack={() => setViewProfileModalOpen(false)}
            serverId={currentServer.id}
            username={currentUser.username}
          />
        )}

        {/* draft/custom-emoji admin modal */}
        {isEmojiAdminOpen && currentServer && (
          <EmojiPackAdminModal
            serverId={currentServer.id}
            onClose={() => setIsEmojiAdminOpen(false)}
          />
        )}
      </div>,
      portalTarget,
    );
  }

  return (
    <div
      {...getBackdropProps()}
      className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 modal-container"
    >
      <div
        {...getContentProps()}
        className="bg-discord-dark-200 rounded-lg w-full max-w-4xl h-[80vh] flex overflow-hidden"
      >
        {/* Sidebar */}
        <div className="bg-discord-dark-300 flex flex-col">
          <div className="p-4 border-b border-discord-dark-500 flex justify-center">
            {isMobile ? (
              <FaCog className="text-white text-xl" />
            ) : (
              <h2 className="text-white text-xl font-bold">
                <Trans>User Settings</Trans>
              </h2>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            <nav className="p-2">
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setActiveCategory(category.id)}
                  className={`flex items-center ${isMobile ? "justify-center px-2" : "w-full px-3 text-left"} py-2 mb-1 rounded transition-colors overflow-hidden min-w-0 ${
                    activeCategory === category.id
                      ? "bg-discord-primary text-white"
                      : "text-discord-text-muted hover:text-white hover:bg-discord-dark-400"
                  }`}
                >
                  <div className={`${isMobile ? "text-lg" : "mr-3 text-sm"}`}>
                    {category.icon}
                  </div>
                  <span className={`${isMobile ? "hidden" : ""}`}>
                    {category.title}
                  </span>
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col">
          <div className="flex justify-between items-center p-4 border-b border-discord-dark-500">
            <h3 className="text-white text-lg font-semibold">
              {categories.find((c) => c.id === activeCategory)?.title}
            </h3>
            <button
              onClick={handleClose}
              className="text-discord-text-muted hover:text-white"
            >
              <FaTimes />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {/* Profile category - custom rendering */}
            {activeCategory === "profile" && renderProfileFields()}

            {/* Account category - custom rendering */}
            {activeCategory === "account" && renderAccountFields()}

            {/* Media category - custom slider rendering */}
            {activeCategory === "media" && renderMediaFields()}

            {/* Privacy category - custom rendering */}
            {activeCategory === "privacy" && renderPrivacyFields()}

            {/* Invitations category - custom rendering */}
            {activeCategory === "invitations" && (
              <InvitationsPanel serverId={currentServer?.id} />
            )}

            {/* Other categories - use SettingRenderer */}
            {activeCategory !== "profile" &&
              activeCategory !== "account" &&
              activeCategory !== "media" &&
              activeCategory !== "privacy" &&
              activeCategory !== "invitations" && (
                <div className="space-y-4">
                  {activeCategory === "preferences" && (
                    <div className="flex flex-col gap-1">
                      <label className="text-sm font-medium text-discord-text-normal">
                        <Trans>Language</Trans>
                      </label>
                      <select
                        className="bg-discord-dark-400 text-white rounded px-3 py-2 text-sm border border-discord-dark-300 focus:outline-none focus:border-discord-primary"
                        value={i18n.locale}
                        onChange={(e) => {
                          const next = e.target.value;
                          localStorage.setItem("locale", next);
                          const url = new URL(window.location.href);
                          if (url.searchParams.has("lang")) {
                            url.searchParams.set("lang", next);
                            window.location.href = url.toString();
                          } else {
                            window.location.reload();
                          }
                        }}
                      >
                        <option value="en">English</option>
                        <option value="es">Español</option>
                        <option value="fr">Français</option>
                        <option value="zh">中文 (简体)</option>
                        <option value="zh-TW">中文 (繁體)</option>
                        <option value="pt">Português</option>
                        <option value="de">Deutsch</option>
                        <option value="it">Italiano</option>
                        <option value="ro">Română</option>
                        <option value="ru">Русский</option>
                        <option value="fi">Suomi</option>
                        <option value="ja">日本語</option>
                        <option value="pl">Polski</option>
                        <option value="nl">Nederlands</option>
                      </select>
                    </div>
                  )}
                  {categorySettings.map((setting) => (
                    <SettingField
                      key={setting.id}
                      setting={setting}
                      value={settings[setting.key] ?? setting.defaultValue}
                      onChange={(value) =>
                        handleSettingChange(setting.key, value)
                      }
                      isHighlighted={highlightedSetting === setting.id}
                    />
                  ))}
                </div>
              )}
          </div>

          <div className="flex justify-between p-4 border-t border-discord-dark-500 space-x-3">
            {activeCategory === "profile" && currentServer && currentUser && (
              <button
                onClick={() => setViewProfileModalOpen(true)}
                className="px-4 py-2 bg-discord-dark-400 hover:bg-discord-dark-300 text-discord-text-normal rounded font-medium flex items-center gap-2"
              >
                <FaUser size={12} />
                <Trans>View Profile</Trans>
              </button>
            )}
            <div className="flex gap-3 ml-auto">
              <button
                onClick={handleClose}
                className="px-4 py-2 bg-discord-dark-400 text-discord-text-normal rounded font-medium hover:bg-discord-dark-300"
              >
                <Trans>Cancel</Trans>
              </button>
              <button
                onClick={handleSave}
                disabled={!hasUnsavedChanges}
                className={`px-4 py-2 text-white rounded font-medium transition-colors ${
                  hasUnsavedChanges
                    ? "bg-discord-primary hover:bg-opacity-80"
                    : "bg-discord-dark-400 text-discord-text-muted cursor-not-allowed"
                }`}
              >
                {hasUnsavedChanges ? (
                  <Trans>Save Changes</Trans>
                ) : (
                  <Trans>No Changes</Trans>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
      {/* User Profile Modal */}
      {viewProfileModalOpen && currentServer && currentUser && (
        <UserProfileModal
          isOpen={viewProfileModalOpen}
          onClose={() => setViewProfileModalOpen(false)}
          onBack={() => setViewProfileModalOpen(false)}
          serverId={currentServer.id}
          username={currentUser.username}
        />
      )}
      {/* draft/custom-emoji admin modal */}
      {isEmojiAdminOpen && currentServer && (
        <EmojiPackAdminModal
          serverId={currentServer.id}
          onClose={() => setIsEmojiAdminOpen(false)}
        />
      )}
    </div>
  );
});

UserSettings.displayName = "UserSettings";

export default UserSettings;
