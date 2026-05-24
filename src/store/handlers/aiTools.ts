import type { StoreApi } from "zustand";
import {
  AI_TOOLS_TAG,
  type AiStepMessage,
  type AiWorkflowMessage,
  decodeAiToolsValue,
} from "../../lib/aiTools";
import ircClient from "../../lib/ircClient";
import { extractMentions } from "../../lib/notifications";
import type { Message } from "../../types";
import { resolveReplyMessage } from "../helpers";
import type { AiStep, AiWorkflow, AppState } from "../index";

function nowMs(): number {
  return Date.now();
}

function emptyWorkflow(
  serverId: string,
  channel: string,
  senderNick: string,
  m: AiWorkflowMessage,
  historical: boolean,
): AiWorkflow {
  return {
    id: m.id,
    serverId,
    channel,
    senderNick,
    name: m.name,
    state: m.state,
    trigger: m.trigger,
    prompt: m.prompt,
    cancelledBy: m["cancelled-by"],
    startedAt: nowMs(),
    updatedAt: nowMs(),
    steps: [],
    collapsed: true,
    dismissed: false,
    historical,
  };
}

function applyWorkflowUpdate(
  prev: AiWorkflow | undefined,
  serverId: string,
  channel: string,
  senderNick: string,
  m: AiWorkflowMessage,
  historical: boolean,
): AiWorkflow {
  if (!prev) return emptyWorkflow(serverId, channel, senderNick, m, historical);
  // Stickiness: if the workflow was first seen historical, keep it that
  // way even if later events (rare) arrive live. The converse -- live
  // workflow gets later replayed events -- can't happen in practice.
  return {
    ...prev,
    state: m.state,
    name: m.name ?? prev.name,
    trigger: m.trigger ?? prev.trigger,
    prompt: m.prompt ?? prev.prompt,
    cancelledBy: m["cancelled-by"] ?? prev.cancelledBy,
    updatedAt: nowMs(),
  };
}

function applyStepUpdate(
  prev: AiWorkflow | undefined,
  m: AiStepMessage,
): { workflow: AiWorkflow; created: boolean } | undefined {
  if (!prev) return undefined;
  const idx = prev.steps.findIndex((s) => s.sid === m.sid);
  const baseStep: AiStep =
    idx === -1
      ? {
          sid: m.sid,
          type: m.type,
          state: m.state,
          tool: m.tool,
          label: m.label,
          content: m.content,
          truncated: m.truncated,
          startedAt: nowMs(),
          updatedAt: nowMs(),
        }
      : {
          ...prev.steps[idx],
          type: m.type,
          state: m.state,
          tool: m.tool ?? prev.steps[idx].tool,
          label: m.label ?? prev.steps[idx].label,
          // For string content during a content-stream the spec says
          // concatenate fragments in order; for object content (tool-call
          // args) the latest update wins.
          content:
            typeof m.content === "string" &&
            typeof prev.steps[idx].content === "string"
              ? (prev.steps[idx].content as string) + m.content
              : m.content !== undefined
                ? m.content
                : prev.steps[idx].content,
          truncated: m.truncated ?? prev.steps[idx].truncated,
          updatedAt: nowMs(),
        };
  const steps =
    idx === -1
      ? [...prev.steps, baseStep]
      : prev.steps.map((s, i) => (i === idx ? baseStep : s));
  return {
    workflow: { ...prev, steps, updatedAt: nowMs() },
    created: idx === -1,
  };
}

