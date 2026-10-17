import { recordingFileName } from "./audioRecording";

const PHOTO_QUALITY = 0.92;

export const PHOTO_FILE_PREFIX = "photo";

/** Freezes the frame a video element is showing into a JPEG. The pixels are
 *  already in the page, so this needs no second camera capture and no shutter
 *  delay. Mirrored previews are drawn unmirrored, since the flip is there to
 *  make a front camera feel like a mirror rather than to change the photo. */
export async function capturePhotoFile(
  video: HTMLVideoElement,
): Promise<File | null> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), "image/jpeg", PHOTO_QUALITY);
  });
  if (!blob) return null;

  return new File([blob], recordingFileName(PHOTO_FILE_PREFIX, "jpg"), {
    type: "image/jpeg",
  });
}
