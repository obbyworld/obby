import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

vi.mock("../../../src/store", () => ({
  default: Object.assign(
    vi.fn((selector: (s: { servers: unknown[] }) => unknown) =>
      selector({ servers: [] }),
    ),
    { getState: vi.fn(() => ({ servers: [] })) },
  ),
}));

import {
  VoiceVideoBand,
  type VoiceVideoBandProps,
} from "../../../src/components/voice/VoiceVideoBand";
import type { VoiceMember } from "../../../src/lib/voice";

function member(nick: string): VoiceMember {
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
  };
}

function renderBand(overrides: Partial<VoiceVideoBandProps> = {}) {
  const props: VoiceVideoBandProps = {
    members: [member("me"), member("alice"), member("bob")],
    serverId: "s1",
    selfNick: "me",
    focusNick: "alice",
    onFocus: vi.fn(),
    reactions: [],
    onSetMuted: vi.fn(),
    onSetVolume: vi.fn(),
    isHost: false,
    onDemote: vi.fn(),
    status: <span>status-node</span>,
    actions: <span>actions-node</span>,
    dock: <span>dock-node</span>,
    isFullscreen: false,
    onToggleFullscreen: vi.fn(),
    ...overrides,
  };
  render(<VoiceVideoBand {...props} />);
  return props;
}

describe("VoiceVideoBand", () => {
  it("shows one control layer: main nick, status and actions, with no per-tile controls on the main video", () => {
    renderBand({ members: [member("me"), member("alice")] });
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("status-node")).toBeInTheDocument();
    expect(screen.getByText("actions-node")).toBeInTheDocument();
    expect(screen.queryByLabelText("Volume for alice")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mute for me" }),
    ).not.toBeInTheDocument();
  });

  it("makes a tapped thumbnail the main video even while it is the local user", () => {
    renderBand({ focusNick: "me" });
    const topBar = screen.getByText("status-node").parentElement;
    expect(topBar).toHaveTextContent("me");
    expect(topBar).not.toHaveTextContent("alice");
  });

  it("labels the fullscreen button by state and toggles on click", () => {
    const props = renderBand();
    fireEvent.click(screen.getByRole("button", { name: "Watch full screen" }));
    expect(props.onToggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it("offers exit when already fullscreen", () => {
    renderBand({ isFullscreen: true });
    expect(
      screen.getByRole("button", { name: "Exit full screen" }),
    ).toBeInTheDocument();
  });

  it("focuses another member when their compact tile is clicked", () => {
    const props = renderBand();
    fireEvent.click(screen.getByRole("button", { name: "bob" }));
    expect(props.onFocus).toHaveBeenCalledWith("bob");
  });
});
