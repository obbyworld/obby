import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionStrip } from "../../../src/components/layout/ConnectionStrip";
import type { Server } from "../../../src/types";

const reconnectServer = vi.fn();

vi.mock("../../../src/store", () => {
  const mockStore = vi.fn((selector: (state: unknown) => unknown) =>
    selector({ reconnectServer }),
  );
  return { default: mockStore };
});

vi.mock("../../../src/components/layout/NetworkMenu", () => ({
  editConnection: vi.fn(),
}));

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
  });

  it("renders nothing for a healthy connected server", () => {
    const { container } = render(<ConnectionStrip server={baseServer} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a reconnect button when disconnected and calls reconnectServer with the server id", () => {
    render(
      <ConnectionStrip
        server={{ ...baseServer, connectionState: "disconnected" }}
      />,
    );
    const button = screen.getByRole("button", { name: /reconnect/i });
    fireEvent.click(button);
    expect(reconnectServer).toHaveBeenCalledWith("server1");
  });

  it("only shows the edit button while reconnecting", () => {
    render(
      <ConnectionStrip
        server={{ ...baseServer, connectionState: "reconnecting" }}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /reconnect/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
  });

  it("shows 'Log in again' when connected but SASL failed", () => {
    render(
      <ConnectionStrip
        server={{ ...baseServer, isConnected: true, saslFailed: true }}
      />,
    );
    expect(
      screen.getByRole("button", { name: /log in again/i }),
    ).toBeInTheDocument();
  });
});
