import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProfilePane from "../../../src/components/layout/ProfilePane";
import ircClient from "../../../src/lib/ircClient";
import useStore from "../../../src/store";

const target = { serverId: "server1", username: "alice" };

const setupStore = ({
  isNarrowView,
  whoisData,
}: {
  isNarrowView: boolean;
  whoisData?: unknown;
}) => {
  const state = useStore.getState();
  useStore.setState({
    ui: { ...state.ui, isNarrowView },
    servers: [
      {
        id: "server1",
        name: "Test",
        host: "irc.test.com",
        port: 6667,
        channels: [],
        users: [],
        privateChats: [
          {
            id: "pc1",
            username: "alice",
            serverId: "server1",
            unreadCount: 0,
            isPinned: false,
            isMentioned: false,
            lastActivity: new Date(),
          },
        ],
        isConnected: true,
        connectionState: "connected",
      },
    ],
    whoisData: whoisData ? { server1: { alice: whoisData } } : {},
  } as never);
};

describe("ProfilePane", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requests WHOIS and metadata for the target when it has no WHOIS data yet", () => {
    const whois = vi.spyOn(ircClient, "whois").mockImplementation(() => {});
    const metadataGet = vi.fn();
    useStore.setState({ metadataGet } as never);
    setupStore({ isNarrowView: false });

    render(<ProfilePane target={target} />);

    expect(whois).toHaveBeenCalledWith("server1", "alice");
    expect(metadataGet).toHaveBeenCalledWith(
      "server1",
      "alice",
      expect.arrayContaining(["avatar", "homepage"]),
    );
  });

  it("closes the pane from the back chevron on narrow screens", () => {
    vi.spyOn(ircClient, "whois").mockImplementation(() => {});
    const closeProfile = vi.fn();
    useStore.setState({ closeProfile } as never);
    setupStore({ isNarrowView: true });

    render(<ProfilePane target={target} />);
    fireEvent.click(screen.getByLabelText("Back"));

    expect(closeProfile).toHaveBeenCalled();
  });

  it("opens the private chat and closes the pane on narrow screens", () => {
    vi.spyOn(ircClient, "whois").mockImplementation(() => {});
    const selectPrivateChat = vi.fn();
    const closeProfile = vi.fn();
    useStore.setState({
      selectPrivateChat,
      closeProfile,
      openPrivateChat: vi.fn(),
    } as never);
    setupStore({ isNarrowView: true });

    render(<ProfilePane target={target} />);
    fireEvent.click(screen.getByText("Message"));

    expect(selectPrivateChat).toHaveBeenCalledWith("pc1", { navigate: true });
    expect(closeProfile).toHaveBeenCalled();
  });

  it("shows the detail of the session picked from the session tabs", () => {
    vi.spyOn(ircClient, "whois").mockImplementation(() => {});
    setupStore({
      isNarrowView: false,
      whoisData: {
        isComplete: true,
        timestamp: Date.now(),
        sessionCount: 2,
        sessions: [
          { ordinal: 1, ip: "192.0.2.1", idle: 5 },
          { ordinal: 2, ip: "198.51.100.7", idle: 9 },
        ],
      },
    });

    render(<ProfilePane target={target} />);
    expect(screen.getByText("192.0.2.1")).toBeTruthy();
    fireEvent.click(screen.getByText("Session 2"));
    expect(screen.getByText("198.51.100.7")).toBeTruthy();
  });
});
