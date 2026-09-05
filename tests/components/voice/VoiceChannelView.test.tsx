import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  VoiceMember,
  VoiceMode,
  VoiceRole,
  VoiceState,
} from "../../../src/lib/voice";

const mocks = vi.hoisted(() => ({
  useVoiceCall: vi.fn(),
  releaseVoiceClient: vi.fn(),
  selectChannel: vi.fn(),
}));

vi.mock("../../../src/hooks/useVoiceCall", () => ({
  useVoiceCall: mocks.useVoiceCall,
}));

vi.mock("../../../src/lib/voice", () => ({
  releaseVoiceClient: mocks.releaseVoiceClient,
}));

import { setSpotlight } from "../../../src/lib/voiceSpotlight";

vi.mock("../../../src/store", () => {
  const state = { servers: [], selectChannel: mocks.selectChannel };
  const useStore = Object.assign(
    vi.fn((selector: (s: typeof state) => unknown) =>
      typeof selector === "function" ? selector(state) : state,
    ),
    { getState: vi.fn(() => state) },
  );
  return { default: useStore };
});

let isNarrow = false;
let isTouch = false;
vi.mock("../../../src/hooks/useMediaQuery", () => ({
  useMediaQuery: (query?: string) =>
    query === "(pointer: coarse)" ? isTouch : isNarrow,
}));

import { VoiceChannelView } from "../../../src/components/layout/VoiceChannelView";

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

function fakeClient() {
  return {
    isPushToTalk: vi.fn(() => false),
    isDeafened: vi.fn(() => false),
    setMic: vi.fn(),
    setVideo: vi.fn(),
    setScreenShare: vi.fn(),
    setDeafened: vi.fn(),
    setHandRaised: vi.fn(),
    setPushToTalk: vi.fn(),
    demote: vi.fn(),
    promote: vi.fn(),
    sendReaction: vi.fn(),
    setMemberMuted: vi.fn(),
    setMemberVolume: vi.fn(),
  };
}

function mockCall(overrides: {
  state: VoiceState;
  members?: VoiceMember[];
  selfNick?: string;
  mode?: VoiceMode;
  role?: VoiceRole;
  streamers?: string[];
}) {
  const members = overrides.members ?? [];
  const selfNick = overrides.selfNick ?? "alice";
  const mode = overrides.mode ?? "voice";
  const role = overrides.role ?? "streamer";
  const streamers = overrides.streamers ?? [];
  const isStreamRoom = mode === "stream";
  const streamerMembers = isStreamRoom
    ? members.filter((m) => streamers.includes(m.nick))
    : members;
  const viewerMembers = isStreamRoom
    ? members.filter((m) => !streamers.includes(m.nick))
    : [];
  mocks.useVoiceCall.mockReturnValue({
    state: overrides.state,
    error: null,
    clearError: vi.fn(),
    reactions: [],
    client: overrides.state.phase === "connected" ? fakeClient() : null,
    selfNick,
    members,
    self: members.find((m) => m.nick === selfNick),
    mode,
    role,
    streamers,
    isStreamRoom,
    isStreamer: role === "streamer",
    isHost: isStreamRoom && streamers[0] === selfNick,
    streamerMembers,
    viewerMembers,
  });
}

