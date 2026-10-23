import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FaCheck,
  FaEdit,
  FaPlus,
  FaSpinner,
  FaTimes,
  FaTrash,
} from "react-icons/fa";
import ircClient from "../../lib/ircClient";
import {
  hasOpPermission,
  humanizeNamedMode,
  isAbsoluteHttpUrl,
} from "../../lib/ircUtils";
import { Button } from "../../lib/modal/components";
import {
  lookupNamedModeMeta,
  NAMED_MODE_GROUP_LABELS,
  NAMED_MODE_GROUP_ORDER,
  type NamedModeGroup,
} from "../../lib/namedModeRegistry";
import useStore from "../../store";
import type { Channel, NamedModeSpec } from "../../types";
import AvatarUpload from "../ui/AvatarUpload";
import FloodSettingsModal from "../ui/FloodSettingsModal";
import { PageShell } from "../ui/page/PageShell";
import { SettingGroup, SettingRow, Switch } from "../ui/page/SettingRow";
import type { PageProps } from "./PageHost";
import {
  getChannelSettingsAccess,
  getChannelSettingsSections,
} from "./pageSections";

interface FloodRule {
  amount: number;
  type: "c" | "j" | "k" | "m" | "n" | "t" | "r";
  action?: string;
  time?: number;
}

interface ChannelMode {
  type: "b" | "e" | "I";
  mask: string;
  setter?: string;
  timestamp?: number;
}

type ListSection = "bans" | "exceptions" | "invites";
type ParsedModes = Record<string, string | null>;
type ModeEdit = { sign: "+" | "-"; letter: string; arg?: string };

const LIST_TYPE: Record<ListSection, ChannelMode["type"]> = {
  bans: "b",
  exceptions: "e",
  invites: "I",
};

// The server hides the +k, +H and +L arguments from non-operators, so we use a placeholder that never reads as an empty value.
const HIDDEN_PARAM = "__HIDDEN__";
const FLAG_LETTERS = [
  "i",
  "m",
  "s",
  "t",
  "n",
  "c",
  "C",
  "D",
  "G",
  "K",
  "M",
  "N",
  "O",
  "p",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "V",
  "z",
];
const VALUE_LETTERS = ["l", "k", "H", "L", "F", "f"];
const UNSET_NEEDS_ARG = new Set(["k", "H", "L", "F", "f"]);
// We send advanced modes in a fixed order, so the MODE line stays the same every time.
const ADVANCED_MODE_ORDER = [
  "c",
  "C",
  "D",
  "G",
  "H",
  "K",
  "L",
  "M",
  "N",
  "O",
  "p",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "V",
  "z",
  "F",
  "f",
];

const isListSection = (id: string): id is ListSection => id in LIST_TYPE;

function flagEdit(
  letter: string,
  wanted: boolean,
  original: ParsedModes,
): ModeEdit | null {
  const isSet = letter in original;
  if (wanted === isSet) return null;
  return { sign: wanted ? "+" : "-", letter };
}

function valueEdit(
  letter: string,
  wanted: string,
  original: ParsedModes,
): ModeEdit | null {
  if (wanted) {
    return wanted === original[letter]
      ? null
      : { sign: "+", letter, arg: wanted };
  }
  if (!(letter in original) || original[letter] === HIDDEN_PARAM) return null;
  return {
    sign: "-",
    letter,
    arg: UNSET_NEEDS_ARG.has(letter) ? "*" : undefined,
  };
}

function buildModeCommand(
  channelName: string,
  edits: Array<ModeEdit | null>,
): string | null {
  const present = edits.filter((e): e is ModeEdit => e !== null);
  if (present.length === 0) return null;
  const sets = present.filter((e) => e.sign === "+");
  const unsets = present.filter((e) => e.sign === "-");
  const letters = [
    sets.length ? `+${sets.map((e) => e.letter).join("")}` : "",
    unsets.length ? `-${unsets.map((e) => e.letter).join("")}` : "",
  ].join("");
  const args = [...sets, ...unsets].flatMap((e) => (e.arg ? [e.arg] : []));
  return ["MODE", channelName, letters, ...args].join(" ");
}

