import {
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  argChoices,
  backspaceCancels,
  buildCommandPayload,
  type CommandArgValues,
  type CommandInvocation,
  matchChoices,
  needsArguments,
} from "../lib/commandInvocation";
import type { BotCommand, Channel } from "../types";
import type { BotCommandRun } from "./useMessageHistory";
import { sendBotCommand } from "./useMessageSending";
import { useSuggestionKeys } from "./useSuggestionKeys";

interface UseCommandInvocationOptions {
  serverId: string | null;
  channel: Channel | null;
  channels: readonly Channel[];
  textRef: RefObject<string>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  applyText: (text: string) => void;
  onBegin: () => void;
  onRun: (run: BotCommandRun) => void;
}

const CHOICE_ACCEPT_KEYS = ["Tab", "Enter"];
const NO_KEYS: readonly string[] = [];

export function useCommandInvocation({
  serverId,
  channel,
  channels,
  textRef,
  inputRef,
  applyText,
  onBegin,
  onRun,
}: UseCommandInvocationOptions) {
  const [invocation, setInvocation] = useState<CommandInvocation | null>(null);
  const [highlight, setHighlight] = useState(0);
  const stashedDraft = useRef<string | null>(null);
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;

  const params = invocation?.command.options ?? [];
  const activeParam = invocation ? params[invocation.active] : undefined;
  const choices = activeParam
    ? matchChoices(
        argChoices(activeParam, channel?.users ?? [], channels),
        invocation?.values[activeParam.name] ?? "",
      )
    : [];

  const isInvoking = invocation !== null;
  // The field keeps the height it measured in the other layout unless we reset it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: we reset whenever the layout switches
  useLayoutEffect(() => {
    if (inputRef.current) inputRef.current.style.height = "";
  }, [isInvoking]);

  const finish = () => {
    setInvocation(null);
    applyText(stashedDraft.current ?? "");
    stashedDraft.current = null;
    inputRef.current?.focus();
  };

  const begin = useCallback(
    (
      botNick: string,
      command: BotCommand,
      values: CommandArgValues = {},
      isRecalled = false,
    ) => {
      if (!serverId) return;
      if (!needsArguments(command) && !isRecalled) {
        if (sendBotCommand(serverId, channel, botNick, command, {}))
          onRunRef.current({ botNick, command, values: {} });
        return;
      }
      if (stashedDraft.current === null) {
        const typed = textRef.current;
        stashedDraft.current = typed.startsWith("/") ? "" : typed;
      }
      applyText(values[command.options?.[0]?.name ?? ""] ?? "");
      onBegin();
      setHighlight(0);
      setInvocation({ botNick, command, values, active: 0 });
      inputRef.current?.focus();
    },
    [serverId, channel, textRef, inputRef, applyText, onBegin],
  );

  const leave = useCallback(() => {
    const draft = stashedDraft.current ?? textRef.current;
    stashedDraft.current = null;
    setInvocation(null);
    return draft;
  }, [textRef]);

  const onInput = (text: string) => {
    if (!activeParam || !invocation) return;
    setHighlight(0);
    setInvocation({
      ...invocation,
      values: { ...invocation.values, [activeParam.name]: text },
      error: undefined,
    });
  };

  const moveTo = (
    inv: CommandInvocation,
    index: number,
    error?: CommandInvocation["error"],
  ) => {
    setHighlight(0);
    setInvocation({ ...inv, active: index, error });
    applyText(inv.values[params[index].name] ?? "");
    inputRef.current?.focus();
  };

  const select = (index: number) => {
    if (invocation && params[index]) moveTo(invocation, index);
  };

  const step = (by: 1 | -1) => {
    if (invocation && params.length > 1)
      moveTo(
        invocation,
        (invocation.active + by + params.length) % params.length,
      );
  };

  const pickChoice = (choice: string) => {
    if (!invocation || !activeParam) return;
    const picked = {
      ...invocation,
      values: { ...invocation.values, [activeParam.name]: choice },
    };
    if (invocation.active < params.length - 1)
      moveTo(picked, invocation.active + 1);
    else {
      setInvocation(picked);
      applyText(choice);
    }
  };

  useSuggestionKeys({
    isActive: invocation !== null,
    count: choices.length,
    selectedIndex: highlight,
    onMove: setHighlight,
    onAccept: (index, e) => {
      if (e.key === "Tab" && e.shiftKey) return false;
      pickChoice(choices[index]);
      return true;
    },
    onClose: finish,
    acceptKeys: CHOICE_ACCEPT_KEYS,
    closeKeys: NO_KEYS,
  });

  const run = () => {
    if (!invocation || !serverId) return;
    const result = buildCommandPayload(params, invocation.values);
    if ("error" in result) {
      const active = Math.max(
        params.findIndex((p) => p.name === result.error.name),
        0,
      );
      moveTo(invocation, active, result.error);
      return;
    }
    const isSent = sendBotCommand(
      serverId,
      channel,
      invocation.botNick,
      invocation.command,
      result.payload,
    );
    if (!isSent) {
      setInvocation({
        ...invocation,
        error: {
          kind: "unsent",
          name: activeParam?.name ?? invocation.command.name,
        },
      });
      return;
    }
    onRun({
      botNick: invocation.botNick,
      command: invocation.command,
      values: invocation.values,
    });
    finish();
  };

  const handleKey = (e: React.KeyboardEvent): boolean => {
    if (!invocation) return false;
    if (e.nativeEvent.isComposing) return true;
    const input = inputRef.current;
    if (e.key === "Enter") {
      e.preventDefault();
      run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish();
    } else if (e.key === "Tab") {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (
      e.key === "Backspace" &&
      input &&
      backspaceCancels(input.value, input.selectionStart, input.selectionEnd)
    ) {
      e.preventDefault();
      if (invocation.active > 0) select(invocation.active - 1);
      else finish();
    }
    return true;
  };

  return {
    invocation,
    params,
    activeParam,
    choices,
    highlight,
    setHighlight,
    pickChoice,
    begin,
    leave,
    onInput,
    select,
    run,
    cancel: finish,
    handleKey,
  };
}