describe("VoiceChannelView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isNarrow = false;
    isTouch = false;
    setSpotlight("s1", "^general", null);
  });

  it("shows the connecting status while joining", () => {
    mockCall({ state: { phase: "joining" } });
    render(<VoiceChannelView serverId="s1" channelName="^general" />);
    expect(screen.getByText(/Connecting/)).toBeInTheDocument();
  });

  it("renders a tile per member when connected", () => {
    mockCall({
      state: {
        phase: "connected",
        members: {},
        mode: "voice",
        role: "streamer",
        streamers: [],
      },
      members: [member("alice"), member("bob"), member("carol")],
    });
    render(<VoiceChannelView serverId="s1" channelName="^general" />);
    expect(screen.getByLabelText("alice")).toBeInTheDocument();
    expect(screen.getByLabelText("bob")).toBeInTheDocument();
    expect(screen.getByLabelText("carol")).toBeInTheDocument();
  });

  it("spotlights a clicked tile and clears it via exit spotlight", () => {
    mockCall({
      state: {
        phase: "connected",
        members: {},
        mode: "voice",
        role: "streamer",
        streamers: [],
      },
      members: [member("alice"), member("bob"), member("carol")],
    });
    render(<VoiceChannelView serverId="s1" channelName="^general" />);

    expect(
      screen.queryByRole("button", { name: /Exit spotlight/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("bob"));

    expect(
      screen.getByRole("button", { name: /Exit spotlight/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Exit spotlight/i }));

    expect(
      screen.queryByRole("button", { name: /Exit spotlight/i }),
    ).not.toBeInTheDocument();
  });

  it("does not spotlight or show exit spotlight with a single member", () => {
    mockCall({
      state: {
        phase: "connected",
        members: {},
        mode: "voice",
        role: "streamer",
        streamers: [],
      },
      members: [member("alice")],
    });
    render(<VoiceChannelView serverId="s1" channelName="^general" />);

    fireEvent.click(screen.getByLabelText("alice"));

    expect(
      screen.queryByRole("button", { name: /Exit spotlight/i }),
    ).not.toBeInTheDocument();
  });

  it("releases the call when leaving", () => {
    mockCall({
      state: {
        phase: "connected",
        members: {},
        mode: "voice",
        role: "streamer",
        streamers: [],
      },
      members: [member("alice")],
    });
    render(<VoiceChannelView serverId="s1" channelName="^general" />);

    fireEvent.click(screen.getByRole("button", { name: /Leave call/i }));

    expect(mocks.releaseVoiceClient).toHaveBeenCalledWith("s1", "^general");
  });

  it("shows react but hides screen-share on the narrow/touch layout", () => {
    isNarrow = true;
    isTouch = true;
    mockCall({
      state: {
        phase: "connected",
        members: {},
        mode: "voice",
        role: "streamer",
        streamers: [],
      },
      members: [member("alice"), member("bob")],
    });
    render(<VoiceChannelView serverId="s1" channelName="^general" />);

    expect(screen.getByRole("button", { name: /React/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Share screen/i }),
    ).not.toBeInTheDocument();
  });

  it("caps the stage at six tiles and puts the rest in an overflow strip", () => {
    const many = Array.from({ length: 8 }, (_, i) => member(`user${i + 1}`));
    mockCall({
      state: {
        phase: "connected",
        members: {},
        mode: "voice",
        role: "streamer",
        streamers: [],
      },
      members: many,
    });
    render(<VoiceChannelView serverId="s1" channelName="^general" />);

    for (let i = 1; i <= 6; i++) {
      expect(screen.getByLabelText(`user${i}`)).toBeInTheDocument();
    }
    for (let i = 7; i <= 8; i++) {
      expect(screen.queryByLabelText(`user${i}`)).not.toBeInTheDocument();
    }
  });

  it("promotes a newly-speaking member into the visible set", () => {
    const many = Array.from({ length: 8 }, (_, i) => member(`user${i + 1}`));
    many[7] = member("user8", { speaking: true });
    mockCall({
      state: {
        phase: "connected",
        members: {},
        mode: "voice",
        role: "streamer",
        streamers: [],
      },
      members: many,
    });
    render(<VoiceChannelView serverId="s1" channelName="^general" />);

    expect(screen.getByLabelText("user8")).toBeInTheDocument();
  });

  it("toggles the theater overlay on expand and closes it on Escape", () => {
    mockCall({
      state: {
        phase: "connected",
        members: {},
        mode: "voice",
        role: "streamer",
        streamers: [],
      },
      members: [member("alice")],
    });
    render(<VoiceChannelView serverId="s1" channelName="^general" />);

    fireEvent.click(screen.getByRole("button", { name: /Expand/i }));
    expect(
      screen.getByRole("button", { name: /Collapse/i }),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: /Expand/i })).toBeInTheDocument();
  });
});
