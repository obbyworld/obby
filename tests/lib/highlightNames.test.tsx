import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { highlightNames } from "../../src/lib/highlightNames";

afterEach(cleanup);

function show(node: React.ReactNode, names: string[]) {
  return render(<div>{highlightNames(node, names)}</div>).container;
}

const marks = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".addressed-name")).map(
    (el) => el.textContent,
  );

describe("highlightNames", () => {
  it("marks the name where it was said", () => {
    const container = show("mattf: look at this", ["mattf"]);

    expect(marks(container)).toEqual(["mattf"]);
    expect(container.textContent).toBe("mattf: look at this");
  });

  it("marks the name as it was typed, whatever the case", () => {
    const container = show("hey MattF you there", ["mattf"]);

    expect(marks(container)).toEqual(["MattF"]);
  });

  it("marks every time it is said", () => {
    const container = show("mattf hi mattf", ["mattf"]);

    expect(marks(container)).toEqual(["mattf", "mattf"]);
  });

  // The same boundary rule the row highlight uses, so the two never disagree.
  it("leaves a name buried in a longer word alone", () => {
    const container = show("mattfoo is not you", ["mattf"]);

    expect(marks(container)).toEqual([]);
  });

  it("marks custom words alongside the nick", () => {
    const container = show("mattf the build failed", ["mattf", "build"]);

    expect(marks(container)).toEqual(["mattf", "build"]);
  });

  // Two names sharing a stretch of text must not nest or double-wrap it.
  it("marks an overlapping stretch once, preferring the longer name", () => {
    const container = show("ping my-nick now", ["my-nick", "my-nick"]);

    expect(marks(container)).toEqual(["my-nick"]);
    expect(container.textContent).toBe("ping my-nick now");
  });

  it("reaches into nested formatting without flattening it", () => {
    const container = show(
      <em>
        <strong>mattf</strong> look
      </em>,
      ["mattf"],
    );

    expect(marks(container)).toEqual(["mattf"]);
    expect(container.querySelector("em strong .addressed-name")).toBeTruthy();
  });

  // A name inside a URL is part of an address, not someone speaking to us, and
  // rewriting link text would break the link's own rendering.
  it("leaves link text alone", () => {
    const container = show(
      <span>
        see <a href="https://x.test/mattf">https://x.test/mattf</a> ok mattf
      </span>,
      ["mattf"],
    );

    expect(marks(container)).toEqual(["mattf"]);
    expect(container.querySelector("a")?.textContent).toBe(
      "https://x.test/mattf",
    );
  });

  // A name inside a sample is part of what is being quoted, so marking it
  // would change what the sample says.
  it("leaves code alone", () => {
    const container = show(
      <span>
        try <code>mattf --help</code> then ping mattf
      </span>,
      ["mattf"],
    );

    expect(marks(container)).toEqual(["mattf"]);
    expect(container.querySelector("code")?.textContent).toBe("mattf --help");
  });

  it("leaves a code block alone", () => {
    const container = show(
      <pre>
        <code>mattf = 1</code>
      </pre>,
      ["mattf"],
    );

    expect(marks(container)).toEqual([]);
  });

  // IRC monospace formatting arrives as a styled span rather than a code tag.
  it("leaves an IRC monospace run alone", () => {
    const container = show(
      <span style={{ fontFamily: "monospace" }}>mattf typed this</span>,
      ["mattf"],
    );

    expect(marks(container)).toEqual([]);
  });

  it("returns the body untouched when nothing was addressed", () => {
    const body = <span>nothing to see</span>;

    expect(highlightNames(body, [])).toBe(body);
  });

  it("carries mixed arrays of text and elements through", () => {
    const container = show(
      ["say ", <b key="b">mattf</b>, " now mattf"],
      ["mattf"],
    );

    expect(marks(container)).toEqual(["mattf", "mattf"]);
    expect(container.textContent).toBe("say mattf now mattf");
  });
});
