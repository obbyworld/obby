import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import CompletionList from "../../../src/components/ui/CompletionList";
import SegmentedControl from "../../../src/components/ui/SegmentedControl";
import type { Completion } from "../../../src/hooks/useCompletion";

const completion = (items: string[]): Completion<string> => ({
  provider: {
    title: "People",
    match: () => null,
    getItems: () => items,
    getKey: (nick) => nick,
    renderItem: (nick) => <span>{nick}</span>,
    accept: (nick) => nick,
  },
  items,
  isOpen: items.length > 0,
  selectedIndex: 1,
  setSelectedIndex: vi.fn(),
  pick: vi.fn(),
});

describe("CompletionList", () => {
  it("renders the provider's items with its selection and picks on click", () => {
    const people = completion(["alice", "bob"]);
    render(<CompletionList completion={people} id="list" embedded />);

    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["alice", "bob"]);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("listbox").className).not.toContain(
      "surface-floating",
    );
    fireEvent.click(options[0]);
    expect(people.pick).toHaveBeenCalledWith("alice");
  });

  it("renders nothing without items", () => {
    const { container } = render(
      <CompletionList completion={completion([])} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SegmentedControl", () => {
  it("sizes its segments and passes mouse down through", () => {
    const onMouseDown = vi.fn((e: React.MouseEvent) => e.preventDefault());
    render(
      <SegmentedControl
        size="lg"
        value="a"
        onChange={vi.fn()}
        onMouseDown={onMouseDown}
        segments={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
      />,
    );
    const button = screen.getByRole("button", { name: "A" });
    expect(button.className).toContain("min-h-11");
    fireEvent.mouseDown(button);
    expect(onMouseDown).toHaveBeenCalled();
  });

  it("keeps the default size for existing callers", () => {
    render(
      <SegmentedControl
        value="a"
        onChange={vi.fn()}
        segments={[{ value: "a", label: "A" }]}
      />,
    );
    expect(screen.getByRole("button", { name: "A" }).className).toContain(
      "min-h-10",
    );
  });
});
