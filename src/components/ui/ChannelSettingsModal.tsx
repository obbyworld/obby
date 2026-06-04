import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FaBan,
  FaChevronLeft,
  FaChevronRight,
  FaCog,
  FaEdit,
  FaPlus,
  FaShieldAlt,
  FaSlidersH,
  FaSpinner,
  FaTimes,
  FaTrash,
  FaUserPlus,
} from "react-icons/fa";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useModalBehavior } from "../../hooks/useModalBehavior";
import ircClient from "../../lib/ircClient";
import {
  hasOpPermission,
  humanizeNamedMode,
  isAbsoluteHttpUrl,
} from "../../lib/ircUtils";
import {
  lookupNamedModeMeta,
  NAMED_MODE_GROUP_LABELS,
  NAMED_MODE_GROUP_ORDER,
  type NamedModeGroup,
} from "../../lib/namedModeRegistry";
import useStore, { serverSupportsMetadata } from "../../store";
import type { Channel, NamedModeSpec } from "../../types";
import AvatarUpload from "./AvatarUpload";
import FloodSettingsModal from "./FloodSettingsModal";

interface FloodRule {
  amount: number;
  type: "c" | "j" | "k" | "m" | "n" | "t" | "r";
  action?: string;
  time?: number; // in minutes
}

interface ChannelSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverId: string;
  channelName: string;
}

interface ChannelMode {
  type: "b" | "e" | "I";
  mask: string;
  setter?: string;
  timestamp?: number;
}

