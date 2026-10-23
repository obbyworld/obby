import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  type CompletionProvider,
  useCompletion,
} from "../../src/hooks/useCompletion";

const nicks = ["alice", "albert", "bob"];

const fromProvider: CompletionProvider<string> = {
  title: "People",
  match: (text, caret) => {
    const match = /from:(\S*)$/.exec(text.slice(0, caret));
    if (!match) return null;
    return { query: match[1], start: match.index, end: caret };
  },
  getItems: (query) => nicks.filter((nick) => nick.startsWith(query)),
  getKey: (nick) => nick,
  renderItem: (nick) => nick,
  accept: (nick) => `from:${nick} `,
};

const press = (key: string, shiftKey = false) =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey }));
  });

const wordProvider = (
  overrides: Partial<CompletionProvider<string>> = {},
): CompletionProvider<string> => ({
  title: "Nicks",
  manual: true,
  cycleKeys: ["Tab"],
  match: (text, caret) => {
    const word = text.slice(0, caret).split(" ").pop() ?? "";
    return word
      ? { query: word, start: caret - word.length, end: caret }
      : null;
  },
  getItems: (query) => nicks.filter((nick) => nick.startsWith(query)),
  getKey: (nick) => nick,
  renderItem: (nick) => nick,
  accept: (nick) => `${nick} `,
  ...overrides,
});

function useControlledCompletion(
  providers: CompletionProvider<string>[],
  initial: string,
) {
  const [input, setInput] = useState({ text: initial, caret: initial.length });
  const completion = useCompletion({
    providers,
    text: input.text,
    caret: input.caret,
    onReplace: (text, caret) => setInput({ text, caret }),
  });
  return { completion, input, setInput };
}

function cycleTab(
  result: { current: ReturnType<typeof useControlledCompletion> },
  step: 1 | -1 = 1,
) {
  return act(() => {
    const { input, completion } = result.current;
    completion.cycle(input.text, input.caret, step);
  });
}

describe("useCompletion", () => {
  it("matches only where the provider triggers", () => {
    const { result, rerender } = renderHook(
      ({ text }) =>
        useCompletion({
          providers: [fromProvider],
          text,
          caret: text.length,
          onReplace: vi.fn(),
        }),
      { initialProps: { text: "hello" } },
    );
    expect(result.current.isOpen).toBe(false);
    rerender({ text: "hello from:al" });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.items).toEqual(["alice", "albert"]);
  });

  it("replaces just the matched range on Enter and on pick", () => {
    const onReplace = vi.fn();
    const text = "deploy from:al";
    const { result } = renderHook(() =>
      useCompletion({
        providers: [fromProvider],
        text: `${text} now`,
        caret: text.length,
        onReplace,
      }),
    );
    press("ArrowDown");
    press("Enter");
    expect(onReplace).toHaveBeenLastCalledWith(
      "deploy from:albert  now",
      "deploy from:albert ".length,
    );
    act(() => result.current.pick("alice"));
    expect(onReplace).toHaveBeenLastCalledWith(
      "deploy from:alice  now",
      "deploy from:alice ".length,
    );
  });

  it("hides on Escape until the text changes", () => {
    const { result, rerender } = renderHook(
      ({ text }) =>
        useCompletion({
          providers: [fromProvider],
          text,
          caret: text.length,
          onReplace: vi.fn(),
        }),
      { initialProps: { text: "from:a" } },
    );
    press("Escape");
    expect(result.current.isOpen).toBe(false);
    rerender({ text: "from:al" });
    expect(result.current.isOpen).toBe(true);
  });

  it("accepts with the provider's own keys", () => {
    const onReplace = vi.fn();
    renderHook(() =>
      useCompletion({
        providers: [{ ...fromProvider, acceptKeys: ["Tab"] }],
        text: "from:bo",
        caret: 7,
        onReplace,
      }),
    );
    press("Tab");
    expect(onReplace).toHaveBeenCalledWith("from:bob ", 9);
  });
});

describe("useCompletion cycling", () => {
  it("keeps manual providers closed while typing and writes each step", () => {
    const { result } = renderHook(() =>
      useControlledCompletion([wordProvider()], "hi al"),
    );
    expect(result.current.completion.isOpen).toBe(false);

    cycleTab(result);
    expect(result.current.input.text).toBe("hi alice ");
    expect(result.current.completion.isOpen).toBe(true);

    cycleTab(result);
    expect(result.current.input.text).toBe("hi albert ");
    cycleTab(result);
    expect(result.current.input.text).toBe("hi alice ");
  });

  it("steps with the cycle key, backwards with Shift, and previews arrow moves", () => {
    const { result } = renderHook(() =>
      useControlledCompletion([wordProvider()], "al"),
    );
    cycleTab(result);
    press("Tab");
    expect(result.current.input.text).toBe("albert ");
    press("Tab", true);
    expect(result.current.input.text).toBe("alice ");
    press("ArrowDown");
    expect(result.current.input.text).toBe("albert ");
    expect(result.current.completion.selectedIndex).toBe(1);
  });

  it("starts from the last candidate when the first step goes backwards", () => {
    const { result } = renderHook(() =>
      useControlledCompletion([wordProvider()], "al"),
    );
    cycleTab(result, -1);
    expect(result.current.input.text).toBe("albert ");
  });

  it("fills the input quietly on the first step and shows the list from the second", () => {
    const { result } = renderHook(() =>
      useControlledCompletion([wordProvider({ quietFirstStep: true })], "al"),
    );
    cycleTab(result);
    expect(result.current.input.text).toBe("alice ");
    expect(result.current.completion.isOpen).toBe(false);
    press("Enter");
    expect(result.current.input.text).toBe("alice ");

    cycleTab(result);
    expect(result.current.input.text).toBe("albert ");
    expect(result.current.completion.isOpen).toBe(true);
  });

  it("ends the cycle on Enter, on Escape, and on an edit it did not write", () => {
    const { result } = renderHook(() =>
      useControlledCompletion([wordProvider()], "al"),
    );
    cycleTab(result);
    press("Enter");
    expect(result.current.completion.isOpen).toBe(false);
    expect(result.current.input.text).toBe("alice ");

    act(() => result.current.setInput({ text: "al", caret: 2 }));
    cycleTab(result);
    press("Escape");
    expect(result.current.completion.isOpen).toBe(false);
    expect(result.current.input.text).toBe("alice ");

    act(() => result.current.setInput({ text: "al", caret: 2 }));
    cycleTab(result);
    act(() => result.current.setInput({ text: "alice x", caret: 7 }));
    expect(result.current.completion.isOpen).toBe(false);
  });

  it("stops at the first manual provider that matches, even with nothing to offer", () => {
    const emptyColon = wordProvider({
      match: (text, caret) =>
        text.slice(0, caret).endsWith(":")
          ? { query: "", start: caret - 1, end: caret }
          : null,
      getItems: () => [],
    });
    const { result } = renderHook(() =>
      useControlledCompletion([emptyColon, wordProvider()], "al:"),
    );
    let wrote = true;
    act(() => {
      wrote = result.current.completion.cycle("al:", 3);
    });
    expect(wrote).toBe(false);
    expect(result.current.input.text).toBe("al:");
  });
});
