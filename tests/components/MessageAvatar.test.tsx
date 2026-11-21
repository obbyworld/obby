import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MessageAvatar } from "../../src/components/message/MessageAvatar";
import useStore from "../../src/store";
import type { Server } from "../../src/types";

const avatarUrl = "https://files.example.com/alice.png";

function setServer(overrides: Partial<Server> = {}) {
  useStore.setState({
    servers: [
      {
        id: "server1",
        name: "s",
        host: "irc.example.com",
        port: 6697,
        channels: [],
        privateChats: [],
        users: [],
        isConnected: true,
        ...overrides,
      },
    ],
  });
}

const renderAvatar = (url = avatarUrl) =>
  render(
    <MessageAvatar
      userId="alice"
      avatarUrl={url}
      theme="discord"
      showHeader
      serverId="server1"
    />,
  );

beforeEach(() => {
  useStore.setState((state) => ({
    globalSettings: { ...state.globalSettings, mediaVisibilityLevel: 1 },
  }));
});

afterEach(cleanup);

describe("MessageAvatar", () => {
  it("shows the avatar once the server advertises its file host", () => {
    setServer();
    renderAvatar();
    expect(screen.queryByRole("img", { name: "alice" })).toBeNull();

    act(() => setServer({ fileHosts: ["https://files.example.com/upload"] }));

    expect(screen.getByRole("img", { name: "alice" })).toHaveAttribute(
      "src",
      avatarUrl,
    );
  });

  it("loads a new avatar after the previous one failed", () => {
    setServer({ fileHosts: ["https://files.example.com/upload"] });
    const { rerender } = renderAvatar();
    fireEvent.error(screen.getByRole("img", { name: "alice" }));
    expect(screen.queryByRole("img", { name: "alice" })).toBeNull();

    const newUrl = "https://files.example.com/alice2.png";
    rerender(
      <MessageAvatar
        userId="alice"
        avatarUrl={newUrl}
        theme="discord"
        showHeader
        serverId="server1"
      />,
    );
    expect(screen.getByRole("img", { name: "alice" })).toHaveAttribute(
      "src",
      newUrl,
    );
  });
});