const ChannelSettingsModal: React.FC<ChannelSettingsModalProps> = ({
  isOpen,
  onClose,
  serverId,
  channelName,
}) => {
  const [modes, setModes] = useState<ChannelMode[]>([]);
  const [loading, setLoading] = useState(false);
  const originalModesRef = useRef<{ [key: string]: string | null }>({});
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const addTimeout = useCallback((fn: () => void, delay: number) => {
    const t = setTimeout(fn, delay);
    timeoutsRef.current.push(t);
    return t;
  }, []);
  const clearPendingTimeouts = useCallback(() => {
    for (const t of timeoutsRef.current) clearTimeout(t);
    timeoutsRef.current = [];
  }, []);
  const [activeTab, setActiveTab] = useState<
    "b" | "e" | "I" | "general" | "settings" | "advanced"
  >("b");
  const [newMask, setNewMask] = useState("");
  const [editingMask, setEditingMask] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [removingMasks, setRemovingMasks] = useState(new Set<string>());

  // Metadata state
  const [channelAvatar, setChannelAvatar] = useState("");
  const [channelDisplayName, setChannelDisplayName] = useState("");
  const [channelTopic, setChannelTopic] = useState("");
  // draft/custom-emoji: URL to a per-channel emoji pack JSON document.
  // Stored as the `draft/emoji` channel metadata key per the spec.
  const [channelEmojiPack, setChannelEmojiPack] = useState("");
  const [newChannelName, setNewChannelName] = useState("");
  const [renameReason, setRenameReason] = useState("");
  const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);
  const [isUpdatingDisplayName, setIsUpdatingDisplayName] = useState(false);
  const [isUpdatingTopic, setIsUpdatingTopic] = useState(false);
  const [isApplyingChanges, setIsApplyingChanges] = useState(false);

  // Pending changes for the named-modes-aware Advanced tab. Keyed by
  // long-form mode name (e.g. "topiclock" or "obsidianirc/floodprot").
  // Apply diffs this against `originalModesRef` (which records the
  // current letter-keyed state) and emits a single sendNamedMode call.
  const [pendingNamedModes, setPendingNamedModes] = useState<
    Record<string, { sign: "+" | "-"; param?: string }>
  >({});

  // Flood settings modal state
  const [isFloodModalOpen, setIsFloodModalOpen] = useState(false);
  const [floodProfile, setFloodProfile] = useState("");
  const [floodParams, setFloodParams] = useState("");

  const [mobileView, setMobileView] = useState<"categories" | "content">(
    "categories",
  );

  // Standard IRC channel modes state
  const [clientLimit, setClientLimit] = useState<number | null>(null);
  const [inviteOnly, setInviteOnly] = useState(false);
  const [channelKey, setChannelKey] = useState("");
  const [moderated, setModerated] = useState(false);
  const [secret, setSecret] = useState(false);
  const [protectedTopic, setProtectedTopic] = useState(false);
  const [noExternalMessages, setNoExternalMessages] = useState(false);

  // UnrealIRCd-specific modes state
  const [blockColorCodes, setBlockColorCodes] = useState(false);
  const [noCTCPs, setNoCTCPs] = useState(false);
  const [delayJoins, setDelayJoins] = useState(false);
  const [filterBadWords, setFilterBadWords] = useState(false);
  const [channelHistory, setChannelHistory] = useState("");
  const [noKnocks, setNoKnocks] = useState(false);
  const [channelLink, setChannelLink] = useState("");
  const [registeredNickRequired, setRegisteredNickRequired] = useState(false);
  const [noNickChanges, setNoNickChanges] = useState(false);
  const [ircOperatorOnly, setIrcOperatorOnly] = useState(false);
  const [privateChannel, setPrivateChannel] = useState(false);
  const [permanentChannel, setPermanentChannel] = useState(false);
  const [noKicks, setNoKicks] = useState(false);
  const [registeredUsersOnly, setRegisteredUsersOnly] = useState(false);
  const [stripColorCodes, setStripColorCodes] = useState(false);
  const [noNotices, setNoNotices] = useState(false);
  const [noInvites, setNoInvites] = useState(false);
  const [secureConnectionRequired, setSecureConnectionRequired] =
    useState(false);

  // Handle flood settings save
  const handleFloodSettingsSave = useCallback(
    (newFloodProfile: string, floodRules: FloodRule[], seconds: number) => {
      setFloodProfile(newFloodProfile);
      // Format flood rules back to parameter string
      const rulesString = floodRules
        .map(
          (rule) =>
            `${rule.amount}${rule.type}${rule.action ? `#${rule.action}` : ""}${rule.time ? `:${rule.time}` : ""}`,
        )
        .join(",");
      const paramsString = rulesString
        ? `[${rulesString}]:${seconds}`
        : "Default";
      setFloodParams(paramsString);
      setIsFloodModalOpen(false);
    },
    [],
  );

  const hasFetchedRef = useRef(false);
  const isParsingRef = useRef(false);

  const servers = useStore((state) => state.servers);
  const { metadataSet } = useStore();
  const server = servers.find((s) => s.id === serverId);
  const channel = server?.channels.find((c) => c.name === channelName);

  // Get current user's status in this channel
  const currentUser = ircClient.getCurrentUser(serverId);
  const currentUserInChannel = channel?.users.find(
    (u) => u.username === currentUser?.username,
  );
  const userHasOpPermission = hasOpPermission(currentUserInChannel?.status);
  const supportsMetadata = serverSupportsMetadata(serverId);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { getBackdropProps, getContentProps } = useModalBehavior({
    onClose,
    isOpen,
  });

  // Define tab categories
  const categories = [
    ...(userHasOpPermission && supportsMetadata
      ? [
          {
            id: "general" as const,
            name: t`General`,
            icon: FaSlidersH,
            count: 0,
          },
        ]
      : []),
    {
      id: "b" as const,
      name: t`Bans`,
      icon: FaBan,
      count: modes.filter((m) => m.type === "b").length,
    },
    {
      id: "e" as const,
      name: t`Exceptions`,
      icon: FaShieldAlt,
      count: modes.filter((m) => m.type === "e").length,
    },
    {
      id: "I" as const,
      name: t`Invitations`,
      icon: FaUserPlus,
      count: modes.filter((m) => m.type === "I").length,
    },
    ...(userHasOpPermission && supportsMetadata
      ? [{ id: "settings" as const, name: t`Settings`, icon: FaCog, count: 0 }]
      : []),
    ...(userHasOpPermission &&
    (server?.namedModes?.supported || server?.isUnrealIRCd)
      ? [{ id: "advanced" as const, name: t`Advanced`, icon: FaCog, count: 0 }]
      : []),
  ];

  // Set initial tab based on permissions and reset mobile navigation
  useEffect(() => {
    if (isOpen) {
      setMobileView("categories");
      // Always reset to a valid default first so stale tabs from a previous open
      // don't show up if permissions changed
      setActiveTab("b");
      if (userHasOpPermission && supportsMetadata) {
        setActiveTab("general");
      }
    }
  }, [isOpen, userHasOpPermission, supportsMetadata]);

  // Reset fetch state and cancel in-flight timers when modal closes
  useEffect(() => {
    if (!isOpen) {
      hasFetchedRef.current = false;
      clearPendingTimeouts();
      setPendingNamedModes({});
    }
  }, [isOpen, clearPendingTimeouts]);

  const clearLists = useCallback(() => {
    useStore.setState((state) => {
      const updatedServers = state.servers.map((server) => {
        if (server.id === serverId) {
          const updatedChannels = server.channels.map((ch) => {
            if (ch.name === channelName) {
              return { ...ch, bans: [], invites: [], exceptions: [] };
            }
            return ch;
          });
          return { ...server, channels: updatedChannels };
        }
        return server;
      });
      return { servers: updatedServers };
    });
  }, [serverId, channelName]);

  const parseChannelModes = useCallback((currentChannel: Channel) => {
    if (isParsingRef.current) return;
    isParsingRef.current = true;
    const parsedModes: ChannelMode[] = [];

    // Add bans
    if (currentChannel.bans) {
      currentChannel.bans.forEach((ban) => {
        parsedModes.push({
          type: "b",
          mask: ban.mask,
          setter: ban.setter,
          timestamp: ban.timestamp,
        });
      });
    }

    // Add exceptions
    if (currentChannel.exceptions) {
      currentChannel.exceptions.forEach((exception) => {
        parsedModes.push({
          type: "e",
          mask: exception.mask,
          setter: exception.setter,
          timestamp: exception.timestamp,
        });
      });
    }

    // Add invites
    if (currentChannel.invites) {
      currentChannel.invites.forEach((invite) => {
        parsedModes.push({
          type: "I",
          mask: invite.mask,
          setter: invite.setter,
          timestamp: invite.timestamp,
        });
      });
    }

    setModes(parsedModes);
    isParsingRef.current = false;
  }, []);

  // Function to parse current channel modes using CHANMODES
  const parseCurrentChannelModes = useCallback(
    (modestring: string, modeargs: string[], chanmodes?: string) => {
      // Parse CHANMODES to determine mode groups
      const modeGroups = chanmodes ? chanmodes.split(",") : [];
      const groupA = modeGroups[0] || ""; // Always require param
      const groupB = modeGroups[1] || ""; // Always require param
      const groupC = modeGroups[2] || ""; // Require param only when setting
      const groupD = modeGroups[3] || ""; // Never require param

      const parsedModes: { [key: string]: string | null } = {};
      let argIndex = 0;
      let currentAction: "+" | "-" = "+";

      // Parse the modestring as a MODE command, applying + and - to build final state
      for (let i = 0; i < modestring.length; i++) {
        const char = modestring[i];
        if (char === "+" || char === "-") {
          currentAction = char;
          continue;
        }

        const mode = char;

        // Determine if this mode should have a parameter
        let hasParam = false;
        if (groupA.includes(mode) || groupB.includes(mode)) {
          hasParam = true;
        } else if (groupC.includes(mode)) {
          hasParam = currentAction === "+";
        }

        let param =
          hasParam && argIndex < modeargs.length ? modeargs[argIndex++] : null;

        // When the server omits the argument (null), store a sentinel to avoid
        // accidentally removing the mode on apply. Note: "*" is NOT treated as hidden
        // because some servers/users use "*" as a literal channel key.
        if ((mode === "k" || mode === "H" || mode === "L") && param === null) {
          param = "__HIDDEN__";
        }

        if (currentAction === "+") {
          parsedModes[mode] = param;
        } else {
          // Unsetting
          delete parsedModes[mode];
        }
      }

      return parsedModes;
    },
    [],
  );

  // Function to load current channel modes
  const loadCurrentChannelModes = useCallback(
    (resetOriginal = false) => {
      const servers = useStore.getState().servers;
      const currentServer = servers.find((s) => s.id === serverId);
      const currentChannel = currentServer?.channels.find(
        (c) => c.name === channelName,
      );
      if (!currentChannel) return;

      // Get current modes from channel object
      const currentModes = currentChannel.modes || "";
      const modeArgs = currentChannel.modeArgs || [];

      // Parse modes using CHANMODES-aware logic
      const parsedModes = parseCurrentChannelModes(
        currentModes,
        modeArgs,
        currentServer?.chanmodes,
      );

      // Store original modes for comparison (only when explicitly requested to avoid
      // clobbering the baseline while the user is mid-edit)
      if (resetOriginal) {
        originalModesRef.current = parsedModes;
      }

      // Set standard IRC modes
      setInviteOnly("i" in parsedModes);
      setModerated("m" in parsedModes);
      setSecret("s" in parsedModes);
      setProtectedTopic("t" in parsedModes);
      setNoExternalMessages("n" in parsedModes);

      // Set parameterized modes
      setChannelKey(
        "k" in parsedModes && parsedModes.k !== "__HIDDEN__"
          ? parsedModes.k || ""
          : "",
      );
      setClientLimit(
        "l" in parsedModes
          ? parsedModes.l
            ? Number.parseInt(parsedModes.l, 10)
            : null
          : null,
      );
      setFloodParams("f" in parsedModes ? parsedModes.f || "" : "");
      setChannelHistory(
        "H" in parsedModes && parsedModes.H !== "__HIDDEN__"
          ? parsedModes.H || ""
          : "",
      );
      setChannelLink(
        "L" in parsedModes && parsedModes.L !== "__HIDDEN__"
          ? parsedModes.L || ""
          : "",
      );
      setFloodProfile("F" in parsedModes ? parsedModes.F || "" : "");

      // Set UnrealIRCd-specific modes
      setBlockColorCodes("c" in parsedModes);
      setNoCTCPs("C" in parsedModes);
      setDelayJoins("D" in parsedModes);
      setFilterBadWords("G" in parsedModes);
      setNoKnocks("K" in parsedModes);
      setRegisteredNickRequired("M" in parsedModes);
      setNoNickChanges("N" in parsedModes);
      setIrcOperatorOnly("O" in parsedModes);
      setPrivateChannel("p" in parsedModes);
      setPermanentChannel("P" in parsedModes);
      setNoKicks("Q" in parsedModes);
      setRegisteredUsersOnly("R" in parsedModes);
      setStripColorCodes("S" in parsedModes);
      setNoNotices("T" in parsedModes);
      setNoInvites("V" in parsedModes);
      setSecureConnectionRequired("z" in parsedModes);
    },
    [serverId, channelName, parseCurrentChannelModes],
  );

  const fetchChannelModes = useCallback(async () => {
    setLoading(true);
    try {
      // Clear existing mode lists
      clearLists();

      // Request channel modes from server
      await ircClient.sendRaw(serverId, `MODE ${channelName}`);

      // Request channel ban/exception/invite lists
      await ircClient.sendRaw(serverId, `MODE ${channelName} +b`);
      await ircClient.sendRaw(serverId, `MODE ${channelName} +e`);
      await ircClient.sendRaw(serverId, `MODE ${channelName} +I`);

      // Wait for responses and update UI
      addTimeout(() => {
        const updatedServer = useStore
          .getState()
          .servers.find((s) => s.id === serverId);
        const updatedChannel = updatedServer?.channels.find(
          (c) => c.name === channelName,
        );
        if (updatedChannel) {
          parseChannelModes(updatedChannel);
          // Load current channel modes into state and reset baseline
          loadCurrentChannelModes(true);
        }
        setLoading(false);
      }, 1000); // Give some time for the responses
    } catch (error) {
      console.error("Failed to fetch channel modes:", error);
      setLoading(false);
    }
  }, [
    serverId,
    channelName,
    clearLists,
    loadCurrentChannelModes,
    parseChannelModes, // Wait for responses and update UI
    addTimeout,
  ]);

  const addMode = async (type: "b" | "e" | "I", mask: string) => {
    setIsAdding(true);
    try {
      await ircClient.sendRaw(serverId, `MODE ${channelName} +${type} ${mask}`);
      setNewMask("");
      // Re-fetch the lists and modes after the change
      addTimeout(() => {
        clearLists();
        void Promise.all([
          ircClient.sendRaw(serverId, `MODE ${channelName} +b`),
          ircClient.sendRaw(serverId, `MODE ${channelName} +e`),
          ircClient.sendRaw(serverId, `MODE ${channelName} +I`),
        ]).catch((error) => {
          console.error("Failed to refresh channel mode lists:", error);
        });

        // Wait for responses and update UI
        addTimeout(() => {
          const updatedServer = useStore
            .getState()
            .servers.find((s) => s.id === serverId);
          const updatedChannel = updatedServer?.channels.find(
            (c) => c.name === channelName,
          );
          if (updatedChannel) {
            parseChannelModes(updatedChannel);
            loadCurrentChannelModes(true);
          }
          setIsAdding(false);
        }, 1000);
      }, 500);
    } catch (error) {
      console.error(`Failed to add ${type} mode:`, error);
      setIsAdding(false);
    }
  };

  const removeMode = async (type: "b" | "e" | "I", mask: string) => {
    setRemovingMasks((prev) => new Set(prev).add(mask));
    try {
      await ircClient.sendRaw(serverId, `MODE ${channelName} -${type} ${mask}`);
      // Re-fetch the lists and modes after the change
      addTimeout(() => {
        clearLists();
        void Promise.all([
          ircClient.sendRaw(serverId, `MODE ${channelName} +b`),
          ircClient.sendRaw(serverId, `MODE ${channelName} +e`),
          ircClient.sendRaw(serverId, `MODE ${channelName} +I`),
        ]).catch((error) => {
          console.error("Failed to refresh channel mode lists:", error);
        });

        // Wait for responses and update UI
        addTimeout(() => {
          const updatedServer = useStore
            .getState()
            .servers.find((s) => s.id === serverId);
          const updatedChannel = updatedServer?.channels.find(
            (c) => c.name === channelName,
          );
          if (updatedChannel) {
            parseChannelModes(updatedChannel);
            loadCurrentChannelModes(true);
          }
          setRemovingMasks((prev) => {
            const newSet = new Set(prev);
            newSet.delete(mask);
            return newSet;
          });
        }, 1000);
      }, 500);
    } catch (error) {
      console.error(`Failed to remove ${type} mode:`, error);
      setRemovingMasks((prev) => {
        const newSet = new Set(prev);
        newSet.delete(mask);
        return newSet;
      });
    }
  };

  const startEditing = (mask: string) => {
    setEditingMask(mask);
    setEditValue(mask);
  };

  const cancelEditing = () => {
    setEditingMask(null);
    setEditValue("");
  };

  const saveEdit = async (oldMask: string, newMask: string) => {
    if (oldMask === newMask) {
      cancelEditing();
      return;
    }

    try {
      // Remove old mask and add new one
      await ircClient.sendRaw(
        serverId,
        `MODE ${channelName} -${activeTab} ${oldMask}`,
      );
      await ircClient.sendRaw(
        serverId,
        `MODE ${channelName} +${activeTab} ${newMask}`,
      );
      cancelEditing();
      // Re-fetch the lists and modes after the change
      addTimeout(() => {
        clearLists();
        void Promise.all([
          ircClient.sendRaw(serverId, `MODE ${channelName} +b`),
          ircClient.sendRaw(serverId, `MODE ${channelName} +e`),
          ircClient.sendRaw(serverId, `MODE ${channelName} +I`),
        ]).catch((error) => {
          console.error("Failed to refresh channel mode lists:", error);
        });

        // Wait for responses and update UI
        addTimeout(() => {
          const updatedServer = useStore
            .getState()
            .servers.find((s) => s.id === serverId);
          const updatedChannel = updatedServer?.channels.find(
            (c) => c.name === channelName,
          );
          if (updatedChannel) {
            parseChannelModes(updatedChannel);
            loadCurrentChannelModes(true);
          }
        }, 1000);
      }, 500);
    } catch (error) {
      console.error(`Failed to edit ${activeTab} mode:`, error);
    }
  };

  const filteredModes = modes.filter((mode) => mode.type === activeTab);

  // Handle applying all general tab changes
  const applyGeneralChanges = async () => {
    setIsApplyingChanges(true);
    try {
      // Apply topic change
      if (channelTopic !== (channel?.topic || "")) {
        ircClient.setTopic(serverId, channelName, channelTopic);
      }

      // Apply avatar change
      if (channelAvatar !== (channel?.metadata?.avatar?.value || "")) {
        await metadataSet(
          serverId,
          channelName,
          "avatar",
          channelAvatar || undefined,
        );
      }

      // Apply display name change
      if (
        channelDisplayName !==
        (channel?.metadata?.["display-name"]?.value || "")
      ) {
        await metadataSet(
          serverId,
          channelName,
          "display-name",
          channelDisplayName || undefined,
        );
      }

      // draft/custom-emoji: apply emoji pack URL change
      if (
        channelEmojiPack !== (channel?.metadata?.["draft/emoji"]?.value || "")
      ) {
        await metadataSet(
          serverId,
          channelName,
          "draft/emoji",
          channelEmojiPack.trim() || undefined,
        );
      }

      // Apply channel rename
      if (newChannelName.trim() && newChannelName.trim() !== channel?.name) {
        ircClient.renameChannel(
          serverId,
          channelName,
          newChannelName.trim(),
          renameReason.trim() || undefined,
        );
      }
    } finally {
      setIsApplyingChanges(false);
    }
  };

  // Handle applying settings tab changes
  const applySettingsChanges = async () => {
    setIsApplyingChanges(true);
    try {
      let setModes = "";
      let unsetModes = "";
      const setArgs: string[] = [];
      const unsetArgs: string[] = [];

      // Client limit (+l/-l) - compare with original state
      const currentLimit = clientLimit !== null ? clientLimit.toString() : null;
      const originalLimit = originalModesRef.current.l;
      if (currentLimit && currentLimit !== originalLimit) {
        setModes += "l";
        setArgs.push(currentLimit);
      } else if (!currentLimit && "l" in originalModesRef.current) {
        unsetModes += "l";
      }

      // Invite-only (+i/-i)
      if (inviteOnly && !("i" in originalModesRef.current)) {
        setModes += "i";
      } else if (!inviteOnly && "i" in originalModesRef.current) {
        unsetModes += "i";
      }

      // Channel key (+k/-k)
      const originalKey = originalModesRef.current.k;
      if (channelKey.trim() && channelKey.trim() !== originalKey) {
        // New key typed, or replacing a hidden key
        setModes += "k";
        setArgs.push(channelKey.trim());
      } else if (
        !channelKey.trim() &&
        "k" in originalModesRef.current &&
        originalKey !== "__HIDDEN__"
      ) {
        // User cleared a known key — unset it (RFC 2812 requires "*" as placeholder arg)
        unsetModes += "k";
        unsetArgs.push("*");
      }

      // Moderated (+m/-m)
      if (moderated && !("m" in originalModesRef.current)) {
        setModes += "m";
      } else if (!moderated && "m" in originalModesRef.current) {
        unsetModes += "m";
      }

      // Secret (+s/-s)
      if (secret && !("s" in originalModesRef.current)) {
        setModes += "s";
      } else if (!secret && "s" in originalModesRef.current) {
        unsetModes += "s";
      }

      // Protected topic (+t/-t)
      if (protectedTopic && !("t" in originalModesRef.current)) {
        setModes += "t";
      } else if (!protectedTopic && "t" in originalModesRef.current) {
        unsetModes += "t";
      }

      // No external messages (+n/-n)
      if (noExternalMessages && !("n" in originalModesRef.current)) {
        setModes += "n";
      } else if (!noExternalMessages && "n" in originalModesRef.current) {
        unsetModes += "n";
      }

      // Build the MODE command
      let modeCommand = `MODE ${channelName}`;
      let modesString = "";
      const allArgs: string[] = [];

      if (setModes) {
        modesString += `+${setModes}`;
        allArgs.push(...setArgs);
      }

      if (unsetModes) {
        modesString += `-${unsetModes}`;
        allArgs.push(...unsetArgs);
      }

      if (modesString) {
        modeCommand += ` ${modesString}`;
      }

      if (allArgs.length > 0) {
        modeCommand += ` ${allArgs.join(" ")}`;
      }

      // Send mode changes
      if (setModes || unsetModes) {
        await ircClient.sendRaw(serverId, modeCommand);
      }
    } finally {
      setIsApplyingChanges(false);
    }
  };

  // Handle applying advanced tab changes
  const applyAdvancedChanges = async () => {
    setIsApplyingChanges(true);
    try {
      if (!channel) return;

      const currentModes = channel.modes || "";
      let setModes = "";
      let unsetModes = "";
      const setArgs: string[] = [];
      const unsetArgs: string[] = [];

      // Helper function to check if a mode is currently set
      // const isModeSet = (mode: string) => currentModes.includes(mode);

      // Helper function to get current parameter for a mode
      // const getCurrentParam = (mode: string) => {
      //   const match = currentModes.match(new RegExp(`${mode} ([^\\s]+)`));
      //   return match ? match[1] : null;
      // };

      // Block color codes (+c/-c)
      if (blockColorCodes && !("c" in originalModesRef.current)) {
        setModes += "c";
      } else if (!blockColorCodes && "c" in originalModesRef.current) {
        unsetModes += "c";
      }

      // No CTCPs (+C/-C)
      if (noCTCPs && !("C" in originalModesRef.current)) {
        setModes += "C";
      } else if (!noCTCPs && "C" in originalModesRef.current) {
        unsetModes += "C";
      }

      // Delay joins (+D/-D)
      if (delayJoins && !("D" in originalModesRef.current)) {
        setModes += "D";
      } else if (!delayJoins && "D" in originalModesRef.current) {
        unsetModes += "D";
      }

      // Filter bad words (+G/-G)
      if (filterBadWords && !("G" in originalModesRef.current)) {
        setModes += "G";
      } else if (!filterBadWords && "G" in originalModesRef.current) {
        unsetModes += "G";
      }

      // Channel history (+H/-H)
      const currentHistory = originalModesRef.current.H;
      if (channelHistory.trim() && channelHistory.trim() !== currentHistory) {
        setModes += "H";
        setArgs.push(channelHistory.trim());
      } else if (
        !channelHistory.trim() &&
        "H" in originalModesRef.current &&
        currentHistory !== "__HIDDEN__"
      ) {
        unsetModes += "H";
        unsetArgs.push("*");
      }

      // No knocks (+K/-K)
      if (noKnocks && !("K" in originalModesRef.current)) {
        setModes += "K";
      } else if (!noKnocks && "K" in originalModesRef.current) {
        unsetModes += "K";
      }

      // Channel link (+L/-L)
      const currentLink = originalModesRef.current.L;
      if (channelLink.trim() && channelLink.trim() !== currentLink) {
        setModes += "L";
        setArgs.push(channelLink.trim());
      } else if (
        !channelLink.trim() &&
        "L" in originalModesRef.current &&
        currentLink !== "__HIDDEN__"
      ) {
        unsetModes += "L";
        unsetArgs.push("*");
      }

      // Registered nick required (+M/-M)
      if (registeredNickRequired && !("M" in originalModesRef.current)) {
        setModes += "M";
      } else if (!registeredNickRequired && "M" in originalModesRef.current) {
        unsetModes += "M";
      }

      // No nick changes (+N/-N)
      if (noNickChanges && !("N" in originalModesRef.current)) {
        setModes += "N";
      } else if (!noNickChanges && "N" in originalModesRef.current) {
        unsetModes += "N";
      }

      // IRC operator only (+O/-O)
      if (ircOperatorOnly && !("O" in originalModesRef.current)) {
        setModes += "O";
      } else if (!ircOperatorOnly && "O" in originalModesRef.current) {
        unsetModes += "O";
      }

      // Private channel (+p/-p)
      if (privateChannel && !("p" in originalModesRef.current)) {
        setModes += "p";
      } else if (!privateChannel && "p" in originalModesRef.current) {
        unsetModes += "p";
      }

      // Permanent channel (+P/-P)
      if (permanentChannel && !("P" in originalModesRef.current)) {
        setModes += "P";
      } else if (!permanentChannel && "P" in originalModesRef.current) {
        unsetModes += "P";
      }

      // No kicks (+Q/-Q)
      if (noKicks && !("Q" in originalModesRef.current)) {
        setModes += "Q";
      } else if (!noKicks && "Q" in originalModesRef.current) {
        unsetModes += "Q";
      }

      // Registered users only (+R/-R)
      if (registeredUsersOnly && !("R" in originalModesRef.current)) {
        setModes += "R";
      } else if (!registeredUsersOnly && "R" in originalModesRef.current) {
        unsetModes += "R";
      }

      // Strip color codes (+S/-S)
      if (stripColorCodes && !("S" in originalModesRef.current)) {
        setModes += "S";
      } else if (!stripColorCodes && "S" in originalModesRef.current) {
        unsetModes += "S";
      }

      // No notices (+T/-T)
      if (noNotices && !("T" in originalModesRef.current)) {
        setModes += "T";
      } else if (!noNotices && "T" in originalModesRef.current) {
        unsetModes += "T";
      }

      // No invites (+V/-V)
      if (noInvites && !("V" in originalModesRef.current)) {
        setModes += "V";
      } else if (!noInvites && "V" in originalModesRef.current) {
        unsetModes += "V";
      }

      // Secure connection required (+z/-z)
      if (secureConnectionRequired && !("z" in originalModesRef.current)) {
        setModes += "z";
      } else if (!secureConnectionRequired && "z" in originalModesRef.current) {
        unsetModes += "z";
      }

      // Flood profile (+F/-F)
      const currentFloodProfile = originalModesRef.current.F;
      if (floodProfile && floodProfile !== currentFloodProfile) {
        setModes += "F";
        setArgs.push(floodProfile);
      } else if (!floodProfile && currentFloodProfile) {
        unsetModes += "F";
        unsetArgs.push("*");
      }

      // Flood parameters (+f/-f)
      const currentFloodParams = originalModesRef.current.f;
      if (
        floodParams &&
        floodParams !== "Default" &&
        floodParams !== currentFloodParams
      ) {
        setModes += "f";
        setArgs.push(floodParams);
      } else if (
        (!floodParams || floodParams === "Default") &&
        currentFloodParams
      ) {
        unsetModes += "f";
        unsetArgs.push("*");
      }

      // Build the MODE command
      let modeCommand = `MODE ${channelName}`;
      let modesString = "";
      const allArgs: string[] = [];

      if (setModes) {
        modesString += `+${setModes}`;
        allArgs.push(...setArgs);
      }

      if (unsetModes) {
        modesString += `-${unsetModes}`;
        allArgs.push(...unsetArgs);
      }

      if (modesString) {
        modeCommand += ` ${modesString}`;
      }

      if (allArgs.length > 0) {
        modeCommand += ` ${allArgs.join(" ")}`;
      }

      // Only send command if there are actual changes
      if (setModes || unsetModes) {
        await ircClient.sendRaw(serverId, modeCommand);
      }
    } finally {
      setIsApplyingChanges(false);
    }
  };

  /** Apply path for the named-modes-aware Advanced tab. Walks the
   *  pendingNamedModes map and emits a single sendNamedMode call. */
  const applyNamedModesAdvancedChanges = async () => {
    if (!server || !channel) return;
    const items: Array<{ sign: "+" | "-"; name: string; param?: string }> = [];
    for (const [name, change] of Object.entries(pendingNamedModes)) {
      items.push({ sign: change.sign, name, param: change.param });
    }
    if (!items.length) return;
    setIsApplyingChanges(true);
    try {
      ircClient.sendNamedMode(serverId, channelName, items, server.namedModes);
      setPendingNamedModes({});
    } finally {
      setIsApplyingChanges(false);
    }
  };

  // Cancel pending timeouts when component unmounts
  useEffect(() => {
    return () => clearPendingTimeouts();
  }, [clearPendingTimeouts]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Using channelName instead of channel to avoid infinite loop from object reference changes
  useEffect(() => {
    if (isOpen && channel) {
      // Clear current modes and fetch new ones when channel changes
      setModes([]);
      hasFetchedRef.current = false;
      fetchChannelModes();
    }
  }, [isOpen, channelName, fetchChannelModes]);

  // Load channel metadata when modal opens
  useEffect(() => {
    if (isOpen && channel) {
      setChannelAvatar(channel.metadata?.avatar?.value || "");
      setChannelDisplayName(channel.metadata?.["display-name"]?.value || "");
      setChannelEmojiPack(channel.metadata?.["draft/emoji"]?.value || "");
      setChannelTopic(channel.topic || "");
      setNewChannelName(channel.name);
      setRenameReason("");

      // Load current channel modes and reset baseline when modal opens
      loadCurrentChannelModes(true);
    }
  }, [isOpen, channel, loadCurrentChannelModes]);

  // Update local mode state when channel modes change (e.g., from MODE events)
  useEffect(() => {
    if (isOpen && channel) {
      loadCurrentChannelModes();
    }
  }, [isOpen, channel, loadCurrentChannelModes]);

  if (!isOpen) return null;

  /** Look up the live state of a named mode in the parsed mode-state
   *  ref. Returns { set, param } where set indicates presence and
   *  param is the current parameter (if any). */
  const liveStateForNamedMode = (
    spec: NamedModeSpec,
  ): { set: boolean; param: string | null } => {
    if (!spec.letter) return { set: false, param: null };
    const stored = originalModesRef.current[spec.letter];
    if (stored === undefined) return { set: false, param: null };
    // null = present, no param. string = present with param. "__HIDDEN__"
    // (used for +k/+L masking) counts as present without an exposable
    // value.
    return { set: true, param: stored };
  };

  /** What the user has chosen the mode should become, taking pending
   *  edits into account. Returns null when there's no override. */
  const stagedStateForNamedMode = (
    name: string,
  ): { sign: "+" | "-"; param?: string } | null => {
    return pendingNamedModes[name] ?? null;
  };

  const stageNamedMode = (
    name: string,
    next: { sign: "+" | "-"; param?: string } | null,
  ) => {
    setPendingNamedModes((prev) => {
      const out = { ...prev };
      if (next === null) delete out[name];
      else out[name] = next;
      return out;
    });
  };

  /** Render a single named-mode entry. The control type is dictated
   *  by the spec's mode type (1=list, 2=param-both, 3=param-add-only,
   *  4=flag, 5=prefix). We skip 1 (the dedicated Bans/Exceptions/
   *  Invitations tabs cover those) and 5 (member-prefix modes are
   *  set via the member context menu, not channel settings).
   *
   *  Returns { node, group } so the caller can bucket rows into the
   *  section ordering from NAMED_MODE_GROUP_ORDER. Returns null when
   *  the registry marks the mode as hidden (covered by another tab or
   *  server-managed). */
  const renderNamedModeRow = (
    spec: NamedModeSpec,
  ): { node: React.ReactNode; group: NamedModeGroup } | null => {
    if (spec.type === 1 || spec.type === 5) return null;
    const meta = lookupNamedModeMeta(spec.name);
    if (meta?.hidden) return null;

    const fallback = humanizeNamedMode(spec.name);
    const label = meta?.label ?? fallback.display;
    const description = meta?.description ?? "";
    const group: NamedModeGroup = meta?.group ?? "properties";
    const placeholder = meta?.paramPlaceholder;

    const live = liveStateForNamedMode(spec);
    const staged = stagedStateForNamedMode(spec.name);

    const isFlag = spec.type === 4;
    const stagedSet = staged ? staged.sign === "+" : live.set;
    const stagedParam = staged?.param ?? live.param ?? "";

    const headerRow = (
      <div className="flex flex-col min-w-0 flex-1 gap-0.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-white truncate">
            {label}
          </span>
          {fallback.vendor && (
            <span className="text-[10px] tracking-wide px-1.5 py-0.5 rounded bg-discord-dark-400 text-discord-text-muted flex-shrink-0 lowercase">
              {fallback.vendor}
            </span>
          )}
        </div>
        {description && (
          <p className="text-xs text-discord-text-muted leading-snug">
            {description}
          </p>
        )}
      </div>
    );

    if (isFlag) {
      return {
        group,
        node: (
          <div
            key={spec.name}
            className="flex items-start justify-between p-3 bg-discord-dark-300 rounded gap-3"
          >
            {headerRow}
            <input
              type="checkbox"
              checked={stagedSet}
              onChange={(e) => {
                const next = e.target.checked;
                if (next === live.set) {
                  stageNamedMode(spec.name, null);
                } else {
                  stageNamedMode(spec.name, { sign: next ? "+" : "-" });
                }
              }}
              className="w-4 h-4 mt-1 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
            />
          </div>
        ),
      };
    }

    // Param mode (type 2 or 3). Empty input means "unset"; non-empty
    // means "set to this value".
    return {
      group,
      node: (
        <div
          key={spec.name}
          className="flex flex-col gap-2 p-3 bg-discord-dark-300 rounded"
        >
          {headerRow}
          <div className="flex gap-2">
            <input
              type="text"
              value={stagedParam}
              onChange={(e) => {
                const v = e.target.value;
                if (v === (live.param ?? "")) {
                  stageNamedMode(spec.name, null);
                } else if (!v) {
                  stageNamedMode(spec.name, { sign: "-" });
                } else {
                  stageNamedMode(spec.name, { sign: "+", param: v });
                }
              }}
              placeholder={
                live.set
                  ? "(set, edit to change)"
                  : (placeholder ?? "(not set)")
              }
              className="flex-1 p-2 bg-discord-dark-400 text-white rounded text-sm"
            />
          </div>
        </div>
      ),
    };
  };

  const contentBody = (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto p-6">
        {/* Conditionally render based on active tab */}
        {activeTab !== "general" &&
        activeTab !== "settings" &&
        activeTab !== "advanced" ? (
          <>
            {/* Add new mask */}
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={newMask}
                onChange={(e) => setNewMask(e.target.value)}
                placeholder={
                  activeTab === "b"
                    ? t`Add ban mask (e.g., nick!*@*, *!*@host.com)`
                    : activeTab === "e"
                      ? t`Add exception mask (e.g., nick!*@*, *!*@host.com)`
                      : t`Add invitation mask (e.g., nick!*@*, *!*@host.com)`
                }
                className="flex-1 p-2 bg-discord-dark-300 text-white rounded text-sm"
              />
              <button
                onClick={() =>
                  newMask.trim() && addMode(activeTab, newMask.trim())
                }
                disabled={!newMask.trim() || isAdding}
                className="px-3 py-2 bg-discord-primary hover:bg-opacity-80 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAdding ? (
                  <FaSpinner className="animate-spin" size={14} />
                ) : (
                  <FaPlus size={14} />
                )}
              </button>
            </div>

            {/* Mode list */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="text-center text-discord-text-muted py-8">
                  <Trans>Loading channel modes...</Trans>
                </div>
              ) : filteredModes.length === 0 ? (
                <div className="text-center text-discord-text-muted py-8">
                  {activeTab === "b"
                    ? t`No bans found`
                    : activeTab === "e"
                      ? t`No ban exceptions found`
                      : t`No invitations found`}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredModes.map((mode) => (
                    <div
                      key={`${mode.type}-${mode.mask}`}
                      className="flex items-center justify-between p-3 bg-discord-dark-300 rounded"
                    >
                      <div className="flex-1 min-w-0">
                        {editingMask === mode.mask ? (
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="w-full p-1 bg-discord-dark-400 text-white rounded text-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                saveEdit(mode.mask, editValue);
                              } else if (e.key === "Escape") {
                                e.stopPropagation();
                                cancelEditing();
                              }
                            }}
                          />
                        ) : (
                          <div className="text-white text-sm break-all">
                            {mode.mask}
                            <div className="text-discord-text-muted text-xs mt-1">
                              {mode.setter && t`set by ${mode.setter}`}
                              {mode.setter && mode.timestamp && " • "}
                              {mode.timestamp &&
                                new Date(
                                  mode.timestamp * 1000,
                                ).toLocaleString()}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 ml-2">
                        {editingMask === mode.mask ? (
                          <>
                            <button
                              onClick={() => saveEdit(mode.mask, editValue)}
                              className="text-green-400 hover:text-green-300"
                              title={t`Save`}
                            >
                              ✓
                            </button>
                            <button
                              onClick={cancelEditing}
                              className="text-red-400 hover:text-red-300"
                              title={t`Cancel`}
                            >
                              ✕
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEditing(mode.mask)}
                              className="text-discord-text-muted hover:text-white"
                              title={t`Edit`}
                            >
                              <FaEdit size={14} />
                            </button>
                            <button
                              onClick={() => removeMode(mode.type, mode.mask)}
                              className="text-red-400 hover:text-red-300"
                              title={t`Remove`}
                              disabled={removingMasks.has(mode.mask)}
                            >
                              {removingMasks.has(mode.mask) ? (
                                <FaSpinner className="animate-spin" size={14} />
                              ) : (
                                <FaTrash size={14} />
                              )}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-discord-dark-400">
              <div className="text-xs text-discord-text-muted">
                <Trans>
                  Use wildcards: * matches any sequence, ? matches any single
                  character. Examples: nick!*@*, *!*@host.com, *!*user@*
                </Trans>
              </div>
            </div>
          </>
        ) : activeTab === "general" ? (
          <>
            {/* General tab content */}
            <div className="flex-1 overflow-y-auto space-y-6">
              {/* Channel Topic */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-white">
                  <Trans>Channel Topic</Trans>
                </label>
                <p className="text-xs text-discord-text-muted mb-2">
                  <Trans>
                    The topic that will be displayed for this channel. All users
                    can see the topic.
                  </Trans>
                </p>
                <input
                  type="text"
                  value={channelTopic}
                  onChange={(e) => setChannelTopic(e.target.value)}
                  placeholder={t`Welcome to the channel!`}
                  className="w-full p-2 bg-discord-dark-300 text-white rounded text-sm"
                />
              </div>

              {/* Channel Avatar */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-white">
                  <Trans>Channel Avatar</Trans>
                </label>
                <p className="text-xs text-discord-text-muted mb-2">
                  {server?.filehost
                    ? t`Upload an image or provide a URL with optional {size} substitution for dynamic sizing`
                    : t`URL with optional {size} substitution for dynamic sizing. Example: https://example.com/avatar/{size}/channel.jpg`}
                </p>
                {server?.filehost ? (
                  <AvatarUpload
                    currentAvatarUrl={channelAvatar}
                    onAvatarUrlChange={setChannelAvatar}
                    serverId={serverId}
                    channelName={channelName}
                  />
                ) : (
                  <>
                    <input
                      type="text"
                      value={channelAvatar}
                      onChange={(e) => setChannelAvatar(e.target.value)}
                      placeholder={t`https://example.com/avatar/{size}/channel.jpg`}
                      className="w-full p-2 bg-discord-dark-300 text-white rounded text-sm"
                    />
                    {channelAvatar && isAbsoluteHttpUrl(channelAvatar) && (
                      <div className="mt-2">
                        <p className="text-xs text-discord-text-muted mb-1">
                          <Trans>Preview:</Trans>
                        </p>
                        <img
                          src={channelAvatar.replace("{size}", "64")}
                          alt={t`Channel avatar preview`}
                          className="w-16 h-16 rounded-full object-cover"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Channel Display Name */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-white">
                  <Trans>Channel Display Name</Trans>
                </label>
                <p className="text-xs text-discord-text-muted mb-2">
                  <Trans>
                    Alternative name for display in the UI. May contain spaces,
                    emoji, and special characters. The real channel name (
                    {channelName}) will still be used for IRC commands.
                  </Trans>
                </p>
                <input
                  type="text"
                  value={channelDisplayName}
                  onChange={(e) => setChannelDisplayName(e.target.value)}
                  placeholder={t`General Support Channel`}
                  className="w-full p-2 bg-discord-dark-300 text-white rounded text-sm"
                />
              </div>

              {/* draft/custom-emoji: per-channel pack URL */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-white">
                  Channel Custom Emoji Pack
                </label>
                <p className="text-xs text-discord-text-muted mb-2">
                  URL of an IRCv3 custom-emoji pack JSON document. Shortcodes
                  defined here override the network-wide pack for this channel.
                  Leave blank to use the network default.
                </p>
                <input
                  type="url"
                  value={channelEmojiPack}
                  onChange={(e) => setChannelEmojiPack(e.target.value)}
                  placeholder="https://example.com/emoji/channel/general.json"
                  className="w-full p-2 bg-discord-dark-300 text-white rounded text-sm"
                />
              </div>

              {/* Channel Rename */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-white">
                  <Trans>Channel Name</Trans>
                </label>
                <p className="text-xs text-discord-text-muted mb-2">
                  <Trans>
                    Rename this channel on the server. All users will see the
                    new name.
                  </Trans>
                </p>
                <input
                  type="text"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder={t`#new-channel-name`}
                  className="w-full p-2 bg-discord-dark-300 text-white rounded text-sm"
                />
                <input
                  type="text"
                  value={renameReason}
                  onChange={(e) => setRenameReason(e.target.value)}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={t`Reason (optional)`}
                  className="w-full p-2 bg-discord-dark-300 text-white rounded text-sm"
                />
              </div>

              <div className="pt-4 border-t border-discord-dark-400">
                <p className="text-xs text-discord-text-muted">
                  Note: Channel metadata requires operator (@) or higher
                  permissions to modify. Changes will be visible to all users
                  who support the METADATA specification.
                </p>
              </div>
            </div>
          </>
        ) : activeTab === "settings" ? (
          <>
            {/* Settings tab content */}
            <div className="flex-1 overflow-y-auto space-y-6">
              {/* Client Limit */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-white">
                  <Trans>Client Limit (+l)</Trans>
                </label>
                <p className="text-xs text-discord-text-muted mb-2">
                  <Trans>
                    Maximum number of users allowed in the channel. Leave empty
                    for no limit.
                  </Trans>
                </p>
                <input
                  type="number"
                  value={clientLimit || ""}
                  onChange={(e) =>
                    setClientLimit(
                      e.target.value
                        ? Number.parseInt(e.target.value, 10)
                        : null,
                    )
                  }
                  placeholder={t`No limit`}
                  min="1"
                  className="w-full p-2 bg-discord-dark-300 text-white rounded text-sm"
                />
              </div>

              {/* Invite-Only */}
              <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                <div className="flex-1">
                  <label className="text-sm font-medium text-white">
                    <Trans>Invite-Only (+i)</Trans>
                  </label>
                  <p className="text-xs text-discord-text-muted mt-1">
                    <Trans>Users must be invited to join the channel</Trans>
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={inviteOnly}
                  onChange={(e) => setInviteOnly(e.target.checked)}
                  className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                />
              </div>

              {/* Channel Key */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-white">
                  <Trans>Channel Key (+k)</Trans>
                </label>
                <p className="text-xs text-discord-text-muted mb-2">
                  <Trans>
                    Password required to join the channel. Leave empty to remove
                    the key.
                  </Trans>
                </p>
                <input
                  type="password"
                  value={channelKey}
                  onChange={(e) => setChannelKey(e.target.value)}
                  placeholder={t`No key`}
                  className="w-full p-2 bg-discord-dark-300 text-white rounded text-sm"
                />
              </div>

              {/* Moderated */}
              <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                <div className="flex-1">
                  <label className="text-sm font-medium text-white">
                    <Trans>Moderated (+m)</Trans>
                  </label>
                  <p className="text-xs text-discord-text-muted mt-1">
                    <Trans>Only users with voice or higher can speak</Trans>
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={moderated}
                  onChange={(e) => setModerated(e.target.checked)}
                  className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                />
              </div>

              {/* Secret */}
              <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                <div className="flex-1">
                  <label className="text-sm font-medium text-white">
                    <Trans>Secret (+s)</Trans>
                  </label>
                  <p className="text-xs text-discord-text-muted mt-1">
                    <Trans>
                      Channel won't appear in LIST or NAMES commands
                    </Trans>
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={secret}
                  onChange={(e) => setSecret(e.target.checked)}
                  className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                />
              </div>

              {/* Protected Topic */}
              <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                <div className="flex-1">
                  <label className="text-sm font-medium text-white">
                    <Trans>Protected Topic (+t)</Trans>
                  </label>
                  <p className="text-xs text-discord-text-muted mt-1">
                    <Trans>Only operators can change the channel topic</Trans>
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={protectedTopic}
                  onChange={(e) => setProtectedTopic(e.target.checked)}
                  className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                />
              </div>

              {/* No External Messages */}
              <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                <div className="flex-1">
                  <label className="text-sm font-medium text-white">
                    <Trans>No External Messages (+n)</Trans>
                  </label>
                  <p className="text-xs text-discord-text-muted mt-1">
                    <Trans>
                      Users outside the channel cannot send messages to it
                    </Trans>
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={noExternalMessages}
                  onChange={(e) => setNoExternalMessages(e.target.checked)}
                  className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                />
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Advanced tab content */}
            {server?.namedModes?.supported ? (
              (() => {
                const grouped = new Map<NamedModeGroup, React.ReactNode[]>();
                for (const spec of server.namedModes.channelModes ?? []) {
                  const result = renderNamedModeRow(spec);
                  if (!result) continue;
                  const list = grouped.get(result.group) ?? [];
                  list.push(result.node);
                  grouped.set(result.group, list);
                }
                const sections = NAMED_MODE_GROUP_ORDER.filter(
                  (g) => (grouped.get(g)?.length ?? 0) > 0,
                );
                if (sections.length === 0) {
                  return (
                    <div className="flex-1 overflow-y-auto">
                      <p className="text-sm text-discord-text-muted italic">
                        No advanced modes are advertised by this server.
                      </p>
                    </div>
                  );
                }
                return (
                  <div className="flex-1 overflow-y-auto space-y-6">
                    {sections.map((g) => (
                      <div key={g} className="space-y-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-discord-text-muted">
                          {NAMED_MODE_GROUP_LABELS[g]}
                        </h3>
                        <div className="space-y-2">{grouped.get(g)}</div>
                      </div>
                    ))}
                  </div>
                );
              })()
            ) : (
              <div className="flex-1 overflow-y-auto space-y-6">
                {/* Flood Protection Settings */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-white">
                      Flood Protection (+f)
                    </label>
                    <p className="text-xs text-discord-text-muted mb-2">
                      Configure flood protection rules to prevent spam and
                      abuse. UnrealIRCd-specific feature.
                    </p>
                  </div>

                  {/* Flood Profile Selection */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-discord-text-muted uppercase tracking-wide">
                      Flood Profile (+F)
                    </label>
                    <select
                      value={floodProfile}
                      onChange={(e) => setFloodProfile(e.target.value)}
                      className="w-full p-2 bg-discord-dark-300 text-white rounded text-sm"
                    >
                      <option value="">
                        <Trans>No flood profile</Trans>
                      </option>
                      <option value="very-strict">
                        <Trans>Very Strict</Trans>
                      </option>
                      <option value="strict">
                        <Trans>Strict</Trans>
                      </option>
                      <option value="normal">
                        <Trans>Normal</Trans>
                      </option>
                      <option value="relaxed">
                        <Trans>Relaxed</Trans>
                      </option>
                      <option value="very-relaxed">
                        <Trans>Very Relaxed</Trans>
                      </option>
                    </select>
                  </div>

                  {/* Flood Parameters */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-discord-text-muted uppercase tracking-wide">
                      Flood Parameters
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={floodParams}
                        onChange={(e) => setFloodParams(e.target.value)}
                        placeholder={t`Default`}
                        className="flex-1 p-2 bg-discord-dark-300 text-white rounded text-sm"
                      />
                      <button
                        onClick={() => setIsFloodModalOpen(true)}
                        className="px-3 py-2 bg-discord-primary hover:bg-opacity-80 text-white rounded text-sm font-medium"
                      >
                        Configure
                      </button>
                    </div>
                    <p className="text-xs text-discord-text-muted">
                      Use the Configure button for detailed flood rule
                      management, or enter parameters manually in the format:
                      [rules]:seconds
                    </p>
                  </div>
                </div>

                {/* Content Filtering */}
                <div className="space-y-4">
                  <h3 className="text-sm font-medium text-white">
                    Content Filtering
                  </h3>

                  {/* Block Color Codes */}
                  <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-white">
                        Block Color Codes (+c)
                      </label>
                      <p className="text-xs text-discord-text-muted mt-1">
                        Block messages containing mIRC color codes
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={blockColorCodes}
                      onChange={(e) => setBlockColorCodes(e.target.checked)}
                      className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                    />
                  </div>

                  {/* No CTCPs */}
                  <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-white">
                        No CTCPs (+C)
                      </label>
                      <p className="text-xs text-discord-text-muted mt-1">
                        Block CTCP commands in the channel
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={noCTCPs}
                      onChange={(e) => setNoCTCPs(e.target.checked)}
                      className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                    />
                  </div>

                  {/* Filter Bad Words */}
                  <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-white">
                        Filter Bad Words (+G)
                      </label>
                      <p className="text-xs text-discord-text-muted mt-1">
                        Filter out bad words with &lt;censored&gt;
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={filterBadWords}
                      onChange={(e) => setFilterBadWords(e.target.checked)}
                      className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                    />
                  </div>

                  {/* Strip Color Codes */}
                  <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-white">
                        Strip Color Codes (+S)
                      </label>
                      <p className="text-xs text-discord-text-muted mt-1">
                        Strip mIRC color codes from messages
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={stripColorCodes}
                      onChange={(e) => setStripColorCodes(e.target.checked)}
                      className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                    />
                  </div>
                </div>

                {/* Channel Behavior */}
                <div className="space-y-4">
                  <h3 className="text-sm font-medium text-white">
                    Channel Behavior
                  </h3>

                  {/* Delay Joins */}
                  <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-white">
                        Delay Joins (+D)
                      </label>
                      <p className="text-xs text-discord-text-muted mt-1">
                        Delay showing joins until someone speaks
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={delayJoins}
                      onChange={(e) => setDelayJoins(e.target.checked)}
                      className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                    />
                  </div>

                  {/* No Knocks */}
                  <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-white">
                        No Knocks (+K)
                      </label>
                      <p className="text-xs text-discord-text-muted mt-1">
                        /KNOCK command is not allowed
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={noKnocks}
                      onChange={(e) => setNoKnocks(e.target.checked)}
                      className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                    />
                  </div>

                  {/* No Nick Changes */}
                  <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-white">
                        No Nick Changes (+N)
                      </label>
                      <p className="text-xs text-discord-text-muted mt-1">
                        Nickname changes are not permitted
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={noNickChanges}
                      onChange={(e) => setNoNickChanges(e.target.checked)}
                      className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                    />
                  </div>

                  {/* No Kicks */}
                  <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-white">
                        No Kicks (+Q)
                      </label>
                      <p className="text-xs text-discord-text-muted mt-1">
                        Kick commands are not allowed
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={noKicks}
                      onChange={(e) => setNoKicks(e.target.checked)}
                      className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                    />
                  </div>

                  {/* No Notices */}
                  <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-white">
                        No Notices (+T)
                      </label>
                      <p className="text-xs text-discord-text-muted mt-1">
                        NOTICE commands are not allowed
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={noNotices}
                      onChange={(e) => setNoNotices(e.target.checked)}
                      className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                    />
                  </div>

                  {/* No Invites */}
                  <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-white">
                        No Invites (+V)
                      </label>
                      <p className="text-xs text-discord-text-muted mt-1">
                        /INVITE command is not allowed
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={noInvites}
                      onChange={(e) => setNoInvites(e.target.checked)}
                      className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                    />
                  </div>
                </div>

                {/* Access Control */}
                <div className="space-y-4">
                  <h3 className="text-sm font-medium text-white">
                    Access Control
                  </h3>

                  {/* Registered Nick Required */}
                  <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-white">
                        Registered Nick Required (+M)
                      </label>
                      <p className="text-xs text-discord-text-muted mt-1">
                        Users must have a registered nickname (+r) to talk
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={registeredNickRequired}
                      onChange={(e) =>
                        setRegisteredNickRequired(e.target.checked)
                      }
                      className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                    />
                  </div>

                  {/* Registered Users Only */}
                  <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-white">
                        Registered Users Only (+R)
                      </label>
                      <p className="text-xs text-discord-text-muted mt-1">
                        Only registered users (+r) may join
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={registeredUsersOnly}
                      onChange={(e) => setRegisteredUsersOnly(e.target.checked)}
                      className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                    />
                  </div>

                  {/* IRC Operator Only */}
                  <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-white">
                        IRC Operator Only (+O)
                      </label>
                      <p className="text-xs text-discord-text-muted mt-1">
                        Only IRC operators can join (settable by IRCops)
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={ircOperatorOnly}
                      onChange={(e) => setIrcOperatorOnly(e.target.checked)}
                      className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                    />
                  </div>

                  {/* Secure Connection Required */}
                  <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-white">
                        Secure Connection Required (+z)
                      </label>
                      <p className="text-xs text-discord-text-muted mt-1">
                        Only clients on secure connections (SSL/TLS) can join
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={secureConnectionRequired}
                      onChange={(e) =>
                        setSecureConnectionRequired(e.target.checked)
                      }
                      className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                    />
                  </div>
                </div>

                {/* Channel Properties */}
                <div className="space-y-4">
                  <h3 className="text-sm font-medium text-white">
                    Channel Properties
                  </h3>

                  {/* Private Channel */}
                  <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-white">
                        Private Channel (+p)
                      </label>
                      <p className="text-xs text-discord-text-muted mt-1">
                        Channel is marked as private
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={privateChannel}
                      onChange={(e) => setPrivateChannel(e.target.checked)}
                      className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                    />
                  </div>

                  {/* Permanent Channel */}
                  <div className="flex items-center justify-between p-3 bg-discord-dark-300 rounded">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-white">
                        Permanent Channel (+P)
                      </label>
                      <p className="text-xs text-discord-text-muted mt-1">
                        Channel won't be destroyed when empty (settable by
                        IRCops)
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={permanentChannel}
                      onChange={(e) => setPermanentChannel(e.target.checked)}
                      className="w-4 h-4 text-discord-primary bg-discord-dark-300 border-discord-dark-500 rounded focus:ring-discord-primary"
                    />
                  </div>

                  {/* Channel History */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-white">
                      Channel History (+H)
                    </label>
                    <p className="text-xs text-discord-text-muted mb-2">
                      Record channel history with max-lines:max-minutes. Leave
                      empty to disable.
                    </p>
                    <input
                      type="text"
                      value={channelHistory}
                      onChange={(e) => setChannelHistory(e.target.value)}
                      placeholder={t`e.g., 100:1440`}
                      className="w-full p-2 bg-discord-dark-300 text-white rounded text-sm"
                    />
                  </div>

                  {/* Channel Link */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-white">
                      Channel Link (+L)
                    </label>
                    <p className="text-xs text-discord-text-muted mb-2">
                      Forward users to this channel if they can't join. Leave
                      empty to disable.
                    </p>
                    <input
                      type="text"
                      value={channelLink}
                      onChange={(e) => setChannelLink(e.target.value)}
                      placeholder={t`#overflow`}
                      className="w-full p-2 bg-discord-dark-300 text-white rounded text-sm"
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Apply buttons at bottom */}
      <div className="flex-shrink-0 p-6 border-t border-discord-dark-500 bg-discord-dark-200">
        <div className="flex justify-end">
          {activeTab === "general" && (
            <button
              onClick={applyGeneralChanges}
              disabled={isApplyingChanges}
              className="px-6 py-2 bg-discord-primary hover:bg-opacity-80 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              {isApplyingChanges ? (
                <span className="flex items-center gap-2">
                  <FaSpinner className="animate-spin" size={14} />
                  <Trans>Applying...</Trans>
                </span>
              ) : (
                <Trans>Apply</Trans>
              )}
            </button>
          )}
          {activeTab === "settings" && (
            <button
              onClick={applySettingsChanges}
              disabled={isApplyingChanges}
              className="px-6 py-2 bg-discord-primary hover:bg-opacity-80 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              {isApplyingChanges ? (
                <span className="flex items-center gap-2">
                  <FaSpinner className="animate-spin" size={14} />
                  <Trans>Applying...</Trans>
                </span>
              ) : (
                <Trans>Apply</Trans>
              )}
            </button>
          )}
          {activeTab === "advanced" && (
            <button
              onClick={
                server?.namedModes?.supported
                  ? applyNamedModesAdvancedChanges
                  : applyAdvancedChanges
              }
              disabled={isApplyingChanges}
              className="px-6 py-2 bg-discord-primary hover:bg-opacity-80 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              {isApplyingChanges ? (
                <span className="flex items-center gap-2">
                  <FaSpinner className="animate-spin" size={14} />
                  <Trans>Applying...</Trans>
                </span>
              ) : (
                <Trans>Apply</Trans>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const floodModal = (
    <FloodSettingsModal
      isOpen={isFloodModalOpen}
      onClose={() => setIsFloodModalOpen(false)}
      onSave={handleFloodSettingsSave}
      initialFloodProfile={floodProfile}
      initialFloodParams={floodParams}
    />
  );

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
            <div className="flex items-center justify-between p-4 border-b border-discord-dark-500 flex-shrink-0">
              <h2 className="text-white text-lg font-semibold">
                Channel Settings
              </h2>
              <button
                onClick={onClose}
                className="p-1 rounded-lg hover:bg-discord-dark-400 text-discord-text-muted hover:text-white"
                aria-label={t`Close`}
              >
                <FaTimes />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {categories.map((category) => {
                const Icon = category.icon;
                return (
                  <button
                    key={category.id}
                    onClick={() => {
                      setActiveTab(category.id);
                      setMobileView("content");
                    }}
                    className="w-full flex items-center gap-4 px-4 py-4 border-b border-discord-dark-400 hover:bg-discord-dark-300 text-left transition-colors"
                  >
                    <Icon className="text-discord-text-muted text-lg flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-white font-medium">
                        {category.name}
                      </div>
                      {category.count > 0 && (
                        <div className="text-discord-text-muted text-sm">
                          {category.count} entries
                        </div>
                      )}
                    </div>
                    <FaChevronRight className="text-discord-text-muted flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
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
                  {categories.find((c) => c.id === activeTab)?.name}
                </h2>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-lg hover:bg-discord-dark-400 text-discord-text-muted hover:text-white"
                aria-label={t`Close`}
              >
                <FaTimes />
              </button>
            </div>
            {contentBody}
          </>
        )}
        {floodModal}
      </div>,
      portalTarget,
    );
  }

  return createPortal(
    <div
      {...getBackdropProps()}
      className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50"
    >
      <div
        {...getContentProps()}
        className="bg-discord-dark-200 rounded-lg w-full max-w-4xl h-[80vh] flex overflow-hidden"
      >
        {/* Sidebar */}
        <div className="bg-discord-dark-300 flex flex-col">
          <div className="p-4 border-b border-discord-dark-500 flex justify-center">
            <h2 className="text-white text-lg font-bold">
              <Trans>Channel Settings</Trans>
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            <nav className="p-2">
              {categories.map((category) => {
                const Icon = category.icon;
                return (
                  <button
                    key={category.id}
                    onClick={() => setActiveTab(category.id)}
                    className={`flex items-center w-full px-3 text-left py-2 mb-1 rounded transition-colors overflow-hidden min-w-0 ${
                      activeTab === category.id
                        ? "bg-discord-primary text-white"
                        : "text-discord-text-muted hover:text-white hover:bg-discord-dark-400"
                    }`}
                  >
                    <Icon className="mr-3 text-sm" />
                    <span className="flex items-center justify-between flex-1">
                      <span>{category.name}</span>
                      {category.count > 0 && (
                        <span className="bg-discord-primary text-white text-xs px-2 py-0.5 rounded-full ml-2">
                          {category.count}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col">
          <div className="flex justify-between items-center p-4 border-b border-discord-dark-500 flex-shrink-0">
            <h3 className="text-white text-lg font-semibold">
              {categories.find((c) => c.id === activeTab)?.name}
            </h3>
            <button
              onClick={onClose}
              className="text-discord-text-muted hover:text-white"
            >
              <FaTimes />
            </button>
          </div>
          {contentBody}
        </div>
      </div>
      {floodModal}
    </div>,
    document.body,
  );
};

export default ChannelSettingsModal;
