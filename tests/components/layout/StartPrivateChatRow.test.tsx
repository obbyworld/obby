import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StartPrivateChatRow } from "../../../src/components/layout/StartPrivateChatRow";
import ircClient from "../../../src/lib/ircClient";
import type { AppState } from "../../../src/store";
import useStore from "../../../src/store";

// We run as a touch device, where the list sits inline and needs no layout.
vi.mock("../../../src/hooks/useIsTouchInput", () => ({
  useIsTouchInput: () => true,
}));

const SID = "srv-1";

const user = (username: string) => ({
  id: username,
  username,
  isOnline: true,
});

describe("StartPrivateChatRow", () => {
  const openPrivateChat = vi.fn();

  beforeEach(() => {
    openPrivateChat.mockReset();
    vi.spyOn(ircClient, "getCurrentUser").mockReturnValue(
      user("me") as ReturnType<typeof ircClient.getCurrentUser>,
    );
    useStore.setState({
      openPrivateChat,
      servers: [
        {
          id: SID,
          name: "srv",
          host: "h",
          port: 1,
          channels: [
            {
              id: "c1",
              name: "#a",
              isPrivate: false,
              serverId: SID,
              unreadCount: 0,
              isMentioned: false,
              messages: [],
              users: [user("me"), user("alice"), user("bob")],
            },
            {
              id: "c2",
              name: "#b",
              isPrivate: false,
              serverId: SID,
              unreadCount: 0,
              isMentioned: false,
              messages: [],
              users: [user("alice"), user("albert")],
            },
          ],
          privateChats: [],
          isConnected: true,
          users: [],
        },
      ],
    } as unknown as Partial<AppState>);
  });

  const open = () => {
    render(<StartPrivateChatRow serverId={SID} />);
    fireEvent.click(screen.getByRole("button", { name: /message someone/i }));
    return screen.getByLabelText("Nickname to message");
  };

  it("turns into the input in place and lists people from every channel except you", () => {
    open();
    expect(
      screen.queryByRole("button", { name: /message someone/i }),
    ).not.toBeInTheDocument();
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names).toEqual(["albert", "alice", "bob"]);
  });

  it("fuzzy filters as you type and opens the highlighted person on Enter", () => {
    const input = open();
    fireEvent.change(input, { target: { value: "alc" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "alice",
    ]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(openPrivateChat).toHaveBeenCalledWith(SID, "alice");
    expect(
      screen.getByRole("button", { name: /message someone/i }),
    ).toBeInTheDocument();
  });

  it("opens a chat with a typed nick nobody shares a channel with", () => {
    const input = open();
    fireEvent.change(input, { target: { value: "zed" } });
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(openPrivateChat).toHaveBeenCalledWith(SID, "zed");
  });
});
