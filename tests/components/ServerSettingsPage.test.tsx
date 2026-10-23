import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import ServerSettingsPage from "../../src/components/pages/ServerSettingsPage";
import useStore from "../../src/store";

vi.mock("../../src/store", () => {
  const mockStore = vi.fn();
  return {
    default: Object.assign(mockStore, {
      setState: vi.fn(),
      getState: vi.fn(),
    }),
    loadSavedServers: vi.fn(() => [
      {
        id: "server1",
        name: "Test Server",
        host: "irc.example.com",
        port: 6697,
        nickname: "tester",
      },
    ]),
  };
});

vi.mock("../../src/lib/oauth", () => ({
  getBuiltinOAuthConfig: vi.fn(() => undefined),
}));

const serverState = {
  servers: [
    {
      id: "server1",
      name: "Test Server",
      host: "irc.example.com",
      port: 6697,
      nickname: "tester",
      channels: [],
      privateChats: [],
    },
  ],
  isConnecting: false,
  updateServer: vi.fn(),
  sendRaw: vi.fn(),
  closePage: vi.fn(),
  ui: { selectedServerId: null, perServerSelections: {}, isNarrowView: false },
};

describe("ServerSettingsPage", () => {
  beforeEach(() => {
    vi.mocked(useStore).mockImplementation(((
      selector?: (s: unknown) => unknown,
    ) => (selector ? selector(serverState) : serverState)) as never);
  });

  test("saves a field when it loses focus and leaves invalid values unsaved", () => {
    render(
      <ServerSettingsPage
        page={{ kind: "serverSettings", serverId: "server1" }}
      />,
    );
    const host = screen.getByDisplayValue("irc.example.com");

    fireEvent.change(host, { target: { value: "irc.other.net" } });
    expect(serverState.updateServer).not.toHaveBeenCalled();
    fireEvent.focusOut(host);
    expect(serverState.updateServer).toHaveBeenCalledWith(
      "server1",
      expect.objectContaining({ host: "irc.other.net" }),
    );

    serverState.updateServer.mockClear();
    fireEvent.change(host, { target: { value: "" } });
    fireEvent.focusOut(host);
    expect(serverState.updateServer).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Server host is required",
    );
  });
});
