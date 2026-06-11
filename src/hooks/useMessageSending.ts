/**
 * Hook for handling message sending logic including IRC commands,
 * multiline messages, and protocol formatting
 */
import { useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { base64EncodeUtf8 } from "../lib/base64";
import ircClient from "../lib/ircClient";
import { makeLabel, withLabel } from "../lib/labeledResponse";
import {
  type FormattingType,
  formatMessageForIrc,
} from "../lib/messageFormatter";
import { createBatchId, splitLongMessage } from "../lib/messageProtocol";
import { PRIVILEGED_COMMANDS } from "../lib/privilegedCommands";
import useStore, { serverSupportsMultiline } from "../store";
import type { BotCommand, Channel, Message, PrivateChat, User } from "../types";

/**
 * Try to dispatch a slash command as a +draft/bot-cmd TAGMSG.
 * Returns true if a matching bot command was found and the TAGMSG
 * was sent.  Resolution is scoped to bots the user can actually see
 * as +B in the current view -- never a server-wide name lookup --
 * so a bot lurking in another channel can't shadow `/oper`, `/ns
 * identify`, or any other privileged builtin.
 *
 *   1) explicit `/cmd@botnick` where botnick is a +B user in the
 *      current channel or is the current DM peer (and is +B)
 *   2) otherwise scan +B users in the current channel
 *   3) DM target if the peer is +B
 * Privileged names listed in PRIVILEGED_COMMANDS are refused
 * outright.
 */
function tryDispatchBotCommand(
  serverId: string,
  channel: Channel | null,
  privateChat: PrivateChat | null,
  rawCmdName: string,
  args: string[],
): boolean {
  let target = rawCmdName;
  let cmdName = rawCmdName;
  if (rawCmdName.includes("@")) {
    const [c, t] = rawCmdName.split("@", 2);
    cmdName = c;
    target = t;
  } else {
    target = "";
  }
  const lowerCmd = cmdName.toLowerCase();
  if (PRIVILEGED_COMMANDS.has(lowerCmd)) return false;

  const server = useStore.getState().servers.find((s) => s.id === serverId);
  if (!server?.botCommands) return false;
  const bots = server.botCommands;

  const isKnownBotNick = (nick: string): boolean => {
    const k = nick.toLowerCase();
    if (server.bots?.[k]) return true;
    return server.channels.some((c) =>
      c.users.some((u) => u.username.toLowerCase() === k && u.isBot === true),
    );
  };

  type Match = { bot: string; cmd: BotCommand };
  const matches: Match[] = [];
  // explicit target via /cmd@botnick -- must be a +B nick in scope
  if (target) {
    const tkey = target.toLowerCase();
    const inChannel = !!channel?.users.some(
      (u) => u.username.toLowerCase() === tkey && u.isBot === true,
    );
    const isDmPeer =
      !!privateChat &&
      privateChat.username.toLowerCase() === tkey &&
      isKnownBotNick(privateChat.username);
    const list = bots[tkey];
    if (list && (inChannel || isDmPeer)) {
      const cmd = list.find((c) => c.name.toLowerCase() === lowerCmd);
      if (cmd) matches.push({ bot: target, cmd });
    }
  }
  // channel-bot search: must be +B AND in the channel
  if (!matches.length && channel) {
    for (const u of channel.users) {
      if (u.isBot !== true) continue;
      const list = bots[u.username.toLowerCase()];
      if (!list) continue;
      const cmd = list.find((c) => c.name.toLowerCase() === lowerCmd);
      if (cmd) matches.push({ bot: u.username, cmd });
    }
  }
  // DM with a bot -- peer must be +B
  if (!matches.length && privateChat && isKnownBotNick(privateChat.username)) {
    const list = bots[privateChat.username.toLowerCase()];
    if (list) {
      const cmd = list.find((c) => c.name.toLowerCase() === lowerCmd);
      if (cmd) matches.push({ bot: privateChat.username, cmd });
    }
  }
  if (!matches.length) return false;
  const { bot, cmd } = matches[0];

  // Naive arg parsing: map positional args onto declared options in
  // order, leftovers concatenated onto the last string-typed option.
  const options: Record<string, string | number | boolean> = {};
  const opts = cmd.options ?? [];
  for (let i = 0; i < opts.length && i < args.length; i++) {
    const o = opts[i];
    const isLast = i === opts.length - 1;
    const raw = isLast ? args.slice(i).join(" ") : args[i];
    if (o.type === "int") options[o.name] = Number.parseInt(raw, 10);
    else if (o.type === "bool")
      options[o.name] = raw === "true" || raw === "1" || raw === "yes";
    else options[o.name] = raw;
  }

  sendBotCommand(serverId, channel, bot, cmd, options);
  return true;
}

/**
 * Wire-level send for a pre-resolved bot command with structured
 * options (no freeform-arg parsing).  Used both by the freeform-text
 * path above and by the param modal, which collects values directly
 * via form controls.
 */
// Where a command may be invoked. Prefer the spec `contexts`; fall back to the
// legacy obby.world/bot-info `visibility`/`scopes` pair so a private command is
// NEVER routed publicly just because the directory hasn't sent `contexts` yet.
function resolveContexts(cmd: BotCommand): ("public" | "private" | "pm")[] {
  if (Array.isArray(cmd.contexts) && cmd.contexts.length > 0)
    return cmd.contexts;
  const scopes = cmd.scopes ?? ["channel"];
  const priv = cmd.visibility === "private";
  const out: ("public" | "private" | "pm")[] = [];
  if (scopes.includes("channel")) out.push(priv ? "private" : "public");
  if (scopes.includes("dm")) out.push("pm");
  return out.length > 0 ? out : [priv ? "private" : "public"];
}

export function sendBotCommand(
  serverId: string,
  channel: Channel | null,
  bot: string,
  cmd: BotCommand,
  options: Record<string, string | number | boolean>,
): void {
  const contexts = resolveContexts(cmd);
  const canPublic = contexts.includes("public");
  const canPrivate = contexts.includes("private");
  const canPm = contexts.includes("pm");

  // Per spec §Invoking a command: the base64 of the compact JSON invocation
  // rides in +draft/bot-cmd. How it is addressed depends on the context.
  if (channel && canPublic) {
    // public: TAGMSG to the channel. Name the target bot so that when several
    // bots in the channel share a command name, only the intended one acts.
    const payload = { name: cmd.name, options, bot };
    const b64 = base64EncodeUtf8(JSON.stringify(payload));
    ircClient.sendRaw(
      serverId,
      `@+draft/bot-cmd=${b64} TAGMSG ${channel.name}`,
    );
  } else if (channel && canPrivate) {
    // private: TAGMSG to the bot. The channel travels in the payload, since
    // +draft/channel-context is not valid on TAGMSG.
    const payload = { name: cmd.name, options, channel: channel.name };
    const b64 = base64EncodeUtf8(JSON.stringify(payload));
    ircClient.sendRaw(serverId, `@+draft/bot-cmd=${b64} TAGMSG ${bot}`);
  } else if (canPm) {
    // pm: TAGMSG to the bot, no channel.
    const payload = { name: cmd.name, options };
    const b64 = base64EncodeUtf8(JSON.stringify(payload));
    ircClient.sendRaw(serverId, `@+draft/bot-cmd=${b64} TAGMSG ${bot}`);
  }
}

/**
 * labeled-response is only useful when the server will also echo our
 * own messages back: without echo-message, no echo arrives, no
 * acknowledgment, and the placeholder would hang forever.
 */
function shouldUseLabeledResponse(serverId: string): boolean {
  return (
    ircClient.hasCapability(serverId, "labeled-response") &&
    ircClient.hasCapability(serverId, "echo-message") &&
    ircClient.hasCapability(serverId, "batch")
  );
}

/** How long to wait before flipping a pending message to "failed". */
const PENDING_TIMEOUT_MS = 30_000;

function arm_pending_timeout(
  serverId: string,
  bufferId: string,
  label: string,
) {
  setTimeout(() => {
    useStore.getState().failPendingMessage(serverId, bufferId, label);
  }, PENDING_TIMEOUT_MS);
}

interface UseMessageSendingOptions {
  selectedServerId: string | null;
  selectedChannelId: string | null;
  selectedPrivateChatId: string | null;
  selectedChannel: Channel | null;
  selectedPrivateChat: PrivateChat | null;
  currentUser: User | null;
  selectedColor: string | null;
  selectedFormatting: FormattingType[];
  localReplyTo: Message | null;
}

interface UseMessageSendingReturn {
  sendMessage: (text: string) => void;
}

interface WhisperContext {
  isWhisper: boolean;
  targetUser: string;
  channelContext: string;
}

function getWhisperContext(
  replyTo: Message | null,
  currentUser: User | null,
): WhisperContext | null {
  if (!replyTo) {
    return null;
  }

  const channelContext =
    replyTo.tags?.["+channel-context"] ||
    replyTo.tags?.["channel-context"] ||
    replyTo.tags?.["+draft/channel-context"] ||
    replyTo.tags?.["draft/channel-context"];

  if (!channelContext) {
    return null;
  }

  const senderUserId = replyTo.userId;
  const currentUserId = currentUser?.username || currentUser?.id;

  const targetUser =
    senderUserId === currentUserId
      ? replyTo.whisperTarget || senderUserId
      : senderUserId;

  return {
    isWhisper: true,
    targetUser,
    channelContext: channelContext as string,
  };
}

type MessageSendCallback = (formattedLine: string) => void;

function sendViaWhisperOrRegular(
  serverId: string,
  whisperContext: WhisperContext | null,
  formattedText: string,
  sendViaNormalChannel: MessageSendCallback,
): void {
  if (whisperContext) {
    ircClient.sendWhisper(
      serverId,
      whisperContext.targetUser,
      whisperContext.channelContext,
      formattedText,
    );
  } else {
    sendViaNormalChannel(formattedText);
  }
}

/**
 * Hook for handling message sending logic including IRC commands,
 * multiline messages, and protocol formatting
 */
export function useMessageSending({
  selectedServerId,
  selectedChannelId,
  selectedPrivateChatId,
  selectedChannel,
  selectedPrivateChat,
  currentUser,
  selectedColor,
  selectedFormatting,
  localReplyTo,
}: UseMessageSendingOptions): UseMessageSendingReturn {
  const { globalSettings, setAway, clearAway } = useStore();

  /**
   * Handle IRC commands like /join, /part, /nick, etc.
   */
  const handleCommand = useCallback(
    (cleanedText: string) => {
      if (!selectedServerId) return;

      const command = cleanedText.substring(1).trim();
      const [commandName, ...args] = command.split(" ");

      if (commandName === "nick") {
        ircClient.sendRaw(selectedServerId, `NICK ${args[0]}`);
      } else if (commandName === "join") {
        if (args[0]) {
          ircClient.joinChannel(selectedServerId, args[0]);
          ircClient.triggerEvent("JOIN", {
            serverId: selectedServerId,
            username: currentUser?.username || "",
            channelName: args[0],
          });
        } else {
          console.error("No channel specified for /join command");
        }
      } else if (commandName === "part") {
        const partTarget = args[0] || selectedChannel?.name;
        if (partTarget) {
          useStore.getState().leaveChannel(selectedServerId, partTarget);
        }
      } else if (commandName === "msg") {
        const [target, ...messageParts] = args;
        const message = messageParts.join(" ");
        ircClient.sendRaw(selectedServerId, `PRIVMSG ${target} :${message}`);
      } else if (commandName === "whisper") {
        const [targetUser, ...messageParts] = args;
        if (!selectedChannel) {
          console.error("Whispers can only be sent from a channel");
          return;
        }
        if (!targetUser || messageParts.length === 0) {
          console.error("Usage: /whisper <username> <message>");
          return;
        }
        const message = messageParts.join(" ");
        ircClient.sendWhisper(
          selectedServerId,
          targetUser,
          selectedChannel.name,
          message,
        );
      } else if (commandName === "me") {
        const actionMessage = cleanedText.substring(4).trim();
        const whisperContext = getWhisperContext(localReplyTo, currentUser);
        const target =
          selectedChannel?.name ?? selectedPrivateChat?.username ?? "";
        if (whisperContext) {
          ircClient.sendWhisper(
            selectedServerId,
            whisperContext.targetUser,
            whisperContext.channelContext,
            `\u0001ACTION ${actionMessage}\u0001`,
          );
        } else {
          if (!target) return;
          ircClient.sendRaw(
            selectedServerId,
            `${localReplyTo?.msgid ? `@+reply=${localReplyTo.msgid};+draft/reply=${localReplyTo.msgid} ` : ""}PRIVMSG ${target} :\u0001ACTION ${actionMessage}\u0001`,
          );
        }
        // Non-echo fallback: servers without echo-message won't reflect our
        // ACTION back, so add it locally the same way regular DMs are handled.
        if (
          selectedPrivateChat &&
          currentUser &&
          !ircClient.hasCapability(selectedServerId, "echo-message")
        ) {
          const { addMessage } = useStore.getState();
          const outgoingMessage: Message = {
            id: uuidv4(),
            content: `\u0001ACTION ${actionMessage}\u0001`,
            timestamp: new Date(),
            userId: currentUser.username || currentUser.id,
            channelId: selectedPrivateChat.id,
            serverId: selectedServerId,
            type: "message" as const,
            reactions: [],
            replyMessage: localReplyTo,
            mentioned: [],
          };
          addMessage(outgoingMessage);
        }
      } else if (commandName === "away") {
        const message = args.join(" ");
        if (message) {
          setAway(selectedServerId, message);
        } else {
          setAway(selectedServerId);
        }
      } else if (commandName === "back") {
        clearAway(selectedServerId);
      } else if (
        tryDispatchBotCommand(
          selectedServerId,
          selectedChannel,
          selectedPrivateChat,
          commandName,
          args,
        )
      ) {
        // bot-cmd dispatched, nothing else to do
      } else {
        const fullCommand =
          args.length > 0 ? `${commandName} ${args.join(" ")}` : commandName;
        ircClient.sendRaw(selectedServerId, fullCommand);
      }
    },
    [
      selectedServerId,
      selectedChannel,
      selectedPrivateChat,
      currentUser,
      localReplyTo,
      setAway,
      clearAway,
    ],
  );

  /**
   * Send a multiline message using BATCH protocol
   */
  const sendMultilineMessage = useCallback(
    (cleanedText: string, target: string, lines: string[]) => {
      if (!selectedServerId) return;

      const whisperContext = getWhisperContext(localReplyTo, currentUser);

      if (whisperContext) {
        lines.forEach((line) => {
          const formattedLine = formatMessageForIrc(line, {
            color: selectedColor || "inherit",
            formatting: selectedFormatting,
          });
          ircClient.sendWhisper(
            selectedServerId,
            whisperContext.targetUser,
            whisperContext.channelContext,
            formattedLine,
          );
        });
        return;
      }

      const batchId = createBatchId();
      const replyPrefix = localReplyTo?.msgid
        ? `@+reply=${localReplyTo.msgid};+draft/reply=${localReplyTo.msgid} `
        : "";

      ircClient.sendRaw(
        selectedServerId,
        `${replyPrefix}BATCH +${batchId} draft/multiline ${target}`,
      );

      const hasMultipleLines = lines.length > 1;

      if (hasMultipleLines) {
        lines.forEach((line) => {
          const formattedLine = formatMessageForIrc(line, {
            color: selectedColor || "inherit",
            formatting: selectedFormatting,
          });

          const maxLineLengthForTarget =
            512 -
            (1 + 20 + 1 + 20 + 1 + 63 + 1 + 7 + 1 + target.length + 2 + 2) -
            10;

          if (formattedLine.length > maxLineLengthForTarget) {
            // preserveBoundarySpace=true so concat reconstructs the
            // original spacing.  Without it the receiver sees
            // "AAA BBBCCC" instead of "AAA BBB CCC".
            const splitLines = splitLongMessage(formattedLine, target, true);
            splitLines.forEach((splitLine: string, index: number) => {
              if (index === 0) {
                ircClient.sendRaw(
                  selectedServerId,
                  `@batch=${batchId} PRIVMSG ${target} :${splitLine}`,
                );
              } else {
                ircClient.sendRaw(
                  selectedServerId,
                  `@batch=${batchId};draft/multiline-concat PRIVMSG ${target} :${splitLine}`,
                );
              }
            });
          } else {
            ircClient.sendRaw(
              selectedServerId,
              `@batch=${batchId} PRIVMSG ${target} :${formattedLine}`,
            );
          }
        });
      } else {
        const formattedText = formatMessageForIrc(cleanedText, {
          color: selectedColor || "inherit",
          formatting: selectedFormatting,
        });

        const splitLines = splitLongMessage(formattedText, target, true);
        splitLines.forEach((splitLine: string, index: number) => {
          if (index === 0) {
            ircClient.sendRaw(
              selectedServerId,
              `@batch=${batchId} PRIVMSG ${target} :${splitLine}`,
            );
          } else {
            ircClient.sendRaw(
              selectedServerId,
              `@batch=${batchId};draft/multiline-concat PRIVMSG ${target} :${splitLine}`,
            );
          }
        });
      }

      ircClient.sendRaw(selectedServerId, `BATCH -${batchId}`);
    },
    [
      selectedServerId,
      selectedColor,
      selectedFormatting,
      localReplyTo,
      currentUser,
    ],
  );

  /**
   * Send multiline fallback when server doesn't support BATCH
   */
  const sendMultilineFallback = useCallback(
    (lines: string[], target: string) => {
      if (!selectedServerId) return;

      const whisperContext = getWhisperContext(localReplyTo, currentUser);

      if (whisperContext) {
        lines.forEach((line) => {
          const formattedLine = formatMessageForIrc(line, {
            color: selectedColor || "inherit",
            formatting: selectedFormatting,
          });
          ircClient.sendWhisper(
            selectedServerId,
            whisperContext.targetUser,
            whisperContext.channelContext,
            formattedLine,
          );
        });
        return;
      }

      const messagePrefix = localReplyTo?.msgid
        ? `@+reply=${localReplyTo.msgid};+draft/reply=${localReplyTo.msgid} `
        : "";

      if (globalSettings.autoFallbackToSingleLine) {
        const combinedText = lines.join(" ");
        const formattedText = formatMessageForIrc(combinedText, {
          color: selectedColor || "inherit",
          formatting: selectedFormatting,
        });

        const splitLines = splitLongMessage(formattedText, target);
        splitLines.forEach((line: string) => {
          ircClient.sendRaw(
            selectedServerId,
            `${messagePrefix}PRIVMSG ${target} :${line}`,
          );
        });
      } else {
        lines.forEach((line) => {
          const formattedLine = formatMessageForIrc(line, {
            color: selectedColor || "inherit",
            formatting: selectedFormatting,
          });

          const splitLines = splitLongMessage(formattedLine, target);
          splitLines.forEach((splitLine: string) => {
            ircClient.sendRaw(
              selectedServerId,
              `${messagePrefix}PRIVMSG ${target} :${splitLine}`,
            );
          });
        });
      }
    },
    [
      selectedServerId,
      selectedColor,
      selectedFormatting,
      localReplyTo,
      currentUser,
      globalSettings,
    ],
  );

  /**
   * Send a regular single message
   */
  const sendRegularMessage = useCallback(
    (cleanedText: string, target: string) => {
      if (!selectedServerId) return;

      const formattedText = formatMessageForIrc(cleanedText, {
        color: selectedColor || "inherit",
        formatting: selectedFormatting,
      });

      const whisperContext = getWhisperContext(localReplyTo, currentUser);

      // labeled-response: when the cap is acked, we generate one label
      // for the whole send (even when split across multiple PRIVMSGs by
      // splitLongMessage; the spec lets us reuse the same label across
      // them as long as we don't reuse before the response completes).
      const useLabel =
        !whisperContext && shouldUseLabeledResponse(selectedServerId);
      const label = useLabel ? makeLabel() : null;

      // Buffer id for the pending placeholder.  Channels are matched
      // by id from the store; PMs use the PrivateChat record's id.
      const bufferId = selectedChannel
        ? selectedChannel.id
        : selectedPrivateChat
          ? selectedPrivateChat.id
          : null;

      // Insert pending placeholder (only when we have a label *and* a
      // store buffer to put it in -- whisper has neither).
      if (label && bufferId && currentUser && selectedServerId) {
        const placeholder: Message = {
          id: uuidv4(),
          content: cleanedText,
          timestamp: new Date(),
          userId: currentUser.username || currentUser.id,
          channelId: bufferId,
          serverId: selectedServerId,
          type: "message",
          reactions: [],
          replyMessage: localReplyTo,
          mentioned: [],
          pendingLabel: label,
          status: "pending",
        };
        useStore.getState().addMessage(placeholder);
        arm_pending_timeout(selectedServerId, bufferId, label);
      }

      const replyPrefix = localReplyTo?.msgid
        ? `@+reply=${localReplyTo.msgid};+draft/reply=${localReplyTo.msgid} `
        : "";
      const tagPrefix = withLabel(replyPrefix, label);

      sendViaWhisperOrRegular(
        selectedServerId,
        whisperContext,
        formattedText,
        (formattedLine) => {
          const splitLines = splitLongMessage(formattedLine, target);
          splitLines.forEach((line: string) => {
            ircClient.sendRaw(
              selectedServerId,
              `${tagPrefix}PRIVMSG ${target} :${line}`,
            );
          });
        },
      );
    },
    [
      selectedServerId,
      selectedColor,
      selectedFormatting,
      localReplyTo,
      currentUser,
      selectedChannel,
      selectedPrivateChat,
    ],
  );

  /**
   * Main send message function
   */
  const sendMessage = useCallback(
    (text: string) => {
      const cleanedText = text.replace(/\n+$/, "");

      if (cleanedText.trim() === "") return;
      if (!selectedServerId || (!selectedChannelId && !selectedPrivateChatId))
        return;

      // Handle commands
      if (cleanedText.startsWith("/")) {
        handleCommand(cleanedText);
        return;
      }

      // Handle regular messages
      const target =
        selectedChannel?.name ?? selectedPrivateChat?.username ?? "";
      if (!target) return;

      const lines = cleanedText.split("\n");
      const supportsMultiline = serverSupportsMultiline(selectedServerId);
      const hasMultipleLines = lines.length > 1;

      // Calculate message length limits
      const maxMessageLength =
        512 -
        (1 + 20 + 1 + 20 + 1 + 63 + 1 + 7 + 1 + target.length + 2 + 2) -
        10;
      const isSingleLongLine =
        lines.length === 1 && cleanedText.length > maxMessageLength;

      // Determine sending strategy
      if (supportsMultiline && (hasMultipleLines || isSingleLongLine)) {
        sendMultilineMessage(cleanedText, target, lines);
      } else if (hasMultipleLines && !supportsMultiline) {
        sendMultilineFallback(lines, target);
      } else {
        sendRegularMessage(cleanedText, target);
      }

      // Only needed for servers that won't echo our outgoing DM back.
      if (
        selectedPrivateChat &&
        currentUser &&
        !ircClient.hasCapability(selectedServerId, "echo-message")
      ) {
        const outgoingMessage: Message = {
          id: uuidv4(),
          content: cleanedText,
          timestamp: new Date(),
          userId: currentUser.username || currentUser.id,
          channelId: selectedPrivateChat.id,
          serverId: selectedServerId,
          type: "message" as const,
          reactions: [],
          replyMessage: localReplyTo,
          mentioned: [],
        };

        const { addMessage } = useStore.getState();
        addMessage(outgoingMessage);
      }
    },
    [
      selectedServerId,
      selectedChannelId,
      selectedPrivateChatId,
      selectedChannel,
      selectedPrivateChat,
      currentUser,
      localReplyTo,
      handleCommand,
      sendMultilineMessage,
      sendMultilineFallback,
      sendRegularMessage,
    ],
  );

  return {
    sendMessage,
  };
}
