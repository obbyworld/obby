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
import { RegisterAccountSection } from "../../../src/components/pages/RegisterAccountSection";
import ircClient from "../../../src/lib/ircClient";
import useStore, { type AppState } from "../../../src/store";
import type { Server } from "../../../src/types";

const serverId = "srv-register";

function setServer(overrides: Partial<Server> = {}) {
  useStore.setState({
    servers: [
      {
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
      },
    ],
  });
}

function Section() {
  const server = useStore((s) => s.servers.find((x) => x.id === serverId));
  return server ? <RegisterAccountSection server={server} /> : null;
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

describe("RegisterAccountSection", () => {
  let sendRaw: ReturnType<typeof vi.spyOn>;
  let updateServer: Mock<AppState["updateServer"]>;

  beforeEach(() => {
    sendRaw = vi.spyOn(ircClient, "sendRaw").mockImplementation(() => {});
    vi.spyOn(ircClient, "getNick").mockReturnValue("alice");
    vi.spyOn(ircClient, "isSocketOpen").mockReturnValue(true);
    updateServer = vi.fn<AppState["updateServer"]>();
    useStore.setState({ updateServer });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("registers the nick and saves the login once the server logs us in", () => {
    setServer();
    render(<Section />);

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
    render(<Section />);

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

  test("steps aside for the login form when the nick is taken", () => {
    setServer();
    render(<Section />);
    typePassword("secret");
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    fail("REGISTER", "ACCOUNT_EXISTS");

    expect(
      screen.queryByRole("button", { name: "Register" }),
    ).not.toBeInTheDocument();
    expect(useStore.getState().servers[0].registeredNick).toBe("alice");
  });

  test("keeps its claim when another account turns out taken", () => {
    setServer();
    render(<Section />);
    typePassword("secret");
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    fail("REGISTER", "ACCOUNT_EXISTS", "bob");

    expect(useStore.getState().servers[0].nickClaim?.account).toBe("alice");
  });

  test("keeps the code field once the server marks the nick as registered", () => {
    setServer();
    render(<Section />);
    typePassword("secret");
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    emit("REGISTER_VERIFICATION_REQUIRED", {
      serverId,
      mtags: undefined,
      account: "alice",
      message: "",
    });

    emit("NOTE", {
      serverId,
      mtags: undefined,
      command: "NICK",
      code: "REGISTERED",
      target: "alice",
      context: ["alice"],
      message: "",
    });

    expect(screen.getByPlaceholderText("Code")).toBeInTheDocument();
  });

  test("sends nothing while the connection is down", () => {
    vi.spyOn(ircClient, "isSocketOpen").mockReturnValue(false);
    setServer();
    render(<Section />);
    typePassword("secret");
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    expect(sendRaw).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Register" })).toBeEnabled();
  });

  test("explains a refused registration and never saves its password", () => {
    setServer();
    render(<Section />);
    typePassword("weak");
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    fail("REGISTER", "BAD_PASSWORD");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose a longer password",
    );

    loggedIn();
    expect(updateServer).not.toHaveBeenCalled();
  });

  test("ignores replies to other commands and other servers", () => {
    setServer();
    render(<Section />);
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
    render(<Section />);
    typePassword("пароль");
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    expect(sendRaw).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Latin");
  });

  test("verifies the emailed code and saves the login only once logged in", () => {
    setServer();
    render(<Section />);
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

  test.each<[string, Partial<Server>]>([
    ["no account registration", { capabilities: [] }],
    ["logged in", { account: "alice" }],
    ["the nick is registered", { registeredNick: "Alice" }],
  ])("stays hidden with %s", (_, overrides) => {
    setServer(overrides);
    render(<Section />);
    expect(
      screen.queryByRole("button", { name: "Register" }),
    ).not.toBeInTheDocument();
  });
});
