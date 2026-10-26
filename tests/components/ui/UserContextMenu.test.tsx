import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import UserContextMenu from "../../../src/components/ui/UserContextMenu";

const mockState = {
  servers: [{ id: "s1", channels: [], users: [], botCommands: {} }],
  openBot: vi.fn(),
  globalSettings: { ignoreList: [] },
  addToIgnoreList: vi.fn(),
  removeFromIgnoreList: vi.fn(),
  ui: { mobileViewActiveColumn: "chatView" },
};

vi.mock("../../../src/store", () => ({
  default: Object.assign(
    vi.fn((selector: (state: unknown) => unknown) => selector(mockState)),
    { getState: () => mockState },
  ),
}));

const renderMenu = (props: Partial<Parameters<typeof UserContextMenu>[0]>) =>
  render(
    <UserContextMenu
      isOpen
      x={0}
      y={0}
      username="carol"
      serverId="s1"
      onClose={vi.fn()}
      onOpenPM={vi.fn()}
      currentUsername="me"
      {...props}
    />,
  );

describe("UserContextMenu mention", () => {
  it("hands the nick to the composer", () => {
    const onMention = vi.fn();
    renderMenu({ onMention });
    fireEvent.click(screen.getByText("Mention"));
    expect(onMention).toHaveBeenCalledWith("carol");
  });

  it("hides Mention for our own nick", () => {
    renderMenu({ onMention: vi.fn(), username: "me" });
    expect(screen.queryByText("Mention")).toBeNull();
  });
});