function parseCurrentChannelModes(
  modestring: string,
  modeargs: string[],
  chanmodes?: string,
): ParsedModes {
  const modeGroups = chanmodes ? chanmodes.split(",") : [];
  const groupA = modeGroups[0] || "";
  const groupB = modeGroups[1] || "";
  const groupC = modeGroups[2] || "";

  const parsedModes: ParsedModes = {};
  let argIndex = 0;
  let currentAction: "+" | "-" = "+";

  for (const char of modestring) {
    if (char === "+" || char === "-") {
      currentAction = char;
      continue;
    }

    let hasParam = false;
    if (groupA.includes(char) || groupB.includes(char)) {
      hasParam = true;
    } else if (groupC.includes(char)) {
      hasParam = currentAction === "+";
    }

    let param =
      hasParam && argIndex < modeargs.length ? modeargs[argIndex++] : null;
    if ((char === "k" || char === "H" || char === "L") && param === null) {
      param = HIDDEN_PARAM;
    }

    if (currentAction === "+") {
      parsedModes[char] = param;
    } else {
      delete parsedModes[char];
    }
  }

  return parsedModes;
}

const displayValue = (parsed: ParsedModes, letter: string): string => {
  const stored = parsed[letter];
  return stored === undefined || stored === null || stored === HIDDEN_PARAM
    ? ""
    : stored;
};

const FlagRow: React.FC<{
  letter: string;
  title: string;
  description: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}> = ({ letter, title, description, checked, onChange }) => (
  <SettingRow
    id={`channel.${letter}`}
    title={title}
    description={description}
    control={<Switch checked={checked} onChange={onChange} label={title} />}
  />
);

const EmptyRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-4 py-3 text-sm text-discord-text-muted">{children}</div>
);

const AUTOSAVE_DELAY_MS = 400;

