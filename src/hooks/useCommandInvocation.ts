import { type RefObject, useCallback, useRef, useState } from "react";
import type { CommandArgsStripProps } from "../components/chat/CommandArgsStrip";
import {
  backspaceCancels,
  buildCommandPayload,
  type CommandArgValues,
  type CommandInvocation,
  needsArguments,
  visibleOptions,
} from "../lib/commandInvocation";
import type { BotCommand, Channel } from "../types";
import { sendBotCommand } from "./useMessageSending";

interface UseCommandInvocationOptions {
  serverId: string | null;
  channel: Channel | null;
  textRef: RefObject<string>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  applyText: (text: string) => void;
  onBegin: () => void;
}

export function useCommandInvocation({
  serverId,
  channel,
  textRef,
  inputRef,
  applyText,
  onBegin,
}: UseCommandInvocationOptions) {
  const [invocation, setInvocation] = useState<CommandInvocation | null>(null);
  const stashedDraft = useRef<string | null>(null);

  const params = invocation
    ? visibleOptions(invocation.command.options ?? [], invocation.added)
    : [];

  const commitActive = (inv: CommandInvocation): CommandArgValues => {
    const name = params[inv.active]?.name;
    return name === undefined
      ? inv.values
      : { ...inv.values, [name]: textRef.current };
  };

  const finish = () => {
    setInvocation(null);
    applyText(stashedDraft.current ?? "");
    stashedDraft.current = null;
    inputRef.current?.focus();
  };

  const begin = useCallback(
    (botNick: string, command: BotCommand) => {
      if (!serverId) return;
      if (!needsArguments(command)) {
        sendBotCommand(serverId, channel, botNick, command, {});
        return;
      }
      if (stashedDraft.current === null) {
        const typed = textRef.current;
        stashedDraft.current = typed.startsWith("/") ? "" : typed;
      }
      applyText("");
      onBegin();
      setInvocation({ botNick, command, values: {}, active: 0, added: [] });
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

  const clearError = () => {
    if (invocation?.error) setInvocation({ ...invocation, error: undefined });
  };

  const select = (index: number) => {
    if (!invocation || !params[index]) return;
    const values = commitActive(invocation);
    setInvocation({ ...invocation, values, active: index, error: undefined });
    applyText(values[params[index].name] ?? "");
    inputRef.current?.focus();
  };

  const addOption = () => {
    if (!invocation) return;
    const options = invocation.command.options ?? [];
    const next = options.find((o) => !params.includes(o));
    if (!next) return;
    const added = [...invocation.added, next.name];
    setInvocation({
      ...invocation,
      added,
      values: commitActive(invocation),
      active: visibleOptions(options, added).indexOf(next),
      error: undefined,
    });
    applyText("");
    inputRef.current?.focus();
  };

  const run = () => {
    if (!invocation || !serverId) return;
    const values = commitActive(invocation);
    const result = buildCommandPayload(
      invocation.command.options ?? [],
      values,
    );
    if ("error" in result) {
      const active = Math.max(
        params.findIndex((p) => p.name === result.error.name),
        0,
      );
      setInvocation({ ...invocation, values, active, error: result.error });
      applyText(values[params[active].name] ?? "");
      return;
    }
    sendBotCommand(
      serverId,
      channel,
      invocation.botNick,
      invocation.command,
      result.payload,
    );
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
    } else if (e.key === "Tab" && params.length > 1) {
      e.preventDefault();
      select(
        (invocation.active + (e.shiftKey ? -1 : 1) + params.length) %
          params.length,
      );
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

  const strip: CommandArgsStripProps | null = invocation && {
    command: invocation.command,
    params,
    active: invocation.active,
    values: invocation.values,
    hiddenCount: (invocation.command.options?.length ?? 0) - params.length,
    error: invocation.error,
    onSelect: select,
    onAddOption: addOption,
    onCancel: finish,
  };

  return {
    invocation,
    strip,
    activeName: invocation ? params[invocation.active]?.name : undefined,
    begin,
    leave,
    clearError,
    run,
    handleKey,
  };
}
