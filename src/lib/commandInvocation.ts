import type { BotCommand, BotCommandOption, Channel, User } from "../types";

export type CommandArgValues = Record<string, string>;

export type OptionValue = string | number | boolean;

const WHOLE_NUMBER = /^-?\d+$/;
const TRUTHY_WORDS = new Set(["true", "1", "yes", "on"]);
const MAX_ARG_CHOICES = 20;

export interface CommandArgError {
  kind: "required" | "int" | "number" | "unsent";
  name: string;
}

export interface CommandInvocation {
  botNick: string;
  command: BotCommand;
  values: CommandArgValues;
  active: number;
  error?: CommandArgError;
}

type CommandPayloadResult =
  | { payload: Record<string, OptionValue> }
  | { error: CommandArgError };

export function argChoices(
  option: BotCommandOption,
  users: readonly User[],
  channels: readonly Channel[],
): string[] {
  if (option.choices?.length) return option.choices;
  if (option.type === "user") return users.map((u) => u.username);
  if (option.type === "channel") return channels.map((c) => c.name);
  return [];
}

// A value that already names a choice is complete, so we stop offering choices.
export function matchChoices(choices: string[], typed: string): string[] {
  const needle = typed.trim().toLowerCase();
  if (choices.some((c) => c.toLowerCase() === needle)) return [];
  return choices
    .filter((c) => c.toLowerCase().includes(needle))
    .slice(0, MAX_ARG_CHOICES);
}

export function needsArguments(command: BotCommand): boolean {
  return (command.options?.length ?? 0) > 0;
}

export function coerceOptionValue(
  type: BotCommandOption["type"],
  raw: string,
): OptionValue | undefined {
  if (type === "int")
    return WHOLE_NUMBER.test(raw) ? Number.parseInt(raw, 10) : undefined;
  if (type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === "bool") return TRUTHY_WORDS.has(raw.toLowerCase());
  return raw;
}

export function buildCommandPayload(
  options: BotCommandOption[],
  values: CommandArgValues,
): CommandPayloadResult {
  const payload: Record<string, OptionValue> = {};
  for (const o of options) {
    const raw = (values[o.name] ?? "").trim();
    if (raw === "") {
      if (o.required) return { error: { kind: "required", name: o.name } };
      continue;
    }
    const value = coerceOptionValue(o.type, raw);
    if (value === undefined)
      return {
        error: { kind: o.type === "int" ? "int" : "number", name: o.name },
      };
    payload[o.name] = value;
  }
  return { payload };
}

export function backspaceCancels(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): boolean {
  return value === "" && selectionStart === 0 && selectionEnd === 0;
}
