import { invoke } from "@tauri-apps/api/core";
import { availableMonitors } from "@tauri-apps/api/window";
import { isTauriDesktop } from "./platformUtils";
import type { SelectedRegion } from "./screenRegion";

export interface DesktopRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the rectangle sits on the desktop as a whole, in points, which is what
 *  a command-line recorder is given. */
export async function desktopRectFor(
  selection: SelectedRegion,
): Promise<DesktopRect | null> {
  const monitors = await availableMonitors();
  const monitor = monitors[selection.monitor];
  if (!monitor) return null;
  const scale = monitor.scaleFactor || 1;
  const width = monitor.size.width / scale;
  const height = monitor.size.height / scale;
  return {
    x: Math.round(monitor.position.x / scale + selection.region.x * width),
    y: Math.round(monitor.position.y / scale + selection.region.y * height),
    width: Math.max(1, Math.round(selection.region.width * width)),
    height: Math.max(1, Math.round(selection.region.height * height)),
  };
}

/** Where the rectangle sits within its own screen, in pixels. A captured frame
 *  holds one screen at its real resolution, so a crop out of it knows nothing
 *  about where that screen sits or how it is scaled. */
export async function monitorCropFor(
  selection: SelectedRegion,
): Promise<DesktopRect | null> {
  const monitors = await availableMonitors();
  const monitor = monitors[selection.monitor];
  if (!monitor) return null;
  const { width, height } = monitor.size;
  return {
    x: Math.round(selection.region.x * width),
    y: Math.round(selection.region.y * height),
    width: Math.max(1, Math.round(selection.region.width * width)),
    height: Math.max(1, Math.round(selection.region.height * height)),
  };
}

/** Whether this machine can put the picker over the desktop and record what it
 *  returns. macOS and Windows always can; elsewhere it needs ffmpeg and an X11
 *  session. */
export async function regionRecordingSupported(): Promise<boolean> {
  if (!isTauriDesktop()) return false;
  return invoke<boolean>("region_recording_supported").catch(() => false);
}

export function screenRecordingAllowed(): Promise<boolean> {
  return invoke<boolean>("screen_recording_allowed").catch(() => false);
}

export function startRegionRecording(
  rect: DesktopRect,
  crop: DesktopRect,
  audio: boolean,
  monitor: number,
): Promise<string> {
  // Windows captures a screen and crops it, so it needs to know which one.
  return invoke<string>("start_region_recording", {
    rect,
    crop,
    audio,
    monitor,
  });
}

export function cancelRegionRecording(): Promise<void> {
  return invoke("cancel_region_recording");
}

export function decodeRecording(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Stops the recorder and hands back the finished recording as a file ready to
 *  send. The bytes come over once and the copy on disk goes with them. */
export async function finishRegionRecording(): Promise<File> {
  const path = await invoke<string>("stop_region_recording");
  const encoded = await invoke<string>("take_recording");
  const name = path.split(/[\\/]/).pop() ?? "screen-recording.mp4";
  // A recording is remuxed to MP4 where the system records something else, so
  // this is only QuickTime on a machine with nothing that could convert it.
  const type = name.endsWith(".mov") ? "video/quicktime" : "video/mp4";
  return new File([decodeRecording(encoded)], name, { type });
}
