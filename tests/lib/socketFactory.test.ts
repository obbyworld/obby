import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  bufferedAmount = 0;
  extensions = "";
  protocol = "";
  binaryType: BinaryType = "blob";
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  send(): void {}

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);

import {
  createSocket,
  resetSocketFactory,
  setSocketFactory,
  TCPSocket,
  WebSocketWrapper,
} from "../../src/lib/socket";

describe("socket factory", () => {
  afterEach(() => {
    resetSocketFactory();
    vi.clearAllMocks();
  });

  it("allows a custom socket factory to be injected", () => {
    const fakeSocket = {
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      send: vi.fn(),
      close: vi.fn(),
      readyState: 1,
    };
    const factory = vi.fn(() => fakeSocket);

    setSocketFactory(factory);

    const socket = createSocket("wss://irc.example.com:443");

    expect(factory).toHaveBeenCalledWith("wss://irc.example.com:443");
    expect(socket).toBe(fakeSocket);
  });

  it("keeps websocket routing as the default behavior", () => {
    const socket = createSocket("wss://irc.example.com:443");

    expect(socket).toBeInstanceOf(WebSocketWrapper);
  });

  it("keeps tauri tcp/tls routing as the default behavior", () => {
    const socket = createSocket("ircs://irc.example.com:6697");

    expect(socket).toBeInstanceOf(TCPSocket);
  });
});
