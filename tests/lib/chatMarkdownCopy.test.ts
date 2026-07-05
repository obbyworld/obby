import { afterEach, describe, expect, test } from "vitest";
import {
  buildMarkdownFromSelection,
  formatCopyAuthor,
  type MessageCopyData,
  messageNodesInSelection,
  normalizeCopySource,
  readMessageCopyData,
  serializeMessagesToMarkdown,
} from "../../src/lib/chatMarkdownCopy";

const msg = (
  author: string,
  time: string,
  source: string,
): MessageCopyData => ({ author, time, source });

describe("formatCopyAuthor", () => {
  test("uses the bare username when there is no display name", () => {
    expect(formatCopyAuthor(undefined, "mattf")).toBe("mattf");
  });

  test("appends the nick when a distinct display name is set", () => {
    expect(formatCopyAuthor("🇧🇷⇨🇩🇪", "mattf")).toBe("🇧🇷⇨🇩🇪 (mattf)");
  });

  test("does not duplicate when display name equals username", () => {
    expect(formatCopyAuthor("mattf", "mattf")).toBe("mattf");
  });

  test("system messages are labelled System", () => {
    expect(formatCopyAuthor("anything", "system", true)).toBe("System");
  });
});

describe("normalizeCopySource", () => {
  test("passes plain markdown through", () => {
    expect(normalizeCopySource("hello **world**")).toBe("hello **world**");
  });

  test("unwraps CTCP ACTION into an asterisk line", () => {
    expect(normalizeCopySource("ACTION waves")).toBe("* waves");
  });

  test("trims trailing whitespace", () => {
    expect(normalizeCopySource("text  \n")).toBe("text");
  });
});

describe("serializeMessagesToMarkdown", () => {
  test("single message gets an author header", () => {
    expect(serializeMessagesToMarkdown([msg("alice", "06:00 PM", "hi")])).toBe(
      "**alice** — 06:00 PM\nhi",
    );
  });

  test("different authors are separate blocks", () => {
    const out = serializeMessagesToMarkdown([
      msg("alice", "06:00 PM", "hi"),
      msg("bob", "06:01 PM", "yo"),
    ]);
    expect(out).toBe("**alice** — 06:00 PM\nhi\n\n**bob** — 06:01 PM\nyo");
  });

  test("consecutive messages from one author share a header", () => {
    const out = serializeMessagesToMarkdown([
      msg("alice", "06:00 PM", "first"),
      msg("alice", "06:00 PM", "second"),
      msg("bob", "06:02 PM", "reply"),
    ]);
    expect(out).toBe(
      "**alice** — 06:00 PM\nfirst\nsecond\n\n**bob** — 06:02 PM\nreply",
    );
  });

  test("preserves markdown syntax verbatim", () => {
    const out = serializeMessagesToMarkdown([
      msg("dev", "06:00 PM", "```js\nconst a = 1;\n```"),
      msg("dev", "06:00 PM", "see [docs](https://x.test)"),
    ]);
    expect(out).toContain("```js\nconst a = 1;\n```");
    expect(out).toContain("[docs](https://x.test)");
  });

  test("empty-source rows still emit their header", () => {
    expect(serializeMessagesToMarkdown([msg("alice", "06:00 PM", "")])).toBe(
      "**alice** — 06:00 PM",
    );
  });
});

describe("readMessageCopyData", () => {
  test("reads author/time/source attributes", () => {
    const el = document.createElement("div");
    el.setAttribute("data-md-author", "alice");
    el.setAttribute("data-md-time", "06:00 PM");
    el.setAttribute("data-md-source", "hello **world**");
    expect(readMessageCopyData(el)).toEqual({
      author: "alice",
      time: "06:00 PM",
      source: "hello **world**",
    });
  });

  test("falls back to text content when source is absent", () => {
    const el = document.createElement("div");
    el.setAttribute("data-md-author", "system");
    el.setAttribute("data-md-time", "06:00 PM");
    el.textContent = "user joined";
    expect(readMessageCopyData(el)?.source).toBe("user joined");
  });

  test("returns null without author/time attributes", () => {
    const el = document.createElement("div");
    expect(readMessageCopyData(el)).toBeNull();
  });
});

describe("DOM selection → markdown", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function buildDom(): HTMLElement {
    document.body.innerHTML = `
      <div id="root">
        <div data-message-id="1" data-md-author="alice" data-md-time="06:00 PM" data-md-source="hello **world**">hello world</div>
        <div data-message-id="2" data-md-author="bob" data-md-time="06:01 PM" data-md-source="reply [x](https://y.test)">reply x</div>
      </div>`;
    const root = document.getElementById("root");
    if (!root) throw new Error("root missing");
    return root;
  }

  function selectionOf(range: Range): Selection {
    return {
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
    } as unknown as Selection;
  }

  test("multi-message selection produces a markdown transcript", () => {
    const root = buildDom();
    const [a, b] = Array.from(root.children);
    const range = document.createRange();
    range.setStartBefore(a);
    range.setEndAfter(b);

    expect(messageNodesInSelection(selectionOf(range), root)).toHaveLength(2);
    expect(buildMarkdownFromSelection(selectionOf(range), root)).toBe(
      "**alice** — 06:00 PM\nhello **world**\n\n**bob** — 06:01 PM\nreply [x](https://y.test)",
    );
  });

  test("fully-selected single message yields its markdown source", () => {
    const root = buildDom();
    const range = document.createRange();
    range.selectNode(root.children[0]);
    expect(buildMarkdownFromSelection(selectionOf(range), root)).toBe(
      "**alice** — 06:00 PM\nhello **world**",
    );
  });

  test("partial single-message selection defers to native copy (null)", () => {
    const root = buildDom();
    const textNode = root.children[0].firstChild as Text;
    const range = document.createRange();
    range.setStart(textNode, 1);
    range.setEnd(textNode, 4);
    expect(buildMarkdownFromSelection(selectionOf(range), root)).toBeNull();
  });

  test("collapsed selection returns null", () => {
    const root = buildDom();
    const sel = { isCollapsed: true, rangeCount: 0 } as unknown as Selection;
    expect(buildMarkdownFromSelection(sel, root)).toBeNull();
  });
});
