import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import NickClaimStrip, {
  getNickPromptMode,
} from "../../../src/components/layout/NickClaimStrip";
import ircClient from "../../../src/lib/ircClient";
import useStore, { saveServersToLocalStorage } from "../../../src/store";
import type { Server, ServerConfig } from "../../../src/types";
import { installLocalStorageBacking } from "../../fixtures/localStorageBacking";

const serverId = "srv-claim";

function makeServer(overrides: Partial<Server> = {}): Server {
  return {
    id: serverId,
    name: "s",
    host: "irc.example.com",
    port: 443,
    channels: [],
    privateChats: [],
    users: [],
    isConnected: true,
    isRegistered: true,
    capabilities: ["draft/account-registration"],
    ...overrides,
  };
}

function setServer(overrides: Partial<Server> = {}) {
  useStore.setState({ servers: [makeServer(overrides)] });
}

function saveConfig(overrides: Partial<ServerConfig> = {}) {
  const config: ServerConfig = {
    id: serverId,
    host: "irc.example.com",
    port: 443,
    nickname: "alice",
    channels: [],
    saslEnabled: false,
    ...overrides,
  };
  saveServersToLocalStorage([config]);
}

function Strip() {
  const server = useStore((s) => s.servers.find((x) => x.id === serverId));
  return server ? <NickClaimStrip server={server} /> : null;
}

describe("getNickPromptMode", () => {
  test("offers to register a nick the server has not claimed", () => {
    expect(getNickPromptMode(makeServer(), "alice")).toBe("register");
  });

  test("offers to log in when the server says the nick is registered", () => {
    expect(
      getNickPromptMode(makeServer({ registeredNick: "Alice" }), "alice"),
    ).toBe("login");
  });

  test("asks for the emailed code while a registration waits for it", () => {
    expect(
      getNickPromptMode(
        makeServer({
          nickClaim: { account: "alice", storedPassword: "", stage: "verify" },
        }),
        "alice",
      ),
    ).toBe("verify");
  });

  test("says we are not logged in on a server without account registration", () => {
    expect(getNickPromptMode(makeServer({ capabilities: [] }), "alice")).toBe(
      "loggedOut",
    );
  });

  test.each(["Guest42", "guest", "user123"])(
    "offers no registration for the placeholder nick %s",
    (nick) => {
      expect(getNickPromptMode(makeServer(), nick)).toBe("loggedOut");
    },
  );

  test.each<[string, Partial<Server>]>([
    ["logged in", { account: "alice" }],
    ["sign-in failed", { saslFailed: true }],
    ["still registering", { isRegistered: false }],
    ["a bouncer network", { bouncerServerId: "parent" }],
  ])("stays hidden when %s", (_, overrides) => {
    expect(getNickPromptMode(makeServer(overrides), "alice")).toBeNull();
  });
});

describe("NickClaimStrip", () => {
  beforeEach(() => {
    installLocalStorageBacking();
    saveConfig();
    vi.spyOn(ircClient, "getNick").mockReturnValue("alice");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test.each<[string, Partial<Server>, string]>([
    ["register", {}, "Register"],
    ["login", { registeredNick: "alice" }, "Log in"],
    ["loggedOut", { capabilities: [] }, "Log in"],
  ])(
    "opens the login settings from the %s prompt",
    (_, overrides, actionLabel) => {
      setServer(overrides);
      render(<Strip />);

      fireEvent.click(screen.getByRole("button", { name: actionLabel }));

      expect(useStore.getState().ui.page).toEqual({
        kind: "serverSettings",
        serverId,
        section: "auth",
      });
    },
  );

  test("holds no password or email field of its own", () => {
    setServer();
    render(<Strip />);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Password")).not.toBeInTheDocument();
  });

  test("stays dismissed for this server after a reload", () => {
    setServer();
    const { unmount } = render(<Strip />);

    fireEvent.click(
      screen.getByRole("button", { name: "Don't show again for this server" }),
    );

    expect(
      screen.queryByRole("region", { name: "Your account" }),
    ).not.toBeInTheDocument();
    unmount();

    setServer();
    render(<Strip />);
    expect(
      screen.queryByRole("region", { name: "Your account" }),
    ).not.toBeInTheDocument();
  });

  test("shows on a server dismissed for another server only", () => {
    saveConfig({ id: "other", skipNickPrompt: true });
    setServer();
    render(<Strip />);

    expect(
      screen.getByRole("region", { name: "Your account" }),
    ).toBeInTheDocument();
  });
});

describe("registered nick from the server", () => {
  test("NOTE NICK REGISTERED marks the nick", () => {
    setServer();
    ircClient.triggerEvent("NOTE", {
      serverId,
      mtags: undefined,
      command: "NICK",
      code: "REGISTERED",
      target: "alice",
      context: ["alice"],
      message: "",
    });
    expect(useStore.getState().servers[0].registeredNick).toBe("alice");
  });
});
