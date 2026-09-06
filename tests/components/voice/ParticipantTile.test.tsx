import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

vi.mock("../../../src/store", () => ({
  default: Object.assign(
    vi.fn((selector: (s: { servers: unknown[] }) => unknown) =>
      selector({ servers: [] }),
    ),
    { getState: vi.fn(() => ({ servers: [] })) },
  ),
}));

import { ParticipantTile } from "../../../src/components/voice/ParticipantTile";
import type { VoiceMember } from "../../../src/lib/voice";

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

describe("ParticipantTile", () => {
  it("renders the volume slider for another member but not for yourself", () => {
    const { rerender } = render(
      <ParticipantTile
        member={member("bob")}
        isSelf={false}
        onClick={vi.fn()}
        onSetMuted={vi.fn()}
        onSetVolume={vi.fn()}
        reactions={[]}
      />,
    );
    expect(screen.getByLabelText("Volume for bob")).toBeInTheDocument();

    rerender(
      <ParticipantTile
        member={member("alice")}
        isSelf={true}
        onClick={vi.fn()}
        onSetMuted={vi.fn()}
        onSetVolume={vi.fn()}
        reactions={[]}
      />,
    );
    expect(screen.queryByLabelText("Volume for alice")).not.toBeInTheDocument();
  });

  it("calls onSetVolume with the new value when the slider moves", () => {
    const onSetVolume = vi.fn();
    render(
      <ParticipantTile
        member={member("bob")}
        isSelf={false}
        onClick={vi.fn()}
        onSetMuted={vi.fn()}
        onSetVolume={onSetVolume}
        reactions={[]}
      />,
    );
    fireEvent.change(screen.getByLabelText("Volume for bob"), {
      target: { value: "0.5" },
    });
    expect(onSetVolume).toHaveBeenCalledWith("bob", 0.5);
  });

  it("calls onSetMuted with the inverted state from the speaker button", () => {
    const onSetMuted = vi.fn();
    render(
      <ParticipantTile
        member={member("bob", { volume: 1 })}
        isSelf={false}
        onClick={vi.fn()}
        onSetMuted={onSetMuted}
        onSetVolume={vi.fn()}
        reactions={[]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Mute for me/i }));
    expect(onSetMuted).toHaveBeenCalledWith("bob", true);
  });

  it("shows the demote button only when canDemote is set", () => {
    const { rerender } = render(
      <ParticipantTile
        member={member("bob")}
        isSelf={false}
        onClick={vi.fn()}
        onSetMuted={vi.fn()}
        onSetVolume={vi.fn()}
        reactions={[]}
        canDemote={false}
        onDemote={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Demote to viewer/i }),
    ).not.toBeInTheDocument();

    const onDemote = vi.fn();
    rerender(
      <ParticipantTile
        member={member("bob")}
        isSelf={false}
        onClick={vi.fn()}
        onSetMuted={vi.fn()}
        onSetVolume={vi.fn()}
        reactions={[]}
        canDemote={true}
        onDemote={onDemote}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Demote to viewer/i }));
    expect(onDemote).toHaveBeenCalledWith("bob");
  });

  it("shows the nick without hovering", () => {
    render(
      <ParticipantTile
        member={member("bob")}
        isSelf={false}
        onClick={vi.fn()}
        onSetMuted={vi.fn()}
        onSetVolume={vi.fn()}
        reactions={[]}
      />,
    );
    expect(screen.getByText("bob")).toBeInTheDocument();
  });

  it("only renders a maximize button when told it is the main tile", () => {
    const { rerender } = render(
      <ParticipantTile
        member={member("bob")}
        isSelf={false}
        onClick={vi.fn()}
        onSetMuted={vi.fn()}
        onSetVolume={vi.fn()}
        reactions={[]}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Expand/i }),
    ).not.toBeInTheDocument();

    const onToggleTheater = vi.fn();
    rerender(
      <ParticipantTile
        member={member("bob")}
        isSelf={false}
        onClick={vi.fn()}
        onSetMuted={vi.fn()}
        onSetVolume={vi.fn()}
        reactions={[]}
        theater={false}
        onToggleTheater={onToggleTheater}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Expand/i }));
    expect(onToggleTheater).toHaveBeenCalledTimes(1);

    rerender(
      <ParticipantTile
        member={member("bob")}
        isSelf={false}
        onClick={vi.fn()}
        onSetMuted={vi.fn()}
        onSetVolume={vi.fn()}
        reactions={[]}
        theater={true}
        onToggleTheater={onToggleTheater}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Collapse/i }),
    ).toBeInTheDocument();
  });

  it("hides the volume slider but keeps the mute button when compact", () => {
    render(
      <ParticipantTile
        member={member("bob")}
        isSelf={false}
        onClick={vi.fn()}
        onSetMuted={vi.fn()}
        onSetVolume={vi.fn()}
        reactions={[]}
        compact={true}
      />,
    );
    expect(screen.queryByLabelText("Volume for bob")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Mute for me/i }),
    ).toBeInTheDocument();
  });

  it("letterboxes the main tile but crops a plain grid tile", () => {
    const track = {} as MediaStreamTrack;
    const { rerender } = render(
      <ParticipantTile
        member={member("bob", { videoTrack: track })}
        isSelf={false}
        onClick={vi.fn()}
        onSetMuted={vi.fn()}
        onSetVolume={vi.fn()}
        reactions={[]}
      />,
    );
    expect(document.querySelector("video")).toHaveClass("object-cover");

    rerender(
      <ParticipantTile
        member={member("bob", { videoTrack: track })}
        isSelf={false}
        onClick={vi.fn()}
        onSetMuted={vi.fn()}
        onSetVolume={vi.fn()}
        reactions={[]}
        mainTile
      />,
    );
    expect(document.querySelector("video")).toHaveClass("object-contain");
  });

  it("crops a filmstrip thumbnail even in theater mode, but letterboxes a plain grid tile once theater enlarges it", () => {
    const track = {} as MediaStreamTrack;
    const { rerender } = render(
      <ParticipantTile
        member={member("bob", { videoTrack: track })}
        isSelf={false}
        onClick={vi.fn()}
        onSetMuted={vi.fn()}
        onSetVolume={vi.fn()}
        reactions={[]}
        compact
        theater
      />,
    );
    expect(document.querySelector("video")).toHaveClass("object-cover");

    rerender(
      <ParticipantTile
        member={member("bob", { videoTrack: track })}
        isSelf={false}
        onClick={vi.fn()}
        onSetMuted={vi.fn()}
        onSetVolume={vi.fn()}
        reactions={[]}
        theater
      />,
    );
    expect(document.querySelector("video")).toHaveClass("object-contain");
  });

  it("clicks the tile face without triggering it from the bottom-bar controls", () => {
    const onClick = vi.fn();
    const onSetMuted = vi.fn();
    render(
      <ParticipantTile
        member={member("bob")}
        isSelf={false}
        onClick={onClick}
        onSetMuted={onSetMuted}
        onSetVolume={vi.fn()}
        reactions={[]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Mute for me/i }));
    expect(onSetMuted).toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("bob"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
