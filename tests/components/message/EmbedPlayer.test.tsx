import { act, render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { EmbedPlayer } from "../../../src/components/message/EmbedPlayer";

vi.mock("../../../src/lib/mediaUtils", () => ({
  getAppYouTubeEmbedUrl: (url: string, startAt = 0) =>
    `http://localhost:5000/youtube-embed.html?v=abcdefghijk${startAt ? `&start=${startAt}` : ""}`,
}));

const fromPlayer = (iframe: HTMLIFrameElement, data: object) =>
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "obby-yt", ...data },
        source: iframe.contentWindow,
      }),
    );
  });

describe("EmbedPlayer on the loopback YouTube page", () => {
  test("relays player events and resumes from the given position", () => {
    const onPlay = vi.fn();
    const onTime = vi.fn();
    const { container } = render(
      <EmbedPlayer
        url="https://youtu.be/abcdefghijk"
        startAt={42}
        onPlay={onPlay}
        onTime={onTime}
      />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    expect(iframe.src).toContain("start=42");

    fromPlayer(iframe, { type: "play" });
    fromPlayer(iframe, { type: "time", time: 12.5 });
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onTime).toHaveBeenCalledWith(12.5);
  });

  test("sends play and pause as the playing prop changes", () => {
    const { container, rerender } = render(
      <EmbedPlayer url="https://youtu.be/abcdefghijk" playing={false} />,
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const post = vi.spyOn(iframe.contentWindow as Window, "postMessage");

    rerender(<EmbedPlayer url="https://youtu.be/abcdefghijk" playing />);
    expect(post).toHaveBeenLastCalledWith(
      { source: "obby-yt-cmd", cmd: "play" },
      "*",
    );
    rerender(
      <EmbedPlayer url="https://youtu.be/abcdefghijk" playing={false} />,
    );
    expect(post).toHaveBeenLastCalledWith(
      { source: "obby-yt-cmd", cmd: "pause" },
      "*",
    );
  });
});
