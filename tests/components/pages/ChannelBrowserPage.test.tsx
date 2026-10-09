import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import ChannelBrowserPage from "../../../src/components/pages/ChannelBrowserPage";

const mocks = vi.hoisted(() => {
  const state = {
    servers: [
      {
        id: "server1",
        name: "Test Server",
        host: "irc.example.com",
        port: 6667,
        channels: [] as { id: string; name: string }[],
        privateChats: [],
      },
    ],
    ui: {
      selectedServerId: "server1",
      isNarrowView: false,
      perServerSelections: {},
    },
    globalSettings: { mediaVisibilityLevel: 0 },
    channelList: {
      server1: [
        { channel: "#channel1", userCount: 10, topic: "Topic 1" },
        { channel: "#channel2", userCount: 20, topic: "Topic 2" },
        { channel: "#channel3", userCount: 5, topic: "Topic 3" },
      ],
    } as Record<
      string,
      { channel: string; userCount: number; topic: string }[]
    >,
    listingInProgress: { server1: false } as Record<string, boolean>,
    channelMetadataCache: { server1: {} },
    channelMetadataFetchQueue: {},
    channelListFilters: { server1: {} },
    joinChannel: vi.fn(),
    selectChannel: vi.fn(),
    listChannels: vi.fn(),
    updateChannelListFilters: vi.fn(),
    closePage: vi.fn(),
  };
  return { state };
});

vi.mock("../../../src/store", () => {
  const useStore = Object.assign(
    vi.fn((selector?: (s: typeof mocks.state) => unknown) =>
      selector ? selector(mocks.state) : mocks.state,
    ),
    {
      getState: vi.fn(() => mocks.state),
      setState: vi.fn(),
    },
  );
  return { default: useStore };
});

const { state } = mocks;

describe("ChannelBrowserPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.channelList.server1 = [
      { channel: "#channel1", userCount: 10, topic: "Topic 1" },
      { channel: "#channel2", userCount: 20, topic: "Topic 2" },
      { channel: "#channel3", userCount: 5, topic: "Topic 3" },
    ];
    state.listingInProgress.server1 = false;
    state.servers[0].channels = [];
  });

  test("renders the channel list with its count", () => {
    render(
      <ChannelBrowserPage
        page={{ kind: "channelBrowser", serverId: "server1" }}
      />,
    );

    expect(screen.getByText("Browse channels")).toBeInTheDocument();
    expect(screen.getByText("3 channels")).toBeInTheDocument();
    expect(screen.getByText("channel1")).toBeInTheDocument();
    expect(screen.getByText("channel2")).toBeInTheDocument();
    expect(screen.getByText("channel3")).toBeInTheDocument();
  });

  test("displays topic and member count for each channel", () => {
    render(
      <ChannelBrowserPage
        page={{ kind: "channelBrowser", serverId: "server1" }}
      />,
    );

    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Topic 1")).toBeInTheDocument();
    expect(screen.getByText("Topic 2")).toBeInTheDocument();
    expect(screen.getByText("Topic 3")).toBeInTheDocument();
  });

  test("filters channels by name", () => {
    render(
      <ChannelBrowserPage
        page={{ kind: "channelBrowser", serverId: "server1" }}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search channels..."), {
      target: { value: "channel1" },
    });

    expect(screen.getByText("channel1")).toBeInTheDocument();
    expect(screen.queryByText("channel2")).not.toBeInTheDocument();
    expect(screen.queryByText("channel3")).not.toBeInTheDocument();
  });

  test("sorts channels by user count", () => {
    render(
      <ChannelBrowserPage
        page={{ kind: "channelBrowser", serverId: "server1" }}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "alpha" },
    });
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "users" },
    });

    const names = screen.getAllByText(/^channel/).map((el) => el.textContent);
    expect(names).toEqual(["channel2", "channel1", "channel3"]);
  });

  test("joins a channel from its row when it is not joined yet", () => {
    render(
      <ChannelBrowserPage
        page={{ kind: "channelBrowser", serverId: "server1" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Join #channel2" }));

    expect(state.joinChannel).toHaveBeenCalledWith("server1", "#channel2");
    expect(state.closePage).toHaveBeenCalled();
  });

  test("selects a joined channel and closes the page when its row is clicked", () => {
    state.servers[0].channels = [{ id: "chan-2", name: "#channel2" }];
    render(
      <ChannelBrowserPage
        page={{ kind: "channelBrowser", serverId: "server1" }}
      />,
    );

    expect(screen.getByText("Joined")).toBeInTheDocument();
    fireEvent.click(screen.getByText("channel2"));

    expect(state.selectChannel).toHaveBeenCalledWith("chan-2", {
      navigate: true,
    });
    expect(state.closePage).toHaveBeenCalled();
  });

  test("shows skeleton rows instead of channels while listing", () => {
    state.listingInProgress.server1 = true;
    render(
      <ChannelBrowserPage
        page={{ kind: "channelBrowser", serverId: "server1" }}
      />,
    );

    expect(screen.getByText("Browse channels")).toBeInTheDocument();
    expect(screen.queryByText("channel1")).not.toBeInTheDocument();
    expect(screen.queryByText("3 channels")).not.toBeInTheDocument();
  });

  test("shows filtered empty state", () => {
    render(
      <ChannelBrowserPage
        page={{ kind: "channelBrowser", serverId: "server1" }}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Search channels..."), {
      target: { value: "nonexistent" },
    });

    expect(
      screen.getByText("No channels found. Change the search or filters."),
    ).toBeInTheDocument();
  });

  test("goes back to chat when Back is clicked", () => {
    render(
      <ChannelBrowserPage
        page={{ kind: "channelBrowser", serverId: "server1" }}
      />,
    );

    fireEvent.click(screen.getByLabelText("Back"));

    expect(state.closePage).toHaveBeenCalled();
  });
});
