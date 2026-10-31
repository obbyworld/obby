import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  test,
  vi,
} from "vitest";
import NickClaimStrip, {
  getNickPromptMode,
} from "../../../src/components/layout/NickClaimStrip";
import ircClient from "../../../src/lib/ircClient";
import useStore, { type AppState } from "../../../src/store";
import type { Server } from "../../../src/types";

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

function Strip() {
  const server = useStore((s) => s.servers.find((x) => x.id === serverId));
  return server ? <NickClaimStrip server={server} /> : null;
}

const emit: typeof ircClient.triggerEvent = (event, data) =>
  act(() => ircClient.triggerEvent(event, data));

function fail(command: string, code: string, target = "alice") {
  emit("FAIL", {
    serverId,
    mtags: undefined,
    command,
    code,
    target,
    context: [target],
    message: "",
  });
}

function loggedIn(account = "alice") {
  emit("LOGGED_IN", { serverId, account });
}

function typePassword(value: string) {
  fireEvent.change(screen.getByPlaceholderText("Password"), {
    target: { value },
  });
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

  test.each<[string, Partial<Server>]>([
    ["logged in", { account: "alice" }],
    ["sign-in failed", { saslFailed: true }],
    ["still registering", { isRegistered: false }],
    ["no account registration", { capabilities: [] }],
    ["hidden by the user", { isNickPromptHidden: true }],
    ["a bouncer network", { bouncerServerId: "parent" }],
  ])("stays hidden when %s", (_, overrides) => {
    expect(getNickPromptMode(makeServer(overrides), "alice")).toBeNull();
  });
});

describe("NickClaimStrip", () => {
  let sendRaw: ReturnType<typeof vi.spyOn>;
  let updateServer: Mock<AppState["updateServer"]>;
  let reconnectServer: Mock<AppState["reconnectServer"]>;

  beforeEach(() => {
    sendRaw = vi.spyOn(ircClient, "sendRaw").mockImplementation(() => {});
    vi.spyOn(ircClient, "getNick").mockReturnValue("alice");
    updateServer = vi.fn<AppState["updateServer"]>();
    reconnectServer = vi.fn<AppState["reconnectServer"]>();
    useStore.setState({ updateServer, reconnectServer });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("registers the nick and saves the login once the server logs us in", () => {
    setServer();
    render(<Strip />);

    typePassword("pass word");
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    expect(sendRaw).toHaveBeenCalledWith(
      serverId,
      "REGISTER alice * :pass word",
    );
    expect(screen.getByRole("button", { name: "Register" })).toBeDisabled();
    expect(updateServer).not.toHaveBeenCalled();

    loggedIn();

    expect(updateServer).toHaveBeenCalledWith(serverId, {
      saslAccountName: "alice",
      saslPassword: btoa("pass word"),
      saslEnabled: true,
    });
    expect(useStore.getState().servers[0].nickClaim).toBeUndefined();
  });

  test("asks for an email when the server requires one", () => {
    setServer({
      capabilityValues: {
        "draft/account-registration": "before-connect,email-required",
      },
    });
    render(<Strip />);

    typePassword("secret");
    const register = screen.getByRole("button", { name: "Register" });
    expect(register).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Email"), {
      target: { value: "a@b.c" },
    });
    fireEvent.click(register);

    expect(sendRaw).toHaveBeenCalledWith(
      serverId,
      "REGISTER alice a@b.c :secret",
    );
  });

  test("switches to log in, keeping the password, when the nick is taken", () => {
    setServer();
    render(<Strip />);
    typePassword("secret");
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    fail("REGISTER", "ACCOUNT_EXISTS");

    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
    expect(screen.getByPlaceholderText("Password")).toHaveValue("secret");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("logs in by saving the login and reconnecting", () => {
    setServer({ registeredNick: "alice" });
    render(<Strip />);

    typePassword("secret");
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(updateServer).toHaveBeenCalledWith(serverId, {
      saslAccountName: "alice",
      saslPassword: btoa("secret"),
      saslEnabled: true,
    });
    expect(reconnectServer).toHaveBeenCalledWith(serverId);
  });

  test("explains a refused registration in every copy of the strip", () => {
    setServer();
    render(
      <>
        <Strip />
        <Strip />
      </>,
    );
    fireEvent.change(screen.getAllByPlaceholderText("Password")[0], {
      target: { value: "x" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Register" })[0]);

    fail("REGISTER", "BAD_PASSWORD");

    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(2);
    expect(alerts[0]).toHaveTextContent("Choose a longer password");
  });

  test("never saves the password of a refused registration", () => {
    setServer();
    render(<Strip />);
    typePassword("weak");
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    fail("REGISTER", "BAD_PASSWORD");

    loggedIn();

    expect(updateServer).not.toHaveBeenCalled();
  });

  test("ignores replies to other commands and other servers", () => {
    setServer();
    render(<Strip />);
    typePassword("secret");
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    fail("JOIN", "BAD_PASSWORD");
    emit("FAIL", {
      serverId: "other",
      mtags: undefined,
      command: "REGISTER",
      code: "BAD_PASSWORD",
      context: [],
      message: "",
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("refuses a password we cannot store", () => {
    setServer();
    render(<Strip />);
    typePassword("пароль");
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    expect(sendRaw).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Latin");
  });

  test("verifies the emailed code and saves the login only once logged in", () => {
    setServer();
    render(<Strip />);
    typePassword("secret");
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    emit("REGISTER_VERIFICATION_REQUIRED", {
      serverId,
      mtags: undefined,
      account: "alice",
      message: "",
    });
    expect(updateServer).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText("Code"), {
      target: { value: " 1234 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(sendRaw).toHaveBeenLastCalledWith(serverId, "VERIFY alice 1234");

    fail("VERIFY", "BAD_CODE");
    expect(screen.getByRole("alert")).toHaveTextContent("Check the code");
    expect(screen.getByPlaceholderText("Code")).toBeInTheDocument();

    loggedIn();
    expect(updateServer).toHaveBeenCalledWith(
      serverId,
      expect.objectContaining({ saslPassword: btoa("secret") }),
    );
  });

  test("hides for the rest of the session", () => {
    setServer();
    render(<Strip />);

    fireEvent.click(screen.getByRole("button", { name: "Hide" }));

    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(useStore.getState().servers[0].isNickPromptHidden).toBe(true);
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
