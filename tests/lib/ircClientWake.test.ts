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
    onerror: null,
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
