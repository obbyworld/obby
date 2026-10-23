import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useIsVideoPipActive } from "../../../src/components/voice/VideoTrackView";

function setPipElement(value: Element | null) {
  Object.defineProperty(document, "pictureInPictureElement", {
    configurable: true,
    value,
  });
}

describe("useIsVideoPipActive", () => {
  afterEach(() => {
    setPipElement(null);
    document.body.innerHTML = "";
  });

  it("follows the standard picture-in-picture events", () => {
    const video = document.createElement("video");
    document.body.appendChild(video);
    const { result } = renderHook(() => useIsVideoPipActive());
    expect(result.current).toBe(false);

    setPipElement(video);
    act(() => {
      video.dispatchEvent(new Event("enterpictureinpicture"));
    });
    expect(result.current).toBe(true);

    setPipElement(null);
    act(() => {
      video.dispatchEvent(new Event("leavepictureinpicture"));
    });
    expect(result.current).toBe(false);
  });

  it("follows the WebKit presentation mode", () => {
    const video = document.createElement("video");
    document.body.appendChild(video);
    const { result } = renderHook(() => useIsVideoPipActive());

    Object.defineProperty(video, "webkitPresentationMode", {
      configurable: true,
      value: "picture-in-picture",
    });
    act(() => {
      video.dispatchEvent(new Event("webkitpresentationmodechanged"));
    });
    expect(result.current).toBe(true);

    Object.defineProperty(video, "webkitPresentationMode", {
      configurable: true,
      value: "inline",
    });
    act(() => {
      video.dispatchEvent(new Event("webkitpresentationmodechanged"));
    });
    expect(result.current).toBe(false);
  });
});
