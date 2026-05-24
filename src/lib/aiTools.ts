// draft/ai-tools v0.4 — see doc/draft-ai-tools.md
//
// Server-side IRCv3 tag-value escaping (\\, \:, \s, \r, \n, \0) is already
// reversed by parseMessageTags in ircUtils.tsx by the time these payloads
// reach us, so decoding here is just JSON.parse on the unescaped string.
// Encoding is the inverse: JSON.stringify, then let the tag-emission path
// escape on the wire.
//
// The tag name is fixed across all message kinds. The discriminator lives
// in the JSON body as the `msg` field.

export const AI_TOOLS_TAG = "+obby.world/ai-tools";
export const AI_TOOLS_CAP = "draft/ai-tools";

export type AiWorkflowState =
  | "start"
  | "thinking"
  | "running"
  | "complete"
  | "failed"
  | "cancelled";

export type AiStepType = "thinking" | "tool-call" | "tool-result" | "text";

export type AiStepState =
  | "start"
  | "running"
  | "pending-approval"
  | "complete"
  | "failed"
  | "cancelled";

export type AiActionType = "cancel" | "approve" | "reject" | "steer";

export interface AiWorkflowMessage {
  msg: "workflow";
  id: string;
  state: AiWorkflowState;
  name?: string;
  trigger?: string;
  // Short truncated copy of the prompt that started the workflow.
  // Non-standard but useful: lets clients show "Answering <nick>:
  // <prompt excerpt>" inline on the workflow card without scrolling
  // back to the trigger message.
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
}

export interface AiActionMessage {
  msg: "action";
  action: AiActionType;
  target: string;
  content?: string;
}

export type AiToolsMessage =
  | AiWorkflowMessage
  | AiStepMessage
  | AiActionMessage;

// Decode a raw tag value (already IRC-unescaped by parseMessageTags) into a
// structured message. Returns null on any parse failure or schema mismatch
// rather than throwing, per spec §Security: malformed payloads are silently
// discarded.
export function decodeAiToolsValue(raw: string): AiToolsMessage | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  switch (obj.msg) {
    case "workflow": {
      if (typeof obj.id !== "string" || typeof obj.state !== "string")
        return null;
      const m: AiWorkflowMessage = {
        msg: "workflow",
        id: obj.id,
        state: obj.state as AiWorkflowState,
      };
      if (typeof obj.name === "string") m.name = obj.name;
      if (typeof obj.trigger === "string") m.trigger = obj.trigger;
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
        typeof obj.state !== "string"
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
      return m;
    }
    case "action": {
      if (typeof obj.action !== "string" || typeof obj.target !== "string")
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

// Compact JSON (no whitespace), per spec §Value Encoding. The IRC-tag
// escape pass happens at the wire-emission layer.
export function encodeAiToolsValue(msg: AiToolsMessage): string {
  return JSON.stringify(msg);
}

// User-facing step count: "thinking" frames don't count (they're the
// model muttering, not work), and a tool-call + matching tool-result
// pair counts as a single step (they're the two sides of one tool
// invocation, paired FIFO by tool name).
export function countableSteps(
  steps: readonly { type: string; tool?: string }[],
): number {
  const paired = new Set<number>();
  let count = 0;
  for (let i = 0; i < steps.length; i++) {
    if (paired.has(i)) continue;
    const s = steps[i];
    if (s.type === "thinking") continue;
    if (s.type === "tool-call") {
      for (let j = i + 1; j < steps.length; j++) {
        if (paired.has(j)) continue;
        const t = steps[j];
        if (t.type === "tool-result" && t.tool === s.tool) {
          paired.add(j);
          break;
        }
      }
      count++;
      continue;
    }
    count++;
  }
  return count;
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
