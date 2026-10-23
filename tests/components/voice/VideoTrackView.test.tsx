import { render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { VideoTrackView } from "../../../src/components/voice/VideoTrackView";

// jsdom doesn't implement HTMLMediaElement.play or MediaStream.
Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: vi.fn(() => Promise.resolve()),
});

class FakeMediaStream {
  tracks: MediaStreamTrack[];
  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = tracks;
  }
}
vi.stubGlobal("MediaStream", FakeMediaStream);

function makeTrack(id: string): MediaStreamTrack {
  return { id, kind: "video" } as unknown as MediaStreamTrack;
}

describe("VideoTrackView", () => {
  it("binds the track to a MediaStream on the video element", () => {
    const track = makeTrack("t1");
    const ref = createRef<HTMLVideoElement>();
    render(<VideoTrackView track={track} ref={ref} />);
    const stream = ref.current?.srcObject as unknown as FakeMediaStream;
    expect(stream).toBeInstanceOf(FakeMediaStream);
    expect(stream.tracks).toEqual([track]);
  });

  it("clears srcObject when the track is removed", () => {
    const track = makeTrack("t1");
    const ref = createRef<HTMLVideoElement>();
    const { rerender } = render(<VideoTrackView track={track} ref={ref} />);
    rerender(<VideoTrackView track={undefined} ref={ref} />);
    expect(ref.current?.srcObject).toBeNull();
  });
});
