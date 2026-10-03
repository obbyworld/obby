// draft/bot-tools — IRCv3 "Bot Tools" workflow transparency.
//
// All workflow state rides in a single client-only tag whose value is the
// base64 (RFC 4648 §4, with padding) of the compact JSON body. base64 is used
// because its alphabet never collides with IRCv3 tag-value escaping, so no
// escape pass is needed on the wire in either direction.
//
// The tag name is fixed across all message kinds. The discriminator lives
// in the JSON body as the `msg` field.

import type { AiStep } from "../store";
import { base64DecodeUtf8, base64EncodeUtf8 } from "./base64";

export const BOT_TOOLS_TAG = "+draft/bot-tools";
export const BOT_TOOLS_CAP = "draft/bot-tools";

// After this much elapsed time without a terminal state, a workflow is
// shown as timed out so a stuck card doesn't sit "running" forever.
export const WORKFLOW_TIMEOUT_MS = 10 * 60 * 1000;

export type AiWorkflowState =
  | "start"
  | "reasoning"
  | "running"
  | "complete"
  | "failed"
  | "cancelled";

/** True when the workflow is in a state the bot will not advance from. */
export function isTerminalState(state: AiWorkflowState): boolean {
  return state === "complete" || state === "failed" || state === "cancelled";
}

/** True when the workflow has been open longer than WORKFLOW_TIMEOUT_MS
 *  and has not reached a terminal state. */
export function isStale(
  workflow: { state: AiWorkflowState; startedAt: number },
  now: number = Date.now(),
): boolean {
  if (isTerminalState(workflow.state)) return false;
  return now - workflow.startedAt > WORKFLOW_TIMEOUT_MS;
}

/** Effective state for UI: the wire state if terminal, "failed" when
 *  stale, else the wire state. */
export function effectiveWorkflowState(
  workflow: { state: AiWorkflowState; startedAt: number },
  now: number = Date.now(),
): AiWorkflowState {
  if (isStale(workflow, now)) return "failed";
  return workflow.state;
}

// Behaviours a bot advertises on its workflow `start` message so a client can
// show the right controls before any step arrives.
export type AiWorkflowFeature = "interactive" | "reasoning" | "approval";

export type AiStepType = "reasoning" | "tool-call" | "tool-result" | "text";

export type AiStepState =
  | "start"
  | "running"
  | "pending-approval"
  | "complete"
  | "failed"
  | "cancelled";

export type AiActionType = "cancel" | "approve" | "reject" | "input";

export interface AiWorkflowMessage {
  msg: "workflow";
  id: string;
  state: AiWorkflowState;
  name?: string;
  trigger?: string;
  features?: AiWorkflowFeature[];
  // Short truncated copy of the prompt that started the workflow. A bot-neutral
  // hint, not part of the spec: lets a client show "Answering <nick>:
  // <prompt excerpt>" inline on the workflow card without scrolling back to the
  // trigger message. Decoders ignore it if absent.
  prompt?: string;
  "cancelled-by"?: string;
}

export interface AiStepMessage {
  msg: "step";
  wid: string;
  sid: string;
  type: AiStepType;
  state: AiStepState;
  tool?: string;
  label?: string;
  // For tool-call: nested JSON object of arguments. Other types: string fragment.
  content?: unknown;
  truncated?: boolean;
  "cancelled-by"?: string;
}

export interface AiActionMessage {
  msg: "action";
  action: AiActionType;
  target: string;
  content?: string;
}

export type BotToolsMessage =
  | AiWorkflowMessage
  | AiStepMessage
  | AiActionMessage;

const WORKFLOW_STATES: ReadonlySet<AiWorkflowState> = new Set([
  "start",
  "reasoning",
  "running",
  "complete",
  "failed",
  "cancelled",
]);
const STEP_TYPES: ReadonlySet<AiStepType> = new Set([
  "reasoning",
  "tool-call",
  "tool-result",
  "text",
]);
const STEP_STATES: ReadonlySet<AiStepState> = new Set([
  "start",
  "running",
  "pending-approval",
  "complete",
  "failed",
  "cancelled",
]);
const ACTION_TYPES: ReadonlySet<AiActionType> = new Set([
  "cancel",
  "approve",
  "reject",
  "input",
]);

