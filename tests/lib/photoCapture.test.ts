import { afterEach, describe, expect, test, vi } from "vitest";
import { capturePhotoFile } from "../../src/lib/photoCapture";

function fakeVideo(width: number, height: number): HTMLVideoElement {
  return { videoWidth: width, videoHeight: height } as HTMLVideoElement;
}

function stubCanvas(blob: Blob | null) {
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toBlob: (cb: (b: Blob | null) => void) => cb(blob),
  } as unknown as HTMLCanvasElement;
  const create = vi
    .spyOn(document, "createElement")
    .mockReturnValue(canvas as unknown as HTMLElement);
  return { canvas, drawImage, create };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("capturePhotoFile", () => {
  test("writes the frame at the camera's own resolution", async () => {
    const { canvas, drawImage } = stubCanvas(new Blob(["x"]));

    const file = await capturePhotoFile(fakeVideo(1280, 720));

    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(720);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1280, 720);
    expect(file?.type).toBe("image/jpeg");
    expect(file?.name).toMatch(/^photo-\d{4}-\d{2}-\d{2}-\d{6}\.jpg$/);
  });

  // A camera that has not produced a frame yet reports a zero size, and
  // drawing that gives a blank image rather than a photo.
  test("gives nothing back before the camera has a frame", async () => {
    const { drawImage } = stubCanvas(new Blob(["x"]));

    expect(await capturePhotoFile(fakeVideo(0, 0))).toBeNull();
    expect(drawImage).not.toHaveBeenCalled();
  });

  test("gives nothing back when the encode fails", async () => {
    stubCanvas(null);

    expect(await capturePhotoFile(fakeVideo(640, 480))).toBeNull();
  });
});
