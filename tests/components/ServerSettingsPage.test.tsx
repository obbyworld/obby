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
        password: "stored-server-pass",
        saslPassword: "c3RvcmVk",
        saslEnabled: true,
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
  reconnectServer: vi.fn(),
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

  test("keeps the stored passwords when the user saves another field", () => {
    serverState.updateServer.mockClear();
    render(
      <ServerSettingsPage
        page={{ kind: "serverSettings", serverId: "server1" }}
      />,
    );
    const nickname = screen.getByDisplayValue("tester");

    fireEvent.change(nickname, { target: { value: "tester2" } });
    fireEvent.focusOut(nickname);

    const saved = serverState.updateServer.mock.calls[0][1];
    expect(saved).not.toHaveProperty("password");
    expect(saved).not.toHaveProperty("saslPassword");
    expect(saved).not.toHaveProperty("saslEnabled");
  });

  test("forgets the stored passwords when the user asks", () => {
    serverState.updateServer.mockClear();
    render(
      <ServerSettingsPage
        page={{ kind: "serverSettings", serverId: "server1", section: "auth" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Forget passwords" }));

    expect(serverState.updateServer).toHaveBeenCalledWith(
      "server1",
      expect.objectContaining({
        password: undefined,
        saslPassword: undefined,
        saslEnabled: false,
      }),
    );
  });

  test("drops the stored passwords when the host moves to another network", () => {
    serverState.updateServer.mockClear();
    render(
      <ServerSettingsPage
        page={{ kind: "serverSettings", serverId: "server1" }}
      />,
    );
    const host = screen.getByDisplayValue("irc.example.com");

    fireEvent.change(host, { target: { value: "irc.other.net" } });
    fireEvent.focusOut(host);

    const saved = serverState.updateServer.mock.calls[0][1];
    expect(saved).toHaveProperty("password", undefined);
    expect(saved).toHaveProperty("saslPassword", undefined);
    expect(saved.saslEnabled).toBe(false);
  });

  test("keeps the stored passwords when only the host spelling changes", () => {
    serverState.updateServer.mockClear();
    render(
      <ServerSettingsPage
        page={{ kind: "serverSettings", serverId: "server1" }}
      />,
    );
    const host = screen.getByDisplayValue("irc.example.com");

    fireEvent.change(host, { target: { value: "wss://IRC.example.com:443" } });
    fireEvent.focusOut(host);

    const saved = serverState.updateServer.mock.calls[0][1];
    expect(saved).not.toHaveProperty("password");
    expect(saved).not.toHaveProperty("saslPassword");
  });

  test("keeps a typed password through a blur and logs in with it on Log in", () => {
    serverState.updateServer.mockClear();
    serverState.reconnectServer.mockClear();
    render(
      <ServerSettingsPage
        page={{ kind: "serverSettings", serverId: "server1", section: "auth" }}
      />,
    );
    const [password] = screen.getAllByPlaceholderText(
      "(stored, leave blank to keep)",
    );

    fireEvent.change(password, { target: { value: "new-pass" } });
    fireEvent.focusOut(password);
    expect(password).toHaveValue("new-pass");
    expect(serverState.updateServer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(serverState.updateServer).toHaveBeenCalledWith(
      "server1",
      expect.objectContaining({
        saslPassword: btoa("new-pass"),
        saslEnabled: true,
      }),
    );
    expect(serverState.reconnectServer).toHaveBeenCalledWith("server1");
  });

  test("shows a refused sign-in next to the Log in button", () => {
    const failed = {
      ...serverState,
      servers: [
        {
          ...serverState.servers[0],
          isConnected: true,
          isRegistered: true,
          saslFailed: true,
        },
      ],
    };
    vi.mocked(useStore).mockImplementation(((
      selector?: (s: unknown) => unknown,
    ) => (selector ? selector(failed) : failed)) as never);
    render(
      <ServerSettingsPage
        page={{ kind: "serverSettings", serverId: "server1", section: "auth" }}
      />,
    );
    expect(
      screen.getByText("Sign-in failed. Check the account name and password"),
    ).toBeInTheDocument();
  });

  test("keeps the oper password after saving, so Oper up still sends it", () => {
    serverState.sendRaw.mockClear();
    render(
      <ServerSettingsPage
        page={{
          kind: "serverSettings",
          serverId: "server1",
          section: "operator",
        }}
      />,
    );
    const name = screen.getByPlaceholderText("IRC operator username");
    const password = screen.getByPlaceholderText("Operator password");

    fireEvent.change(name, { target: { value: "admin" } });
    fireEvent.change(password, { target: { value: "operpass" } });
    fireEvent.focusOut(password);

    expect(password).toHaveValue("operpass");
    fireEvent.click(screen.getByRole("button", { name: "Oper up" }));
    expect(serverState.sendRaw).toHaveBeenCalledWith(
      "server1",
      "OPER admin operpass",
    );
  });
});
