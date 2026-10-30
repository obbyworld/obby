import { act, renderHook } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCommandInvocation } from "../../src/hooks/useCommandInvocation";
import type { BotCommand, Channel } from "../../src/types";

const sendBotCommand = vi.hoisted(() => vi.fn());
const onRun = vi.fn();
vi.mock("../../src/hooks/useMessageSending", () => ({ sendBotCommand }));

const say: BotCommand = {
  name: "say",
  options: [
    { name: "channel", type: "channel" },
    { name: "message", required: true },
  ],
};
const channels = [{ name: "#dev" }, { name: "#ops" }] as Channel[];

function setup() {
  const input = document.createElement("textarea");
  const textRef = { current: "" };
  const applyText = (text: string) => {
    textRef.current = text;
    input.value = text;
  };
  const hook = renderHook(() =>
    useCommandInvocation({
      serverId: "srv",
      channel: null,
      channels,
      textRef,
      inputRef: { current: input },
      applyText,
      onBegin: () => {},
      onRun,
    }),
  );
  const type = (text: string) =>
    act(() => {
      applyText(text);
      hook.result.current.onInput(text);
    });
  const key = (k: string, shiftKey = false) => {
    const preventDefault = vi.fn();
    act(() => {
      hook.result.current.handleKey({
        key: k,
        shiftKey,
        preventDefault,
        nativeEvent: { isComposing: false },
      } as unknown as React.KeyboardEvent);
    });
  };
  const pressOnDocument = (k: string) =>
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, cancelable: true }),
      );
    });
  return { hook, input, type, key, pressOnDocument };
}

describe("useCommandInvocation", () => {
  beforeEach(() => {
    sendBotCommand.mockReset().mockReturnValue(true);
    onRun.mockClear();
  });

  it("sends a command without options at once", () => {
    const { hook } = setup();
    act(() =>
      hook.result.current.begin("bot", { name: "aimodels", options: [] }),
    );
    expect(sendBotCommand).toHaveBeenCalledWith(
      "srv",
      null,
      "bot",
      { name: "aimodels", options: [] },
      {},
    );
    expect(onRun).toHaveBeenCalledWith({
      botNick: "bot",
      command: { name: "aimodels", options: [] },
      values: {},
    });
    expect(hook.result.current.invocation).toBeNull();
  });

  it("leaves a command the bot cannot take here out of the history", () => {
    sendBotCommand.mockReturnValue(false);
    const { hook } = setup();
    act(() =>
      hook.result.current.begin("bot", { name: "aimodels", options: [] }),
    );
    expect(onRun).not.toHaveBeenCalled();
  });

  it("opens a recalled command without options and sends it on Enter", () => {
    const { hook, key } = setup();
    const aimodels = { name: "aimodels", options: [] };
    act(() => hook.result.current.begin("bot", aimodels, {}, true));
    expect(sendBotCommand).not.toHaveBeenCalled();
    expect(hook.result.current.invocation?.command).toBe(aimodels);
    key("Enter");
    expect(sendBotCommand).toHaveBeenCalledWith(
      "srv",
      null,
      "bot",
      aimodels,
      {},
    );
  });

  it("moves to the next argument on Tab and back on Shift+Tab", () => {
    const { hook, input, type, key } = setup();
    act(() => hook.result.current.begin("bot", say));
    type("x");
    key("Tab");
    expect(hook.result.current.activeParam?.name).toBe("message");
    expect(input.value).toBe("");
    key("Tab", true);
    expect(hook.result.current.activeParam?.name).toBe("channel");
    expect(input.value).toBe("x");
  });

  it("picks the highlighted choice and moves on", () => {
    const { hook, type, pressOnDocument } = setup();
    act(() => hook.result.current.begin("bot", say));
    type("op");
    expect(hook.result.current.choices).toEqual(["#ops"]);
    pressOnDocument("Tab");
    expect(hook.result.current.invocation?.values.channel).toBe("#ops");
    expect(hook.result.current.activeParam?.name).toBe("message");
  });

  it("goes back a field on Backspace in an empty field, then cancels", () => {
    const { hook, key } = setup();
    act(() => hook.result.current.begin("bot", say));
    key("Tab");
    key("Backspace");
    expect(hook.result.current.activeParam?.name).toBe("channel");
    key("Backspace");
    expect(hook.result.current.invocation).toBeNull();
  });

  it("focuses the missing required argument on Enter, then sends", () => {
    const { hook, type, key } = setup();
    act(() => hook.result.current.begin("bot", say));
    key("Enter");
    expect(sendBotCommand).not.toHaveBeenCalled();
    expect(hook.result.current.activeParam?.name).toBe("message");
    expect(hook.result.current.invocation?.error?.kind).toBe("required");
    type("hello");
    key("Enter");
    expect(sendBotCommand).toHaveBeenCalledWith("srv", null, "bot", say, {
      message: "hello",
    });
    expect(onRun).toHaveBeenCalledWith({
      botNick: "bot",
      command: say,
      values: { message: "hello" },
    });
  });

  it("reopens with the values of an earlier run", () => {
    const { hook, input } = setup();
    act(() =>
      hook.result.current.begin("bot", say, {
        channel: "#dev",
        message: "hi",
      }),
    );
    expect(input.value).toBe("#dev");
    expect(hook.result.current.invocation?.values.message).toBe("hi");
    expect(sendBotCommand).not.toHaveBeenCalled();
  });
});