// Decode a raw tag value (base64 of compact JSON) into a structured message.
// Returns null on any decode/parse failure or schema mismatch rather than
// throwing, per spec §Security: malformed or oversized payloads are silently
// discarded.
export function decodeBotToolsValue(raw: string): BotToolsMessage | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64DecodeUtf8(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  switch (obj.msg) {
    case "workflow": {
      if (
        typeof obj.id !== "string" ||
        typeof obj.state !== "string" ||
        !WORKFLOW_STATES.has(obj.state as AiWorkflowState)
      )
        return null;
      const m: AiWorkflowMessage = {
        msg: "workflow",
        id: obj.id,
        state: obj.state as AiWorkflowState,
      };
      if (typeof obj.name === "string") m.name = obj.name;
      if (typeof obj.trigger === "string") m.trigger = obj.trigger;
      if (Array.isArray(obj.features))
        m.features = obj.features.filter(
          (f): f is AiWorkflowFeature => typeof f === "string",
        ) as AiWorkflowFeature[];
      if (typeof obj.prompt === "string") m.prompt = obj.prompt;
      if (typeof obj["cancelled-by"] === "string")
        m["cancelled-by"] = obj["cancelled-by"] as string;
      return m;
    }
    case "step": {
      if (
        typeof obj.wid !== "string" ||
        typeof obj.sid !== "string" ||
        typeof obj.type !== "string" ||
        typeof obj.state !== "string" ||
        !STEP_TYPES.has(obj.type as AiStepType) ||
        !STEP_STATES.has(obj.state as AiStepState)
      )
        return null;
      const m: AiStepMessage = {
        msg: "step",
        wid: obj.wid,
        sid: obj.sid,
        type: obj.type as AiStepType,
        state: obj.state as AiStepState,
      };
      if (typeof obj.tool === "string") m.tool = obj.tool;
      if (typeof obj.label === "string") m.label = obj.label;
      if (obj.content !== undefined) m.content = obj.content;
      if (typeof obj.truncated === "boolean") m.truncated = obj.truncated;
      if (typeof obj["cancelled-by"] === "string")
        m["cancelled-by"] = obj["cancelled-by"] as string;
      return m;
    }
    case "action": {
      if (
        typeof obj.action !== "string" ||
        typeof obj.target !== "string" ||
        !ACTION_TYPES.has(obj.action as AiActionType)
      )
        return null;
      const m: AiActionMessage = {
        msg: "action",
        action: obj.action as AiActionType,
        target: obj.target,
      };
      if (typeof obj.content === "string") m.content = obj.content;
      return m;
    }
    default:
      return null;
  }
}

// base64 of compact JSON (no whitespace), per spec §Value Encoding.
export function encodeBotToolsValue(msg: BotToolsMessage): string {
  return base64EncodeUtf8(JSON.stringify(msg));
}

export type StepGroup =
  | { kind: "single"; key: string; step: AiStep }
  | { kind: "tool-pair"; key: string; call?: AiStep; result?: AiStep };

// We pair each tool call with the next unpaired result of the same tool, in
// arrival order, so one tool invocation reads as one step.
export function groupWorkflowSteps(steps: readonly AiStep[]): StepGroup[] {
  const groups: StepGroup[] = [];
  const paired = new Set<number>();
  steps.forEach((step, i) => {
    if (paired.has(i)) return;
    if (step.type === "tool-call") {
      const j = steps.findIndex(
        (other, k) =>
          k > i &&
          !paired.has(k) &&
          other.type === "tool-result" &&
          other.tool === step.tool,
      );
      if (j !== -1) paired.add(j);
      groups.push({
        kind: "tool-pair",
        key: step.sid,
        call: step,
        result: j === -1 ? undefined : steps[j],
      });
    } else if (step.type === "tool-result") {
      groups.push({ kind: "tool-pair", key: step.sid, result: step });
    } else {
      groups.push({ kind: "single", key: step.sid, step });
    }
  });
  return groups;
}

export const stepGroupSteps = (group: StepGroup): AiStep[] =>
  group.kind === "single"
    ? [group.step]
    : [group.call, group.result].filter((s): s is AiStep => !!s);

export const stepGroupState = (group: StepGroup): AiStep["state"] =>
  stepGroupSteps(group).at(-1)?.state ?? "running";

const SETTLED_STEP_STATES: ReadonlySet<AiStep["state"]> = new Set([
  "complete",
  "failed",
  "cancelled",
  "pending-approval",
]);

export const isStepGroupRunning = (group: StepGroup): boolean =>
  !SETTLED_STEP_STATES.has(stepGroupState(group));

// Reasoning is the bot planning, so we leave it out of the user-facing count.
export function countableSteps(steps: readonly AiStep[]): number {
  return groupWorkflowSteps(steps).filter(
    (group) => !(group.kind === "single" && group.step.type === "reasoning"),
  ).length;
}

// IRC tag-value escape — applied just before putting the value on the
// wire. Mirrors the unescape in src/lib/ircUtils.tsx.
export function escapeIrcTagValue(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    switch (c) {
      case "\\":
        out += "\\\\";
        break;
      case ";":
        out += "\\:";
        break;
      case " ":
        out += "\\s";
        break;
      case "\r":
        out += "\\r";
        break;
      case "\n":
        out += "\\n";
        break;
      default:
        out += c;
        break;
    }
  }
  return out;
}
