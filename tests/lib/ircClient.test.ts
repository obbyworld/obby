import { beforeEach, describe, expect, test, vi } from "vitest";
import { IRCClient } from "../../src/lib/ircClient";
import type { Server } from "../../src/types";

// Mock WebSocket class
class MockWebSocket extends EventTarget {
  public readyState: number = WebSocket.CONNECTING;
  public bufferedAmount = 0;
  public extensions = "";
  public protocol = "";
  public binaryType: BinaryType = "blob";
  public url: string;
  public sentMessages: string[] = [];

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    super();
    this.url = url;
  }

  send(message: string): void {
    this.sentMessages.push(message);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent("close"));
    }
  }

  // Helper methods for testing
  simulateOpen(): void {
    this.readyState = WebSocket.OPEN;
    if (this.onopen) {
      this.onopen(new Event("open"));
    }
  }

  simulateMessage(data: string): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent("message", { data }));
    }
  }

  simulateError(error: Error): void {
    if (this.onerror) {
      this.onerror(new Event("error"));
    }
  }
}

// vitest 4 rejects `mockReturnValue` on a mock invoked with `new`; a plain
// function that returns a prebuilt instance is the supported replacement.
function returnsSocket(socket: MockWebSocket): () => WebSocket {
  function Ctor() {
    return socket;
  }
  return Ctor as unknown as () => WebSocket;
}

// Mock WebSocket globally
const MockWebSocketSpy = vi.fn();
vi.stubGlobal("WebSocket", MockWebSocketSpy);

