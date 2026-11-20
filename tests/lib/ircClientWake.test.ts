import { afterEach, describe, expect, it, vi } from "vitest";
import { IRCClient } from "../../src/lib/irc/IRCClient";

const SERVER = "srv";

function connectedClient() {
  const client = new IRCClient();
  const sent: string[] = [];
  const socket = {
    readyState: WebSocket.OPEN,
    send: (raw: string) => sent.push(raw),
    close: vi.fn(),
    onclose: vi.fn() as (() => void) | null,
    onopen: null,
    onmessage: null,
    onerror: vi.fn() as (() => void) | null,
  };
  const internals = client as unknown as { sockets: Map<string, unknown> };
  internals.sockets.set(SERVER, socket);
  return { client, sent, socket, internals };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("checking a connection after the machine wakes", () => {
  it("runs the close handling itself when a dead socket never reports closing", () => {
    vi.useFakeTimers();
    const { client, sent, socket } = connectedClient();
    const onclose = socket.onclose;
    client.checkAlive(SERVER, 5000);
    expect(sent.some((line) => line.startsWith("PING :"))).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(socket.close).toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it("keeps the socket when the server answers in time", () => {
    vi.useFakeTimers();
    const { client, socket, internals } = connectedClient();
    client.checkAlive(SERVER, 5000);
    (
      client as unknown as {
        handleMessage(data: string, serverId: string): void;
      }
    ).handleMessage(":irc.test PONG irc.test :1\r\n", SERVER);
    vi.advanceTimersByTime(10_000);
    expect(socket.close).not.toHaveBeenCalled();
    expect(internals.sockets.get(SERVER)).toBe(socket);
  });

  it("keeps the socket when the server is still answering earlier commands", () => {
    vi.useFakeTimers();
    const { client, socket, internals } = connectedClient();
    client.checkAlive(SERVER, 5000);
    vi.advanceTimersByTime(4000);
    client.receiveFromSocket(
      SERVER,
      ":irc.test BATCH +abc chathistory #chan\r\n:irc.test BATCH -abc\r\n",
    );
    vi.advanceTimersByTime(10_000);
    expect(socket.close).not.toHaveBeenCalled();
    expect(internals.sockets.get(SERVER)).toBe(socket);
  });

  it("still drops a dead socket while local history replays", () => {
    vi.useFakeTimers();
    const { client, socket } = connectedClient();
    client.checkAlive(SERVER, 5000);
    client.replayLines(SERVER, [":a!a@h PRIVMSG #chan :old line"]);
    vi.advanceTimersByTime(5000);
    expect(socket.close).toHaveBeenCalled();
  });
});

describe("the account we are logged in to", () => {
  it("comes from 900 and goes with 901", () => {
    const { client } = connectedClient();
    const internals = client as unknown as {
      currentUsers: Map<string, unknown>;
      handleMessage(data: string, serverId: string): void;
    };
    internals.currentUsers.set(SERVER, {
      id: "me",
      username: "alice",
      isOnline: true,
    });
    internals.handleMessage(
      ":irc.test 900 alice alice!u@h alice :You are now logged in as alice\r\n",
      SERVER,
    );
    expect(client.getCurrentUser(SERVER)?.account).toBe("alice");
    internals.handleMessage(
      ":irc.test 901 alice alice!u@h :You are now logged out\r\n",
      SERVER,
    );
    expect(client.getCurrentUser(SERVER)?.account).toBeUndefined();
  });
});

describe("reconnecting a server whose socket is still open", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("closes and silences the old socket so only one session stays live", () => {
    const { client, socket, internals } = connectedClient();
    // We stub WebSocket so the reconnect opens no real socket that fails after the test ends.
    vi.stubGlobal(
      "WebSocket",
      class {
        static CONNECTING = 0;
        static OPEN = 1;
        readyState = 0;
        send() {}
        close() {}
      },
    );
    const oldOnclose = socket.onclose;

    void client
      .connect(
        "srv",
        "wss://irc.test",
        443,
        "me",
        undefined,
        undefined,
        undefined,
        SERVER,
      )
      .catch(() => {});

    expect(socket.close).toHaveBeenCalled();
    expect(socket.onclose).toBeNull();
    expect(socket.onmessage).toBeNull();
    expect(oldOnclose).not.toHaveBeenCalled();
    expect(internals.sockets.get(SERVER)).not.toBe(socket);
  });
});

describe("joining a channel typed without its prefix", () => {
  it("joins the # channel and lists it under that name", () => {
    const { client, sent } = connectedClient();
    (client as unknown as { servers: Map<string, unknown> }).servers.set(
      SERVER,
      { id: SERVER, channels: [], capabilities: [] },
    );

    const channel = client.joinChannel(SERVER, "qaop");

    expect(channel.name).toBe("#qaop");
    expect(sent).toContain("JOIN #qaop");
  });

  it("keeps a name that already has one of the server's channel prefixes", () => {
    const { client } = connectedClient();
    const internals = client as unknown as {
      servers: Map<string, unknown>;
      isupportValues: Map<string, Map<string, string>>;
    };
    internals.servers.set(SERVER, {
      id: SERVER,
      channels: [],
      capabilities: [],
    });
    internals.isupportValues.set(SERVER, new Map([["CHANTYPES", "#^$"]]));

    expect(client.joinChannel(SERVER, "^voice").name).toBe("^voice");
  });

  it("follows the channel types the server advertises", () => {
    const { client } = connectedClient();
    const internals = client as unknown as {
      servers: Map<string, unknown>;
      isupportValues: Map<string, Map<string, string>>;
    };
    internals.servers.set(SERVER, {
      id: SERVER,
      channels: [],
      capabilities: [],
    });
    internals.isupportValues.set(SERVER, new Map([["CHANTYPES", "&"]]));

    expect(client.joinChannel(SERVER, "&ops").name).toBe("&ops");
    expect(client.joinChannel(SERVER, "lobby").name).toBe("&lobby");
  });
});

describe("joining saved channels at startup", () => {
  function chathistoryClient() {
    const conn = connectedClient();
    (conn.client as unknown as { servers: Map<string, unknown> }).servers.set(
      SERVER,
      { id: SERVER, channels: [], capabilities: ["draft/chathistory"] },
    );
    return conn;
  }

  it("leaves the history request to the caller when asked", () => {
    const { client, sent } = chathistoryClient();
    const channel = client.joinChannel(SERVER, "#later", undefined, {
      deferHistory: true,
    });
    expect(sent).toEqual(["JOIN #later"]);
    expect(channel.chathistoryRequested).toBe(false);
  });

  it("requests history with the join otherwise", () => {
    const { client, sent } = chathistoryClient();
    client.joinChannel(SERVER, "#now");
    expect(sent).toEqual(["JOIN #now", "CHATHISTORY LATEST #now * 50"]);
  });

  it("sends one JOIN per channel when the ready handlers join them", () => {
    const { client, sent } = chathistoryClient();
    client.on("ready", ({ serverId }) => {
      client.joinChannel(serverId, "#saved", undefined, {
        deferHistory: true,
      });
    });
    client.receiveFromSocket(SERVER, ":irc.test 001 me :Welcome\r\n");
    expect(sent.filter((line) => line === "JOIN #saved")).toHaveLength(1);
  });

  it("sends one JOIN per channel on a reconnect", () => {
    const { client, sent } = chathistoryClient();
    client.joinChannel(SERVER, "#saved");
    client.joinChannel(SERVER, "#unsaved");
    sent.length = 0;
    client.on("ready", ({ serverId }) => {
      client.joinChannel(serverId, "#saved", undefined, {
        deferHistory: true,
      });
    });
    client.receiveFromSocket(SERVER, ":irc.test 001 me :Welcome\r\n");
    const joins = sent.filter((line) => line.startsWith("JOIN "));
    expect(joins.sort()).toEqual(["JOIN #saved", "JOIN #unsaved"]);
  });
});

describe("disconnecting on purpose", () => {
  it("detaches the socket handlers so a late close or error leaves the next session alone", () => {
    const { client, socket } = connectedClient();
    client.disconnect(SERVER);
    expect(socket.close).toHaveBeenCalled();
    expect(socket.onclose).toBeNull();
    expect(socket.onerror).toBeNull();
  });
});