const ChannelSettingsPage: React.FC<PageProps<"channelSettings">> = ({
  page,
}) => {
  const { serverId } = page;
  const servers = useStore((state) => state.servers);
  const metadataSet = useStore((state) => state.metadataSet);
  const server = servers.find((s) => s.id === serverId);
  const channel = server?.channels.find(
    (c) => c.name.toLowerCase() === page.channelName.toLowerCase(),
  );
  const channelName = channel?.name ?? page.channelName;

  const [modes, setModes] = useState<ChannelMode[]>([]);
  const [loading, setLoading] = useState(false);
  const originalModesRef = useRef<ParsedModes>({});
  // Changes apply on their own: a text field when it loses focus, a switch or
  // a named mode as soon as it changes.
  const applyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleApplyRef = useRef<() => void>(() => {});
  const pendingApplyRef = useRef<(() => Promise<void>) | null>(null);
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

  const [sectionId, setSectionId] = useState(page.section ?? "general");
  useEffect(() => {
    setSectionId(page.section ?? "general");
  }, [page.section]);

  const [newMask, setNewMask] = useState("");
  const [editingMask, setEditingMask] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [removingMasks, setRemovingMasks] = useState(new Set<string>());

  const [channelAvatar, setChannelAvatar] = useState("");
  const [channelDisplayName, setChannelDisplayName] = useState("");
  const [channelTopic, setChannelTopic] = useState("");
  // We store the pack URL under the draft/emoji channel metadata key, as the spec requires.
  const [channelEmojiPack, setChannelEmojiPack] = useState("");
  const [newChannelName, setNewChannelName] = useState("");
  const [renameReason, setRenameReason] = useState("");
  const [isApplyingChanges, setIsApplyingChanges] = useState(false);

  const [pendingNamedModes, setPendingNamedModes] = useState<
    Record<string, { sign: "+" | "-"; param?: string }>
  >({});

  const [isFloodModalOpen, setIsFloodModalOpen] = useState(false);

  const [flags, setFlags] = useState<Record<string, boolean>>({});
  // biome-ignore lint/correctness/useExhaustiveDependencies: a switch or named mode change is the trigger; text waits for its blur
  useEffect(() => scheduleApplyRef.current(), [flags, pendingNamedModes]);
  useEffect(
    () => () => {
      if (!applyTimerRef.current) return;
      clearTimeout(applyTimerRef.current);
      void pendingApplyRef.current?.();
    },
    [],
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const flag = (letter: string) => flags[letter] === true;
  const value = (letter: string) => values[letter] ?? "";
  const setFlag = (letter: string, on: boolean) =>
    setFlags((prev) => ({ ...prev, [letter]: on }));
  const setValue = (letter: string, next: string) =>
    setValues((prev) => ({ ...prev, [letter]: next }));

  const currentUser = ircClient.getCurrentUser(serverId);
  const currentUserInChannel = channel?.users.find(
    (u) => u.username === currentUser?.username,
  );
  const userHasOpPermission = hasOpPermission(currentUserInChannel?.status);
  const { canEditMetadata, canEditAdvanced } =
    server && channel
      ? getChannelSettingsAccess(server, channel)
      : { canEditMetadata: false, canEditAdvanced: false };

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
    const parsedModes: ChannelMode[] = [
      ...(currentChannel.bans ?? []).map((ban) => ({
        type: "b" as const,
        mask: ban.mask,
        setter: ban.setter,
        timestamp: ban.timestamp,
      })),
      ...(currentChannel.exceptions ?? []).map((exception) => ({
        type: "e" as const,
        mask: exception.mask,
        setter: exception.setter,
        timestamp: exception.timestamp,
      })),
      ...(currentChannel.invites ?? []).map((invite) => ({
        type: "I" as const,
        mask: invite.mask,
        setter: invite.setter,
        timestamp: invite.timestamp,
      })),
    ];
    setModes(parsedModes);
  }, []);

  const loadCurrentChannelModes = useCallback(
    (resetOriginal = false) => {
      const currentServer = useStore
        .getState()
        .servers.find((s) => s.id === serverId);
      const currentChannel = currentServer?.channels.find(
        (c) => c.name === channelName,
      );
      if (!currentChannel) return;

      const parsedModes = parseCurrentChannelModes(
        currentChannel.modes || "",
        currentChannel.modeArgs || [],
        currentServer?.chanmodes,
      );
      if (resetOriginal) originalModesRef.current = parsedModes;

      setFlags(
        Object.fromEntries(
          FLAG_LETTERS.map((letter) => [letter, letter in parsedModes]),
        ),
      );
      setValues(
        Object.fromEntries(
          VALUE_LETTERS.map((letter) => [
            letter,
            displayValue(parsedModes, letter),
          ]),
        ),
      );
    },
    [serverId, channelName],
  );

  const refreshLists = useCallback(() => {
    clearLists();
    void Promise.all([
      ircClient.sendRaw(serverId, `MODE ${channelName} +b`),
      ircClient.sendRaw(serverId, `MODE ${channelName} +e`),
      ircClient.sendRaw(serverId, `MODE ${channelName} +I`),
    ]).catch((error) => {
      console.error("Failed to refresh channel mode lists:", error);
    });
  }, [serverId, channelName, clearLists]);

  const syncFromChannel = useCallback(() => {
    const updatedChannel = useStore
      .getState()
      .servers.find((s) => s.id === serverId)
      ?.channels.find((c) => c.name === channelName);
    if (updatedChannel) {
      parseChannelModes(updatedChannel);
      loadCurrentChannelModes(true);
    }
  }, [serverId, channelName, parseChannelModes, loadCurrentChannelModes]);

  const fetchChannelModes = useCallback(async () => {
    setLoading(true);
    try {
      clearLists();
      await ircClient.sendRaw(serverId, `MODE ${channelName}`);
      await ircClient.sendRaw(serverId, `MODE ${channelName} +b`);
      await ircClient.sendRaw(serverId, `MODE ${channelName} +e`);
      await ircClient.sendRaw(serverId, `MODE ${channelName} +I`);

      addTimeout(() => {
        syncFromChannel();
        setLoading(false);
      }, 1000);
    } catch (error) {
      console.error("Failed to fetch channel modes:", error);
      setLoading(false);
    }
  }, [serverId, channelName, clearLists, syncFromChannel, addTimeout]);

  const addMode = async (type: ChannelMode["type"], mask: string) => {
    setIsAdding(true);
    try {
      await ircClient.sendRaw(serverId, `MODE ${channelName} +${type} ${mask}`);
      setNewMask("");
      addTimeout(() => {
        refreshLists();
        addTimeout(() => {
          syncFromChannel();
          setIsAdding(false);
        }, 1000);
      }, 500);
    } catch (error) {
      console.error(`Failed to add ${type} mode:`, error);
      setIsAdding(false);
    }
  };

  const removeMode = async (type: ChannelMode["type"], mask: string) => {
    setRemovingMasks((prev) => new Set(prev).add(mask));
    const stopRemoving = () =>
      setRemovingMasks((prev) => {
        const newSet = new Set(prev);
        newSet.delete(mask);
        return newSet;
      });
    try {
      await ircClient.sendRaw(serverId, `MODE ${channelName} -${type} ${mask}`);
      addTimeout(() => {
        refreshLists();
        addTimeout(() => {
          syncFromChannel();
          stopRemoving();
        }, 1000);
      }, 500);
    } catch (error) {
      console.error(`Failed to remove ${type} mode:`, error);
      stopRemoving();
    }
  };

  const cancelEditing = () => {
    setEditingMask(null);
    setEditValue("");
  };

  const saveEdit = async (
    type: ChannelMode["type"],
    oldMask: string,
    newMask: string,
  ) => {
    if (oldMask === newMask) {
      cancelEditing();
      return;
    }

    try {
      await ircClient.sendRaw(
        serverId,
        `MODE ${channelName} -${type} ${oldMask}`,
      );
      await ircClient.sendRaw(
        serverId,
        `MODE ${channelName} +${type} ${newMask}`,
      );
      cancelEditing();
      addTimeout(() => {
        refreshLists();
        addTimeout(syncFromChannel, 1000);
      }, 500);
    } catch (error) {
      console.error(`Failed to edit ${type} mode:`, error);
    }
  };

  const applyGeneralChanges = async () => {
    setIsApplyingChanges(true);
    try {
      if (channelTopic !== (channel?.topic || "")) {
        ircClient.setTopic(serverId, channelName, channelTopic);
      }

      if (channelAvatar !== (channel?.metadata?.avatar?.value || "")) {
        await metadataSet(
          serverId,
          channelName,
          "avatar",
          channelAvatar || undefined,
        );
      }

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

  const sendModeEdits = async (edits: Array<ModeEdit | null>) => {
    const command = buildModeCommand(channelName, edits);
    if (!command) return;
    await ircClient.sendRaw(serverId, command);
    // We record what we sent as the new baseline, so the next autosave does
    // not resend a change while the server's echo is still on its way.
    const next = { ...originalModesRef.current };
    for (const edit of edits) {
      if (!edit) continue;
      if (edit.sign === "+") next[edit.letter] = edit.arg ?? null;
      else delete next[edit.letter];
    }
    originalModesRef.current = next;
  };

  const applySettingsChanges = async () => {
    setIsApplyingChanges(true);
    try {
      const original = originalModesRef.current;
      await sendModeEdits([
        valueEdit("l", value("l").trim(), original),
        flagEdit("i", flag("i"), original),
        valueEdit("k", value("k").trim(), original),
        flagEdit("m", flag("m"), original),
        flagEdit("s", flag("s"), original),
        flagEdit("t", flag("t"), original),
        flagEdit("n", flag("n"), original),
      ]);
    } finally {
      setIsApplyingChanges(false);
    }
  };

  const applyAdvancedChanges = async () => {
    setIsApplyingChanges(true);
    try {
      const original = originalModesRef.current;
      await sendModeEdits(
        ADVANCED_MODE_ORDER.map((letter) => {
          if (VALUE_LETTERS.includes(letter)) {
            const wanted = value(letter).trim();
            return valueEdit(
              letter,
              letter === "f" && wanted === "Default" ? "" : wanted,
              original,
            );
          }
          return flagEdit(letter, flag(letter), original);
        }),
      );
    } finally {
      setIsApplyingChanges(false);
    }
  };

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

  useEffect(() => () => clearPendingTimeouts(), [clearPendingTimeouts]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Using channelName instead of channel to avoid infinite loop from object reference changes
  useEffect(() => {
    if (channel) {
      setModes([]);
      fetchChannelModes();
    }
  }, [channelName, fetchChannelModes]);

  useEffect(() => {
    if (!channel) return;
    setChannelAvatar(channel.metadata?.avatar?.value || "");
    setChannelDisplayName(channel.metadata?.["display-name"]?.value || "");
    setChannelEmojiPack(channel.metadata?.["draft/emoji"]?.value || "");
    setChannelTopic(channel.topic || "");
    setNewChannelName(channel.name);
    setRenameReason("");
    loadCurrentChannelModes(true);
  }, [channel, loadCurrentChannelModes]);

  if (!channel) {
    return (
      <PageShell title={page.channelName}>
        <p className="text-sm text-discord-text-muted">
          <Trans>You are no longer in this channel</Trans>
        </p>
      </PageShell>
    );
  }

  const sections = getChannelSettingsSections({
    canEditMetadata,
    canEditAdvanced,
  });
  const activeId = sections.some((s) => s.id === sectionId)
    ? sectionId
    : "bans";

  const handleFloodSettingsSave = (
    newFloodProfile: string,
    floodRules: Array<FloodRule & { id: string }>,
    seconds: number,
  ) => {
    setValue("F", newFloodProfile);
    const rulesString = floodRules
      .map(
        (rule) =>
          `${rule.amount}${rule.type}${rule.action ? `#${rule.action}` : ""}${rule.time ? `:${rule.time}` : ""}`,
      )
      .join(",");
    setValue("f", rulesString ? `[${rulesString}]:${seconds}` : "Default");
    setIsFloodModalOpen(false);
  };

  const generalSection = (
    <>
      <SettingGroup>
        <SettingRow
          id="channel.topic"
          title={t`Topic`}
          description={t`Set the topic shown for this channel. Everyone can see it.`}
        >
          <input
            type="text"
            value={channelTopic}
            onChange={(e) => setChannelTopic(e.target.value)}
            placeholder={t`Welcome to the channel!`}
            className="field-input w-full"
          />
        </SettingRow>
        <SettingRow
          id="channel.avatar"
          title={t`Avatar`}
          description={
            server?.filehost
              ? t`Upload an image or enter a URL. Use {size} in the URL for dynamic sizing.`
              : t`Enter a URL. Use {size} in the URL for dynamic sizing. Example: https://example.com/avatar/{size}/channel.jpg`
          }
        >
          {server?.filehost ? (
            <AvatarUpload
              currentAvatarUrl={channelAvatar}
              onAvatarUrlChange={setChannelAvatar}
              serverId={serverId}
              channelName={channelName}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <input
                type="text"
                value={channelAvatar}
                onChange={(e) => setChannelAvatar(e.target.value)}
                placeholder={t`https://example.com/avatar/{size}/channel.jpg`}
                className="field-input w-full"
              />
              {channelAvatar && isAbsoluteHttpUrl(channelAvatar) && (
                <img
                  src={channelAvatar.replace("{size}", "64")}
                  alt={t`Channel avatar preview`}
                  className="w-16 h-16 rounded-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              )}
            </div>
          )}
        </SettingRow>
        <SettingRow
          id="channel.display-name"
          title={t`Display name`}
          description={t`Enter a name with any spaces, emoji, or symbols. IRC commands still use the real name (${channelName}).`}
        >
          <input
            type="text"
            value={channelDisplayName}
            onChange={(e) => setChannelDisplayName(e.target.value)}
            placeholder={t`General Support Channel`}
            className="field-input w-full"
          />
        </SettingRow>
        <SettingRow
          id="channel.draft/emoji"
          title={t`Custom emoji pack`}
          description={t`Enter the URL of an IRCv3 custom-emoji pack JSON document. Its shortcodes override the network pack in this channel. Leave blank for the network default.`}
        >
          <input
            type="url"
            value={channelEmojiPack}
            onChange={(e) => setChannelEmojiPack(e.target.value)}
            placeholder="https://example.com/emoji/channel/general.json"
            className="field-input w-full"
          />
        </SettingRow>
      </SettingGroup>
      <SettingGroup>
        <SettingRow
          id="channel.name"
          title={t`Channel name`}
          description={t`Rename this channel. Everyone sees the new name.`}
        >
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t`#new-channel-name`}
              className="field-input w-full"
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
              className="field-input w-full"
            />
          </div>
        </SettingRow>
      </SettingGroup>
      <p className="text-xs text-discord-text-muted px-1">
        <Trans>
          Note: Channel metadata requires operator (@) or higher permissions to
          modify. Changes will be visible to all users who support the METADATA
          specification.
        </Trans>
      </p>
    </>
  );

  const settingsSection = (
    <>
      <SettingGroup>
        <SettingRow
          id="channel.l"
          title={t`Client limit (+l)`}
          description={t`Set the maximum number of users. Leave empty for no limit.`}
        >
          <input
            type="number"
            value={value("l")}
            onChange={(e) => setValue("l", e.target.value)}
            placeholder={t`No limit`}
            min="1"
            className="field-input w-full"
          />
        </SettingRow>
        <FlagRow
          letter="i"
          title={t`Invite-only (+i)`}
          description={t`Require an invite to join.`}
          checked={flag("i")}
          onChange={(on) => setFlag("i", on)}
        />
        <SettingRow
          id="channel.k"
          title={t`Channel key (+k)`}
          description={t`Set the password needed to join. Leave empty to remove the key.`}
        >
          <input
            type="password"
            value={value("k")}
            onChange={(e) => setValue("k", e.target.value)}
            placeholder={t`No key`}
            className="field-input w-full"
          />
        </SettingRow>
        <FlagRow
          letter="m"
          title={t`Moderated (+m)`}
          description={t`Let only users with voice or higher speak.`}
          checked={flag("m")}
          onChange={(on) => setFlag("m", on)}
        />
        <FlagRow
          letter="s"
          title={t`Secret (+s)`}
          description={t`Hide the channel from LIST and NAMES.`}
          checked={flag("s")}
          onChange={(on) => setFlag("s", on)}
        />
        <FlagRow
          letter="t"
          title={t`Protected topic (+t)`}
          description={t`Let only operators change the topic.`}
          checked={flag("t")}
          onChange={(on) => setFlag("t", on)}
        />
        <FlagRow
          letter="n"
          title={t`No external messages (+n)`}
          description={t`Block messages from users outside the channel.`}
          checked={flag("n")}
          onChange={(on) => setFlag("n", on)}
        />
      </SettingGroup>
    </>
  );

  const namedModeRow = (spec: NamedModeSpec) => {
    if (spec.type === 1 || spec.type === 5) return null;
    const meta = lookupNamedModeMeta(spec.name);
    if (meta?.hidden) return null;

    const fallback = humanizeNamedMode(spec.name);
    const label = meta?.label ?? fallback.display;
    const description = meta?.description ?? "";
    const group: NamedModeGroup = meta?.group ?? "properties";

    const stored = spec.letter
      ? originalModesRef.current[spec.letter]
      : undefined;
    const live = { set: stored !== undefined, param: stored ?? null };
    const staged = pendingNamedModes[spec.name];
    const title = (
      <span className="flex items-center gap-2 min-w-0">
        <span className="truncate">{label}</span>
        {fallback.vendor && (
          <span className="text-[10px] tracking-wide px-1.5 py-0.5 rounded bg-discord-dark-400 text-discord-text-muted flex-shrink-0 lowercase">
            {fallback.vendor}
          </span>
        )}
      </span>
    );

    if (spec.type === 4) {
      const checked = staged ? staged.sign === "+" : live.set;
      return {
        group,
        node: (
          <SettingRow
            key={spec.name}
            id={`channel.${spec.name}`}
            title={title}
            description={description}
            control={
              <Switch
                checked={checked}
                label={label}
                onChange={(next) =>
                  stageNamedMode(
                    spec.name,
                    next === live.set ? null : { sign: next ? "+" : "-" },
                  )
                }
              />
            }
          />
        ),
      };
    }

    const placeholder = live.set
      ? t`(set, edit to change)`
      : (meta?.paramPlaceholder ?? t`(not set)`);
    return {
      group,
      node: (
        <SettingRow
          key={spec.name}
          id={`channel.${spec.name}`}
          title={title}
          description={description}
        >
          <input
            type="text"
            value={staged?.param ?? live.param ?? ""}
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
            placeholder={placeholder}
            className="field-input w-full"
          />
        </SettingRow>
      ),
    };
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

  const namedAdvancedSection = () => {
    const grouped = new Map<NamedModeGroup, React.ReactNode[]>();
    for (const spec of server?.namedModes?.channelModes ?? []) {
      const result = namedModeRow(spec);
      if (!result) continue;
      const list = grouped.get(result.group) ?? [];
      list.push(result.node);
      grouped.set(result.group, list);
    }
    const groups = NAMED_MODE_GROUP_ORDER.filter(
      (g) => (grouped.get(g)?.length ?? 0) > 0,
    );
    if (groups.length === 0) {
      return (
        <p className="text-sm text-discord-text-muted italic">
          <Trans>No advanced modes on this server.</Trans>
        </p>
      );
    }
    return (
      <>
        {groups.map((g) => (
          <SettingGroup key={g} title={NAMED_MODE_GROUP_LABELS[g]}>
            {grouped.get(g)}
          </SettingGroup>
        ))}
      </>
    );
  };

  const fallbackAdvancedSection = (
    <>
      <SettingGroup title={t`Flood protection`}>
        <SettingRow
          id="channel.F"
          title={t`Flood profile (+F)`}
          description={t`Pick a preset flood protection profile. UnrealIRCd only.`}
        >
          <select
            value={value("F")}
            onChange={(e) => setValue("F", e.target.value)}
            className="field-input w-full"
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
        </SettingRow>
        <SettingRow
          id="channel.f"
          title={t`Flood parameters (+f)`}
          description={t`Enter parameters as [rules]:seconds, or build them with Configure.`}
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={value("f")}
              onChange={(e) => setValue("f", e.target.value)}
              placeholder={t`Default`}
              className="field-input flex-1 min-w-0"
            />
            <Button
              variant="secondary"
              onClick={() => setIsFloodModalOpen(true)}
            >
              <Trans>Configure</Trans>
            </Button>
          </div>
        </SettingRow>
      </SettingGroup>

      <SettingGroup title={t`Content filtering`}>
        <FlagRow
          letter="c"
          title={t`Block color codes (+c)`}
          description={t`Block messages containing mIRC color codes`}
          checked={flag("c")}
          onChange={(on) => setFlag("c", on)}
        />
        <FlagRow
          letter="C"
          title={t`No CTCPs (+C)`}
          description={t`Block CTCP commands in the channel`}
          checked={flag("C")}
          onChange={(on) => setFlag("C", on)}
        />
        <FlagRow
          letter="G"
          title={t`Filter bad words (+G)`}
          description={t`Filter out bad words with <censored>`}
          checked={flag("G")}
          onChange={(on) => setFlag("G", on)}
        />
        <FlagRow
          letter="S"
          title={t`Strip color codes (+S)`}
          description={t`Strip mIRC color codes from messages`}
          checked={flag("S")}
          onChange={(on) => setFlag("S", on)}
        />
      </SettingGroup>

      <SettingGroup title={t`Channel behavior`}>
        <FlagRow
          letter="D"
          title={t`Delay joins (+D)`}
          description={t`Delay showing joins until someone speaks`}
          checked={flag("D")}
          onChange={(on) => setFlag("D", on)}
        />
        <FlagRow
          letter="K"
          title={t`No knocks (+K)`}
          description={t`Block the /KNOCK command.`}
          checked={flag("K")}
          onChange={(on) => setFlag("K", on)}
        />
        <FlagRow
          letter="N"
          title={t`No nick changes (+N)`}
          description={t`Block nickname changes.`}
          checked={flag("N")}
          onChange={(on) => setFlag("N", on)}
        />
        <FlagRow
          letter="Q"
          title={t`No kicks (+Q)`}
          description={t`Block kicks.`}
          checked={flag("Q")}
          onChange={(on) => setFlag("Q", on)}
        />
        <FlagRow
          letter="T"
          title={t`No notices (+T)`}
          description={t`Block NOTICE.`}
          checked={flag("T")}
          onChange={(on) => setFlag("T", on)}
        />
        <FlagRow
          letter="V"
          title={t`No invites (+V)`}
          description={t`Block the /INVITE command.`}
          checked={flag("V")}
          onChange={(on) => setFlag("V", on)}
        />
      </SettingGroup>

      <SettingGroup title={t`Access control`}>
        <FlagRow
          letter="M"
          title={t`Registered nick required (+M)`}
          description={t`Require a registered nickname (+r) to talk.`}
          checked={flag("M")}
          onChange={(on) => setFlag("M", on)}
        />
        <FlagRow
          letter="R"
          title={t`Registered users only (+R)`}
          description={t`Let only registered users (+r) join.`}
          checked={flag("R")}
          onChange={(on) => setFlag("R", on)}
        />
        <FlagRow
          letter="O"
          title={t`IRC operator only (+O)`}
          description={t`Let only IRC operators join. Only IRCops can set this.`}
          checked={flag("O")}
          onChange={(on) => setFlag("O", on)}
        />
        <FlagRow
          letter="z"
          title={t`Secure connection required (+z)`}
          description={t`Let only clients on secure connections (SSL/TLS) join.`}
          checked={flag("z")}
          onChange={(on) => setFlag("z", on)}
        />
      </SettingGroup>

      <SettingGroup title={t`Channel properties`}>
        <FlagRow
          letter="p"
          title={t`Private channel (+p)`}
          description={t`Mark the channel as private.`}
          checked={flag("p")}
          onChange={(on) => setFlag("p", on)}
        />
        <FlagRow
          letter="P"
          title={t`Permanent channel (+P)`}
          description={t`Keep the channel when it empties. Only IRCops can set this.`}
          checked={flag("P")}
          onChange={(on) => setFlag("P", on)}
        />
        <SettingRow
          id="channel.H"
          title={t`Channel history (+H)`}
          description={t`Record history as max-lines:max-minutes. Leave empty to disable.`}
        >
          <input
            type="text"
            value={value("H")}
            onChange={(e) => setValue("H", e.target.value)}
            placeholder={t`e.g., 100:1440`}
            className="field-input w-full"
          />
        </SettingRow>
        <SettingRow
          id="channel.L"
          title={t`Channel link (+L)`}
          description={t`Send users here when they can't join. Leave empty to disable.`}
        >
          <input
            type="text"
            value={value("L")}
            onChange={(e) => setValue("L", e.target.value)}
            placeholder={t`#overflow`}
            className="field-input w-full"
          />
        </SettingRow>
      </SettingGroup>
    </>
  );

  const renderMaskList = (listSection: ListSection) => {
    const type = LIST_TYPE[listSection];
    const copy = {
      bans: {
        placeholder: t`Add ban mask (e.g., nick!*@*, *!*@host.com)`,
        add: t`Add ban`,
        empty: t`No bans yet, add one above`,
      },
      exceptions: {
        placeholder: t`Add exception mask (e.g., nick!*@*, *!*@host.com)`,
        add: t`Add exception`,
        empty: t`No exceptions yet, add one above`,
      },
      invites: {
        placeholder: t`Add invitation mask (e.g., nick!*@*, *!*@host.com)`,
        add: t`Add invitation`,
        empty: t`No invitations yet, add one above`,
      },
    }[listSection];
    const masks = modes.filter((mode) => mode.type === type);
    const canAdd = !!newMask.trim() && !isAdding;

    return (
      <>
        <SettingGroup>
          <div className="flex items-center gap-2 px-4 py-3">
            <input
              type="text"
              value={newMask}
              onChange={(e) => setNewMask(e.target.value)}
              placeholder={copy.placeholder}
              className="field-input flex-1 min-w-0"
            />
            <button
              type="button"
              onClick={() => canAdd && addMode(type, newMask.trim())}
              disabled={!canAdd}
              aria-label={copy.add}
              title={copy.add}
              className="button-primary w-9 h-9 shrink-0 rounded-lg flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAdding ? (
                <FaSpinner className="animate-spin" size={14} />
              ) : (
                <FaPlus size={14} />
              )}
            </button>
          </div>
          {loading ? (
            <EmptyRow>
              <Trans>Loading channel modes...</Trans>
            </EmptyRow>
          ) : masks.length === 0 ? (
            <EmptyRow>{copy.empty}</EmptyRow>
          ) : (
            masks.map((mode) => {
              const editing = editingMask === mode.mask;
              const removing = removingMasks.has(mode.mask);
              return (
                <div
                  key={`${mode.type}-${mode.mask}`}
                  className="flex items-center gap-3 px-4 py-3"
                >
                  <div className="flex-1 min-w-0">
                    {editing ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="field-input w-full"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            saveEdit(type, mode.mask, editValue);
                          } else if (e.key === "Escape") {
                            e.stopPropagation();
                            cancelEditing();
                          }
                        }}
                      />
                    ) : (
                      <>
                        <div className="text-sm text-white break-all">
                          {mode.mask}
                        </div>
                        <div className="text-xs text-discord-text-muted">
                          {mode.setter && t`set by ${mode.setter}`}
                          {mode.setter && mode.timestamp && " • "}
                          {mode.timestamp &&
                            new Date(mode.timestamp * 1000).toLocaleString()}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {editing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => saveEdit(type, mode.mask, editValue)}
                          className="icon-button w-10 h-10 rounded-lg"
                          aria-label={t`Save`}
                          title={t`Save`}
                        >
                          <FaCheck size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditing}
                          className="icon-button w-10 h-10 rounded-lg"
                          aria-label={t`Cancel`}
                          title={t`Cancel`}
                        >
                          <FaTimes size={13} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMask(mode.mask);
                            setEditValue(mode.mask);
                          }}
                          className="icon-button w-10 h-10 rounded-lg"
                          aria-label={t`Edit`}
                          title={t`Edit`}
                        >
                          <FaEdit size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeMode(type, mode.mask)}
                          disabled={removing}
                          className="icon-button w-10 h-10 rounded-lg"
                          aria-label={t`Remove`}
                          title={t`Remove`}
                        >
                          {removing ? (
                            <FaSpinner className="animate-spin" size={13} />
                          ) : (
                            <FaTrash size={13} />
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </SettingGroup>
        <p className="text-xs text-discord-text-muted px-1">
          <Trans>
            Use wildcards: * matches any sequence, ? matches any single
            character. Examples: nick!*@*, *!*@host.com, *!*user@*
          </Trans>
        </p>
      </>
    );
  };

  const applyActiveSection = (() => {
    if (activeId === "general") return applyGeneralChanges;
    if (activeId === "settings") return applySettingsChanges;
    if (activeId !== "advanced") return null;
    return server?.namedModes?.supported
      ? applyNamedModesAdvancedChanges
      : applyAdvancedChanges;
  })();
  const scheduleApply = () => {
    if (!applyActiveSection) return;
    if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
    const apply = applyActiveSection;
    pendingApplyRef.current = apply;
    applyTimerRef.current = setTimeout(() => {
      applyTimerRef.current = null;
      void apply();
    }, AUTOSAVE_DELAY_MS);
  };
  scheduleApplyRef.current = scheduleApply;

  const body = (() => {
    if (isListSection(activeId)) return renderMaskList(activeId);
    if (activeId === "general") return generalSection;
    if (activeId === "settings") return settingsSection;
    if (server?.namedModes?.supported) return namedAdvancedSection();
    return fallbackAdvancedSection;
  })();

  return (
    <>
      <PageShell
        title={channelName}
        sections={sections}
        activeSection={activeId}
        onSectionChange={setSectionId}
        startOnSection={!!page.section}
      >
        <div onBlur={scheduleApply} className="contents">
          {body}
        </div>
      </PageShell>
      <FloodSettingsModal
        isOpen={isFloodModalOpen}
        onClose={() => setIsFloodModalOpen(false)}
        onSave={handleFloodSettingsSave}
        initialFloodProfile={value("F")}
        initialFloodParams={value("f")}
      />
    </>
  );
};

export default ChannelSettingsPage;