describe("IRCClient", () => {
  let client: IRCClient;

  beforeEach(() => {
    client = new IRCClient();
    vi.clearAllMocks();
    MockWebSocketSpy.mockClear();
  });

  describe("connect", () => {
    test("should connect to IRC server successfully", async () => {
      const mockSocket = new MockWebSocket("ws://irc.example.com:443");
      MockWebSocketSpy.mockImplementation(returnsSocket(mockSocket));

      const connectionPromise = client.connect(
        "Test Server",
        "irc.example.com",
        443,
        "testuser",
      );

      // Simulate successful connection
      mockSocket.simulateOpen();

      const server = await connectionPromise;

      expect(server).toBeDefined();
      expect(server.name).toBe("Test Server");
      expect(server.isConnected).toBe(true);

      // Verify sent messages
      expect(mockSocket.sentMessages).toContain("CAP LS 302");
    });

    test.skip("should handle connection errors", async () => {
      vi.useFakeTimers();

      const mockSocket = new MockWebSocket("ws://irc.example.com:443");
      MockWebSocketSpy.mockImplementation(returnsSocket(mockSocket));

      const connectionPromise = client.connect(
        "Test Server",
        "irc.example.com",
        443,
        "testuser",
      );

      // Trigger the error synchronously after the promise is set up
      if (mockSocket.onerror) {
        mockSocket.onerror(new Event("error"));
      }

      // Expect the promise to reject
      await expect(connectionPromise).rejects.toThrow(/Failed to connect/);

      vi.useRealTimers();
    });

    test("should return existing server when connecting to same host/port", async () => {
      // First connection
      const mockSocket1 = new MockWebSocket("ws://irc.example.com:443");
      MockWebSocketSpy.mockImplementation(returnsSocket(mockSocket1));

      const firstConnectionPromise = client.connect(
        "Test Server",
        "irc.example.com",
        443,
        "testuser",
      );

      mockSocket1.simulateOpen();
      const firstServer = await firstConnectionPromise;

      expect(firstServer).toBeDefined();
      expect(firstServer.name).toBe("Test Server");
      expect(firstServer.isConnected).toBe(true);
      expect(mockSocket1.sentMessages).toContain("CAP LS 302");
      expect(MockWebSocketSpy).toHaveBeenCalledTimes(1);

      // Second connection to same host/port should return existing server
      const secondConnectionPromise = client.connect(
        "Test Server 2",
        "irc.example.com",
        443,
        "testuser2", // Different nickname
      );

      const secondServer = await secondConnectionPromise;

      // Should return the same server instance
      expect(secondServer).toBe(firstServer);
      expect(secondServer.id).toBe(firstServer.id);

      // Should not have created a new WebSocket
      expect(MockWebSocketSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("message handling", () => {
    test("should handle PRIVMSG correctly", async () => {
      const mockSocket = new MockWebSocket("ws://irc.example.com:443");
      MockWebSocketSpy.mockImplementation(returnsSocket(mockSocket));

      const connectionPromise = client.connect(
        "Test Server",
        "irc.example.com",
        443,
        "testuser",
      );

      mockSocket.simulateOpen();
      const server = await connectionPromise;

      // Set up event listener
      let receivedMessage: unknown;
      const messagePromise = new Promise<void>((resolve) => {
        client.on("CHANMSG", (msg) => {
          receivedMessage = msg;
          resolve();
        });
      });

      // Simulate receiving a PRIVMSG
      mockSocket.simulateMessage(
        "@time=2023-01-01T12:00:00.000Z :nick!user@host PRIVMSG #channel :Hello, world!\r\n",
      );

      await messagePromise;

      expect(receivedMessage).toEqual({
        serverId: server.id,
        mtags: expect.any(Object),
        sender: "nick",
        channelName: "#channel",
        message: "Hello, world!",
        timestamp: expect.any(Date),
      });
    });

    test("should parse MODE messages", async () => {
      const mockSocket = new MockWebSocket("ws://irc.example.com:443");
      MockWebSocketSpy.mockImplementation(returnsSocket(mockSocket));

      const connectionPromise = client.connect(
        "Test Server",
        "irc.example.com",
        443,
        "testuser",
      );

      mockSocket.simulateOpen();
      const server = await connectionPromise;

      // Set up event listener for MODE
      let receivedMode: unknown;
      const modePromise = new Promise<void>((resolve) => {
        client.on("MODE", (mode) => {
          receivedMode = mode;
          resolve();
        });
      });

      // Simulate receiving a MODE message for channel
      mockSocket.simulateMessage(
        ":ircuser!user@host MODE #testchannel +o nickname\r\n",
      );

      await modePromise;

      expect(receivedMode).toEqual({
        serverId: server.id,
        mtags: undefined,
        sender: "ircuser",
        target: "#testchannel",
        modestring: "+o",
        modeargs: ["nickname"],
      });
    });

    test("should parse MODE messages with multiple modes", async () => {
      const mockSocket = new MockWebSocket("ws://irc.example.com:443");
      MockWebSocketSpy.mockImplementation(returnsSocket(mockSocket));

      const connectionPromise = client.connect(
        "Test Server",
        "irc.example.com",
        443,
        "testuser",
      );

      mockSocket.simulateOpen();
      const server = await connectionPromise;

      // Set up event listener for MODE
      let receivedMode: unknown;
      const modePromise = new Promise<void>((resolve) => {
        client.on("MODE", (mode) => {
          receivedMode = mode;
          resolve();
        });
      });

      // Simulate receiving a MODE message with multiple modes
      mockSocket.simulateMessage(
        ":ircuser!user@host MODE #testchannel +ov-v nickname1 nickname2 nickname3\r\n",
      );

      await modePromise;

      expect(receivedMode).toEqual({
        serverId: server.id,
        mtags: undefined,
        sender: "ircuser",
        target: "#testchannel",
        modestring: "+ov-v",
        modeargs: ["nickname1", "nickname2", "nickname3"],
      });
    });

    test("should parse MODE messages for users", async () => {
      const mockSocket = new MockWebSocket("ws://irc.example.com:443");
      MockWebSocketSpy.mockImplementation(returnsSocket(mockSocket));

      const connectionPromise = client.connect(
        "Test Server",
        "irc.example.com",
        443,
        "testuser",
      );

      mockSocket.simulateOpen();
      const server = await connectionPromise;

      // Set up event listener for MODE
      let receivedMode: unknown;
      const modePromise = new Promise<void>((resolve) => {
        client.on("MODE", (mode) => {
          receivedMode = mode;
          resolve();
        });
      });

      // Simulate receiving a MODE message for user
      mockSocket.simulateMessage(":testuser!user@host MODE testuser +i\r\n");

      await modePromise;

      expect(receivedMode).toEqual({
        serverId: server.id,
        mtags: undefined,
        sender: "testuser",
        target: "testuser",
        modestring: "+i",
        modeargs: [],
      });
    });
  });

  describe("channel operations", () => {
    let mockSocket: MockWebSocket;
    let server: Server;

    beforeEach(async () => {
      mockSocket = new MockWebSocket("ws://irc.example.com:443");
      MockWebSocketSpy.mockImplementation(returnsSocket(mockSocket));

      const connectionPromise = client.connect(
        "Test Server",
        "irc.example.com",
        443,
        "testuser",
      );

      mockSocket.simulateOpen();
      server = await connectionPromise;
    });

    test("should send LIST command", () => {
      client.listChannels(server.id);
      expect(mockSocket.sentMessages).toContain("LIST");
    });

    test("should handle LIST responses", () => {
      const listChannelPromise = new Promise<void>((resolve) => {
        client.on("LIST_CHANNEL", (data) => {
          expect(data.channel).toBe("#testchannel");
          expect(data.userCount).toBe(42);
          expect(data.topic).toBe("Test topic");
          resolve();
        });
      });

      mockSocket.simulateMessage("322 * #testchannel 42 :Test topic\r\n");
      return listChannelPromise;
    });

    test("should handle LIST end", () => {
      const listEndPromise = new Promise<void>((resolve) => {
        client.on("LIST_END", (data) => {
          expect(data.serverId).toBe(server.id);
          resolve();
        });
      });

      mockSocket.simulateMessage("323 * :End of LIST\r\n");
      return listEndPromise;
    });

    test("should send RENAME command", () => {
      client.renameChannel(
        server.id,
        "#oldname",
        "#newname",
        "Channel renamed",
      );
      expect(mockSocket.sentMessages).toContain(
        "RENAME #oldname #newname :Channel renamed",
      );
    });

    test("should send RENAME command without reason", () => {
      client.renameChannel(server.id, "#oldname", "#newname");
      expect(mockSocket.sentMessages).toContain("RENAME #oldname #newname");
    });

    test("should handle RENAME response", () => {
      const renamePromise = new Promise<void>((resolve) => {
        client.on("RENAME", (data) => {
          expect(data.oldName).toBe("#oldchannel");
          expect(data.newName).toBe("#newchannel");
          expect(data.reason).toBe("Channel renamed");
          resolve();
        });
      });

      mockSocket.simulateMessage(
        ":server RENAME #oldchannel #newchannel :Channel renamed\r\n",
      );
      return renamePromise;
    });

    test("should send SETNAME command", () => {
      client.setName(server.id, "New Real Name");
      expect(mockSocket.sentMessages).toContain("SETNAME :New Real Name");
    });

    test("should handle SETNAME response", () => {
      const setnamePromise = new Promise<void>((resolve) => {
        client.on("SETNAME", (data) => {
          expect(data.user).toBe("testuser");
          expect(data.realname).toBe("New Real Name");
          resolve();
        });
      });

      mockSocket.simulateMessage(
        ":testuser!user@host SETNAME :New Real Name\r\n",
      );
      return setnamePromise;
    });
  });

  describe("draft/authtoken", () => {
    let mockSocket: MockWebSocket;
    let server: Server;

    beforeEach(async () => {
      mockSocket = new MockWebSocket("ws://irc.example.com:443");
      MockWebSocketSpy.mockImplementation(returnsSocket(mockSocket));
      const connectionPromise = client.connect(
        "Test Server",
        "irc.example.com",
        443,
        "testuser",
      );
      mockSocket.simulateOpen();
      server = await connectionPromise;
    });

    test("requestToken sends TOKEN GENERATE", () => {
      client.requestToken(server.id, "filehost");
      expect(mockSocket.sentMessages).toContain("TOKEN GENERATE filehost");
    });

    test("requestToken with scope appends scope", () => {
      client.requestToken(server.id, "filehost", "channel:#foo");
      expect(mockSocket.sentMessages).toContain(
        "TOKEN GENERATE filehost channel:#foo",
      );
    });

    test("parses TOKEN GENERATE reply", async () => {
      const got = new Promise<{ service: string; url: string; token: string }>(
        (resolve) => {
          client.on("TOKEN_GENERATE", (data) => {
            resolve({
              service: data.service,
              url: data.url,
              token: data.token,
            });
          });
        },
      );
      mockSocket.simulateMessage(
        ":irc.example.com TOKEN GENERATE filehost https://files.example.com :abc123\r\n",
      );
      const out = await got;
      expect(out.service).toBe("filehost");
      expect(out.url).toBe("https://files.example.com");
      expect(out.token).toBe("abc123");
    });
  });
});
