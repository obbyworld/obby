import type { AiStep, AiWorkflow } from "../store";

export type StepContent =
  | { kind: "json"; value: unknown; raw: string }
  | { kind: "text"; text: string; looksCut: boolean };

// Bots send tool output as JSON text, and a bot that trims it leaves JSON that
// no longer parses, which we report as cut off.
export function parseStepContent(content: unknown): StepContent {
  if (typeof content !== "string")
    return {
      kind: "json",
      value: content,
      raw: JSON.stringify(content, null, 2),
    };
  const trimmed = content.trim();
  const looksLikeJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  if (looksLikeJson) {
    try {
      const value: unknown = JSON.parse(trimmed);
      return { kind: "json", value, raw: JSON.stringify(value, null, 2) };
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return { kind: "text", text: content, looksCut: looksLikeJson };
}

// Pretty-prints JSON text that may stop mid-value, so we can still lay out a cut tool output.
export function indentPartialJson(text: string): string {
  let out = "";
  let depth = 0;
  let isInString = false;
  let isEscaped = false;
  const newline = () => `\n${"  ".repeat(depth)}`;
  for (const ch of text) {
    if (isInString) {
      out += ch;
      if (isEscaped) isEscaped = false;
      else if (ch === "\\") isEscaped = true;
      else if (ch === '"') isInString = false;
    } else if (ch === '"') {
      isInString = true;
      out += ch;
    } else if (ch === "{" || ch === "[") {
      depth++;
      out += ch + newline();
    } else if (ch === "}" || ch === "]") {
      depth = Math.max(0, depth - 1);
      out += newline() + ch;
    } else if (ch === ",") out += ch + newline();
    else if (ch === ":") out += ": ";
    else if (!/\s/.test(ch)) out += ch;
  }
  return out;
}

export function contentAsText(content: unknown): string {
  const parsed = parseStepContent(content);
  return parsed.kind === "json" ? parsed.raw : parsed.text;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// One line describing a tool call's arguments, like "id: 99 · type: job".
export function summarizeArguments(content: unknown): string {
  const parsed = parseStepContent(content);
  if (parsed.kind === "text") return parsed.text.replace(/\s+/g, " ");
  const value = parsed.value;
  if (value === null || typeof value !== "object") return String(value ?? "");
  return Object.entries(value)
    .filter(([, v]) => v === null || typeof v !== "object")
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ");
}

const contentValue = (content: unknown): unknown => {
  if (content === undefined) return undefined;
  const parsed = parseStepContent(content);
  return parsed.kind === "json" ? parsed.value : parsed.text;
};

const stepForExport = (step: AiStep) => ({
  type: step.type,
  tool: step.tool,
  label: step.label,
  state: step.state,
  content: contentValue(step.content),
  truncated: step.truncated,
});

export function workflowToJson(workflow: AiWorkflow): string {
  return JSON.stringify(
    {
      bot: workflow.senderNick,
      name: workflow.name,
      prompt: workflow.prompt,
      state: workflow.state,
      startedAt: new Date(workflow.startedAt).toISOString(),
      steps: workflow.steps.map(stepForExport),
    },
    null,
    2,
  );
}

export function workflowToText(workflow: AiWorkflow): string {
  const title = [workflow.senderNick, workflow.name]
    .filter(Boolean)
    .join(" · ");
  const lines = [title];
  if (workflow.prompt) lines.push(`> ${workflow.prompt}`);
  for (const step of workflow.steps) {
    lines.push(
      "",
      `## ${step.tool ?? step.label ?? step.type} (${step.type}, ${step.state})`,
    );
    if (step.content !== undefined) lines.push(contentAsText(step.content));
  }
  return lines.join("\n");
}
