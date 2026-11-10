import { recordingFileName } from "./audioRecording";
import type { QuarterTurn } from "./deviceRotation";

const PHOTO_QUALITY = 0.92;

export const PHOTO_FILE_PREFIX = "photo";

interface StillCapture {
  takePhoto: () => Promise<Blob>;
}
type StillCaptureConstructor = new (track: MediaStreamTrack) => StillCapture;

/** A full-resolution still from the camera where the platform offers one. The
 *  still can take a moment, so we fall back to the frame on screen when it
 *  fails. */
async function takeStill(
  track: MediaStreamTrack | undefined,
): Promise<ImageBitmap | null> {
  const ImageCapture = (
    globalThis as { ImageCapture?: StillCaptureConstructor }
  ).ImageCapture;
  if (!track || !ImageCapture) return null;
  try {
    return await createImageBitmap(await new ImageCapture(track).takePhoto());
  } catch (error) {
    if (error instanceof DOMException) return null;
    throw error;
  }
}

/** Saves a photo from the camera as a JPEG, turned clockwise by `rotation`
 *  degrees so it comes out upright however the phone was held. Mirrored
 *  previews are drawn unmirrored, since the flip only makes a front camera
 *  feel like a mirror. The JPEG carries no EXIF, so no location or device
 *  details leave with it. */
export async function capturePhotoFile(
  video: HTMLVideoElement,
  options: { track?: MediaStreamTrack; rotation?: QuarterTurn } = {},
): Promise<File | null> {
  const still = await takeStill(options.track);
  const source: CanvasImageSource = still ?? video;
  const width = still?.width ?? video.videoWidth;
  const height = still?.height ?? video.videoHeight;
  if (!width || !height) return null;

  const rotation = options.rotation ?? 0;
  const isSideways = rotation === 90 || rotation === 270;
  const canvas = document.createElement("canvas");
  canvas.width = isSideways ? height : width;
  canvas.height = isSideways ? width : height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(source, -width / 2, -height / 2, width, height);
  still?.close();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/jpeg", PHOTO_QUALITY);
  });
  if (!blob) return null;

  return new File([blob], recordingFileName(PHOTO_FILE_PREFIX, "jpg"), {
    type: "image/jpeg",
  });
}
