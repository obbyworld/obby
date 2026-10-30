import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionStrip } from "../../../src/components/layout/ConnectionStrip";
import type { Server } from "../../../src/types";

const reconnectServer = vi.fn();
const openPage = vi.fn();

vi.mock("../../../src/store", () => {
  const mockStore = vi.fn((selector: (state: unknown) => unknown) =>
    selector({ reconnectServer, openPage }),
  );
  return { default: mockStore };
});

vi.mock("../../../src/components/layout/NetworkMenu", () => ({
  editConnection: vi.fn(),
}));

function renderSettled(server: Server) {
  const result = render(<ConnectionStrip server={server} />);
  act(() => {
    vi.advanceTimersByTime(10_000);
  });
  return result;
}

const baseServer: Server = {
  id: "server1",
  name: "Test Server",
  host: "irc.test.com",
  port: 6667,
  channels: [],
  privateChats: [],
  isConnected: true,
  users: [],
  connectionState: "connected",
};

describe("ConnectionStrip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays quiet while a fresh connection is still coming up", () => {
    const { container } = render(
      <ConnectionStrip
        server={{ ...baseServer, connectionState: "disconnected" }}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for a healthy connected server", () => {
    const { container } = render(<ConnectionStrip server={baseServer} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("waits again when the connection drops a second time", () => {
    const lost = { ...baseServer, connectionState: "disconnected" as const };
    const { container, rerender } = render(<ConnectionStrip server={lost} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    rerender(<ConnectionStrip server={baseServer} />);
    rerender(<ConnectionStrip server={lost} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a reconnect button when disconnected and calls reconnectServer with the server id", () => {
    renderSettled({ ...baseServer, connectionState: "disconnected" });
    const button = screen.getByRole("button", { name: /reconnect/i });
    fireEvent.click(button);
    expect(reconnectServer).toHaveBeenCalledWith("server1");
  });

  it("only shows the edit button while reconnecting", () => {
    renderSettled({ ...baseServer, connectionState: "reconnecting" });
    expect(
      screen.queryByRole("button", { name: /reconnect/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
  });

  it("opens the login form from 'Log in again' when SASL failed", () => {
    renderSettled({ ...baseServer, isConnected: true, saslFailed: true });
    fireEvent.click(screen.getByRole("button", { name: /log in again/i }));
    expect(openPage).toHaveBeenCalledWith({
      kind: "serverSettings",
      serverId: "server1",
      section: "auth",
    });
  });
});
