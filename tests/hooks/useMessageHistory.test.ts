import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  recordSentInput,
  useMessageHistory,
} from "../../src/hooks/useMessageHistory";

function walk(bufferKey: string, keys: ("up" | "down")[]) {
  const { result } = renderHook(() => useMessageHistory(bufferKey));
  return keys.map((key) => {
    let text: string | null = null;
    act(() => {
      text =
        key === "up"
          ? result.current.navigateUp()
          : result.current.navigateDown();
    });
    return text;
  });
}

describe("useMessageHistory", () => {
  it("recalls typed input and commands per buffer, newest first, back to an empty composer", () => {
    recordSentInput("s-#a", "hello");
    recordSentInput("s-#a", "/join #b");
    recordSentInput("s-#a", "/join #b");
    recordSentInput("s-#a", "   ");
    recordSentInput("s-#other", "elsewhere");
    expect(walk("s-#a", ["up", "up", "up", "down", "down"])).toEqual([
      "/join #b",
      "hello",
      "hello",
      "/join #b",
      "",
    ]);
  });

  it("recalls input sent after the last render", () => {
    const { result } = renderHook(() => useMessageHistory("s-#late"));
    recordSentInput("s-#late", "/whois someone");
    let recalled: string | null = null;
    act(() => {
      recalled = result.current.navigateUp();
    });
    expect(recalled).toBe("/whois someone");
  });

  it("skips lines that can carry a password", () => {
    for (const line of [
      "/oper admin hunter2",
      "/ns identify hunter2",
      "/msg NickServ IDENTIFY hunter2",
      "/PASS hunter2",
      "/quote PASS hunter2",
    ])
      recordSentInput("s-#secret", line);
    recordSentInput("s-nickserv", "IDENTIFY hunter2", "NickServ");
    expect(walk("s-nickserv", ["up"])).toEqual([null]);
    recordSentInput("s-#secret", "/msg friend hi");
    expect(walk("s-#secret", ["up", "up"])).toEqual([
      "/msg friend hi",
      "/msg friend hi",
    ]);
  });

  it("keeps the last 100 entries", () => {
    for (let i = 0; i < 150; i++) recordSentInput("s-#cap", `line ${i}`);
    const recalled = walk("s-#cap", Array(150).fill("up"));
    expect(recalled.at(-1)).toBe("line 50");
  });
});
