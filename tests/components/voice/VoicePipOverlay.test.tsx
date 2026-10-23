import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceMember } from "../../../src/lib/voice";
import useStore from "../../../src/store";
import type { Channel, Server } from "../../../src/types";

// jsdom doesn't implement HTMLMediaElement.play or MediaStream.
Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: vi.fn(() => Promise.resolve()),
});
vi.stubGlobal(
  "MediaStream",
  class {
    constructor(public tracks: MediaStreamTrack[] = []) {}
  },
);

const mocks = vi.hoisted(() => ({
  useLiveVoiceCalls: vi.fn(),
  useVoiceCall: vi.fn(),
  releaseVoiceClient: vi.fn(),
}));

vi.mock("../../../src/hooks/useVoiceCall", () => ({
  useLiveVoiceCalls: mocks.useLiveVoiceCalls,
  useVoiceCall: mocks.useVoiceCall,
}));

vi.mock("../../../src/lib/voice", () => ({
  releaseVoiceClient: mocks.releaseVoiceClient,
  // The real store module calls this once at import time to hand voice.ts a
  // way to read call-device settings without a static import cycle back in.
  setVoiceStore: vi.fn(),
}));

import { VoicePipOverlay } from "../../../src/components/voice/VoicePipOverlay";
import { setSpotlight } from "../../../src/lib/voiceSpotlight";

function member(
  nick: string,
  overrides: Partial<VoiceMember> = {},
): VoiceMember {
  return {
    nick,
    micOn: true,
    videoOn: false,
    speaking: false,
    deafened: false,
    screenSharing: false,
    handRaised: false,
    volume: 1,
    quality: "unknown",
    ...overrides,
  };
}

const channel: Channel = {
  id: "chan1",
  name: "^general",
  isPrivate: false,
  serverId: "s1",
  unreadCount: 0,
  isMentioned: false,
  messages: [],
  users: [],
};

const server: Server = {
  id: "s1",
  name: "Test Server",
  host: "irc.test.com",
  port: 6697,
  channels: [channel],
  privateChats: [],
  isConnected: true,
  users: [],
};

const selectServer = vi.fn();
const selectChannel = vi.fn();

function setSelection(selectedChannelId: string | null) {
  useStore.setState((state) => ({
    servers: [server],
    selectServer,
    selectChannel,
    ui: {
      ...state.ui,
      selectedServerId: "s1",
      perServerSelections: {
        s1: { selectedChannelId, selectedPrivateChatId: null },
      },
    },
  }));
}

describe("VoicePipOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSpotlight("s1", "^general", null);
    mocks.useVoiceCall.mockReturnValue({
      client: { setMic: vi.fn() },
      members: [member("me")],
      selfNick: "me",
      self: member("me"),
    });
  });

  it("renders nothing when there is no live call", () => {
    mocks.useLiveVoiceCalls.mockReturnValue([]);
    setSelection(null);
    const { container } = render(<VoicePipOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the live call is the channel on screen", () => {
    mocks.useLiveVoiceCalls.mockReturnValue([
      { serverId: "s1", channel: "^general" },
    ]);
    setSelection("chan1");
    const { container } = render(<VoicePipOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the pop-out for a live call on another channel", () => {
    mocks.useLiveVoiceCalls.mockReturnValue([
      { serverId: "s1", channel: "^general" },
    ]);
    setSelection(null);
    render(<VoicePipOverlay />);
    expect(screen.getByText("^general")).toBeInTheDocument();
  });

  it("returns to the channel", () => {
    mocks.useLiveVoiceCalls.mockReturnValue([
      { serverId: "s1", channel: "^general" },
    ]);
    setSelection(null);
    render(<VoicePipOverlay />);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Return to channel" })[0],
    );
    expect(selectServer).toHaveBeenCalledWith("s1");
    expect(selectChannel).toHaveBeenCalledWith("chan1", { navigate: true });
  });

  it("releases the call on hang-up", () => {
    mocks.useLiveVoiceCalls.mockReturnValue([
      { serverId: "s1", channel: "^general" },
    ]);
    setSelection(null);
    render(<VoicePipOverlay />);
    fireEvent.click(screen.getByRole("button", { name: "Leave call" }));
    expect(mocks.releaseVoiceClient).toHaveBeenCalledWith("s1", "^general");
  });

  it("shows one primary tile, three thumbnails and a +1 overflow with five members", () => {
    mocks.useLiveVoiceCalls.mockReturnValue([
      { serverId: "s1", channel: "^general" },
    ]);
    mocks.useVoiceCall.mockReturnValue({
      client: { setMic: vi.fn() },
      members: [
        member("me"),
        member("alice", { videoTrack: {} as MediaStreamTrack }),
        member("bob"),
        member("carol"),
        member("dave"),
      ],
      selfNick: "me",
      self: member("me"),
    });
    setSelection(null);
    render(<VoicePipOverlay />);

    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "bob" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "carol" })).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
  });

  it("promotes a tapped thumbnail to the primary tile", () => {
    mocks.useLiveVoiceCalls.mockReturnValue([
      { serverId: "s1", channel: "^general" },
    ]);
    mocks.useVoiceCall.mockReturnValue({
      client: { setMic: vi.fn() },
      members: [
        member("me"),
        member("alice", { videoTrack: {} as MediaStreamTrack }),
        member("bob"),
      ],
      selfNick: "me",
      self: member("me"),
    });
    setSelection(null);
    render(<VoicePipOverlay />);

    fireEvent.click(screen.getByRole("button", { name: "bob" }));

    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "bob" }),
    ).not.toBeInTheDocument();
  });

  it("excludes the local viewer's own tile from a stream room's pop-out", () => {
    mocks.useLiveVoiceCalls.mockReturnValue([
      { serverId: "s1", channel: "$movie" },
    ]);
    const streamer = member("alice", { videoTrack: {} as MediaStreamTrack });
    const me = member("me", { videoTrack: {} as MediaStreamTrack });
    mocks.useVoiceCall.mockReturnValue({
      client: { setMic: vi.fn() },
      members: [streamer, me],
      selfNick: "me",
      self: me,
      isStreamRoom: true,
      streamerMembers: [streamer],
    });
    setSelection(null);
    render(<VoicePipOverlay />);

    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.queryByText("me")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "me" }),
    ).not.toBeInTheDocument();
  });

  it("still shows the local user's own tile in a voice call", () => {
    mocks.useLiveVoiceCalls.mockReturnValue([
      { serverId: "s1", channel: "^general" },
    ]);
    const alice = member("alice", { videoTrack: {} as MediaStreamTrack });
    const me = member("me", { videoTrack: {} as MediaStreamTrack });
    mocks.useVoiceCall.mockReturnValue({
      client: { setMic: vi.fn() },
      members: [alice, me],
      selfNick: "me",
      self: me,
      isStreamRoom: false,
      streamerMembers: [alice, me],
    });
    setSelection(null);
    render(<VoicePipOverlay />);

    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "me" })).toBeInTheDocument();
  });

  it("renders avatars and no video when nobody in the call has a camera", () => {
    mocks.useLiveVoiceCalls.mockReturnValue([
      { serverId: "s1", channel: "^general" },
    ]);
    mocks.useVoiceCall.mockReturnValue({
      client: { setMic: vi.fn() },
      members: [member("me"), member("alice"), member("bob")],
      selfNick: "me",
      self: member("me"),
    });
    setSelection(null);
    const { container } = render(<VoicePipOverlay />);

    expect(container.querySelector("video")).toBeNull();
  });
});