export function registerAiToolsHandlers(store: StoreApi<AppState>): void {
  // Decide whether an event arrived inside a CHATHISTORY batch by
  // looking at the @batch tag and resolving its type against the
  // store's active-batch map. Returns true for replayed events, so
  // the floating tray can stay quiet on channel join.
  const isReplayed = (
    serverId: string,
    mtags: Record<string, string> | undefined,
  ): boolean => {
    const batchId = mtags?.batch;
    if (!batchId) return false;
    const batch = store.getState().activeBatches[serverId]?.[batchId];
    return batch?.type === "chathistory";
  };

  const handleTaggedMessage = ({
    serverId,
    mtags,
    sender,
    target,
    fromPrivmsg,
    body,
  }: {
    serverId: string;
    mtags?: Record<string, string>;
    sender: string;
    target: string;
    fromPrivmsg: boolean;
    body?: string;
  }): void => {
    const raw = mtags?.[AI_TOOLS_TAG];
    if (!raw) return;
    const msg = decodeAiToolsValue(raw);
    if (!msg) return;
    const historical = isReplayed(serverId, mtags);

    if (msg.msg === "workflow") {
      // The bot's final answer is a PRIVMSG carrying the workflow tag.
      // Stash its msgid so the workflow card can deep-link back to the
      // chat message that closed it ("Responded in chat" footer).
      const finalMsgid = fromPrivmsg ? mtags?.msgid : undefined;
      store.setState((state) => {
        const server = state.aiWorkflows[serverId] ?? {};
        const merged = applyWorkflowUpdate(
          server[msg.id],
          serverId,
          target,
          sender,
          msg,
          historical,
        );
        if (finalMsgid && !merged.finalMsgid) {
          merged.finalMsgid = finalMsgid;
        }
        const aiWorkflows = {
          ...state.aiWorkflows,
          [serverId]: { ...server, [msg.id]: merged },
        };

        // In-chat placeholder Message owned by aiTools. We create one
        // on live workflow start, then morph it in place when the
        // final PRIVMSG arrives so the row reads as the bot's answer
        // (with the workflow pill alongside) without ever jumping
        // position in the chat list.
        const channel = target.startsWith("#")
          ? state.servers
              .find((s) => s.id === serverId)
              ?.channels.find(
                (c) => c.name.toLowerCase() === target.toLowerCase(),
              )
          : undefined;
        const isPmTarget = !target.startsWith("#");

        if (!channel && !isPmTarget) {
          return { aiWorkflows };
        }
        if (historical) {
          // Replayed workflows don't get a placeholder -- the original
          // PRIVMSG already exists in chathistory and carries the pill.
          return { aiWorkflows };
        }

        const channelKey = channel && `${serverId}-${channel.id}`;
        if (!channelKey) return { aiWorkflows };
        const placeholderId = `ai-wf-${serverId}-${msg.id}`;
        const existing = state.messages[channelKey] ?? [];
        const idx = existing.findIndex((m) => m.id === placeholderId);
        const isTerminal =
          msg.state === "complete" ||
          msg.state === "failed" ||
          msg.state === "cancelled";

        // PRIVMSG carrying the workflow tag -> morph the placeholder
        // into the real message. Add the msgid to processedMessageIds
        // so the generic CHANMSG handler (which runs after this one)
        // skips appending its own duplicate row.
        if (fromPrivmsg) {
          const processedMessageIds = mtags?.msgid
            ? new Set([...state.processedMessageIds, mtags.msgid])
            : state.processedMessageIds;
          if (idx >= 0) {
            // Resolve reply + mentions the same way the generic CHANMSG
            // handler would, so the morphed row reads identically to a
            // plain bot reply (quote block, ping highlight, etc.) and
            // doesn't lose context just because we're reusing the
            // placeholder slot.
            const replyMessage = resolveReplyMessage(
              mtags,
              serverId,
              channel?.id ?? "",
              existing,
            );
            const currentUser = ircClient.getCurrentUser(serverId);
            const globalSettings = state.globalSettings;
            const isOwnMessage =
              sender.toLowerCase() === currentUser?.username?.toLowerCase();
            const mentions =
              !isOwnMessage && body
                ? extractMentions(body, currentUser, globalSettings)
                : [];
            const morphed: Message = {
              ...existing[idx],
              msgid: mtags?.msgid,
              tags: mtags,
              content: body ?? existing[idx].content,
              timestamp: new Date(),
              userId: sender,
              replyMessage,
              mentioned: mentions,
              aiToolsPending: false,
            };
            const updated = existing.slice();
            updated[idx] = morphed;
            return {
              aiWorkflows,
              messages: { ...state.messages, [channelKey]: updated },
              processedMessageIds,
            };
          }
          return { aiWorkflows, processedMessageIds };
        }

        // Terminal-state TAGMSG and the placeholder is still pending
        // (i.e. the bot didn't tag its final PRIVMSG so the morph path
        // above never ran).  Remove the empty placeholder so the bot's
        // untagged reply -- which the CHANMSG handler will append as a
        // normal row, complete with reply quote -- isn't shadowed by a
        // stuck "Thinking…" spinner.
        if (isTerminal && idx >= 0 && existing[idx].aiToolsPending) {
          const updated = existing.slice();
          updated.splice(idx, 1);
          return {
            aiWorkflows,
            messages: { ...state.messages, [channelKey]: updated },
          };
        }

        // TAGMSG workflow event (start / state update).  Create the
        // placeholder on first sight, otherwise leave existing
        // state alone (steps update aiWorkflows, the placeholder
        // re-renders reactively against it).
        if (idx === -1 && msg.state === "start") {
          const placeholder: Message = {
            id: placeholderId,
            type: "message",
            content: "",
            timestamp: new Date(),
            userId: sender,
            channelId: channel?.id ?? "",
            serverId,
            reactions: [],
            replyMessage: null,
            mentioned: [],
            aiToolsWorkflowId: msg.id,
            aiToolsPending: true,
          };
          return {
            aiWorkflows,
            messages: {
              ...state.messages,
              [channelKey]: [...existing, placeholder],
            },
          };
        }
        return { aiWorkflows };
      });
      return;
    }

    if (msg.msg === "step") {
      store.setState((state) => {
        const server = state.aiWorkflows[serverId] ?? {};
        const prev = server[msg.wid];
        const result = applyStepUpdate(prev, msg);
        if (!result) return state;
        return {
          aiWorkflows: {
            ...state.aiWorkflows,
            [serverId]: { ...server, [msg.wid]: result.workflow },
          },
        };
      });
      return;
    }

    // "action" messages echoed back from a bot are rare; ignore here.
  };

  ircClient.on("TAGMSG", ({ serverId, mtags, sender, channelName }) => {
    handleTaggedMessage({
      serverId,
      mtags,
      sender,
      target: channelName,
      fromPrivmsg: false,
    });
  });

  // PRIVMSG carrying the ai-tools tag is the bot's final response. We do
  // NOT suppress it from chat -- the user wants to see the answer -- but
  // we mirror its workflow-state update into the workflow record so the
  // card reflects the same lifecycle, and we record the message's msgid
  // so the card can deep-link to it.
  ircClient.on(
    "CHANMSG",
    ({ serverId, mtags, sender, channelName, message }) => {
      handleTaggedMessage({
        serverId,
        mtags,
        sender,
        target: channelName,
        fromPrivmsg: true,
        body: message,
      });
    },
  );
  ircClient.on("USERMSG", ({ serverId, mtags, sender, target, message }) => {
    handleTaggedMessage({
      serverId,
      mtags,
      sender,
      target,
      fromPrivmsg: true,
      body: message,
    });
  });
}
