import { afterEach, describe, expect, it, vi } from "vitest";
import { exposeAppLifecycleHooks } from "../../src/lib/nativeCallBridge";

function callVideo(isPaused: boolean): HTMLVideoElement {
  const video = document.createElement("video");
  video.setAttribute("data-call-video", "");
  Object.defineProperty(video, "paused", { value: isPaused });
  video.play = vi.fn(() => Promise.resolve());
  document.body.append(video);
  return video;
}

describe("app lifecycle hooks", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("restarts call videos that iOS paused while the app was away", () => {
    const paused = callVideo(true);
    const playing = callVideo(false);
    exposeAppLifecycleHooks();

    window.ObbyApp?.didBecomeActive();

    expect(paused.play).toHaveBeenCalled();
    expect(playing.play).not.toHaveBeenCalled();
  });
});
