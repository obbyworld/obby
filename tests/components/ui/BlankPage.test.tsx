import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import BlankPage from "../../../src/components/ui/BlankPage";

const mocks = vi.hoisted(() => {
  const state = {
    servers: [
      {
        id: "server1",
        name: "Test Server",
        isRegistered: true,
        channels: [] as { id: string; name: string }[],
        privateChats: [],
      },
    ],
    ui: {
      selectedServerId: "server1",
      isNarrowView: false,
      perServerSelections: {},
    },
    globalSettings: { mediaVisibilityLevel: 0, showMotd: false },
    channelList: {
      server1: [
        { channel: "#quiet", userCount: 2, topic: "" },
        { channel: "#busy", userCount: 40, topic: "" },
      ],
    },
    listingInProgress: { server1: false },
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
    { getState: vi.fn(() => mocks.state), setState: vi.fn() },
  );
  return { default: useStore };
});

const { state } = mocks;

describe("BlankPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.servers[0].isRegistered = true;
  });

  test("lists the server's channels with the busiest first", () => {
    render(<BlankPage />);

    expect(state.listChannels).toHaveBeenCalledWith("server1");
    const rows = screen.getAllByRole("button", { name: /^Join #/ });
    expect(rows.map((row) => row.getAttribute("data-channel"))).toEqual([
      "#busy",
      "#quiet",
    ]);
  });

  test("joins a channel from the list without closing any page", () => {
    render(<BlankPage />);

    fireEvent.click(screen.getByRole("button", { name: "Join #busy" }));

    expect(state.joinChannel).toHaveBeenCalledWith("server1", "#busy");
    expect(state.closePage).not.toHaveBeenCalled();
  });

  test("skips the list until the server finishes registration", () => {
    state.servers[0].isRegistered = false;
    render(<BlankPage />);

    expect(state.listChannels).not.toHaveBeenCalled();
    expect(screen.queryByText("busy")).not.toBeInTheDocument();
  });
});
