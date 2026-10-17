import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { availableMonitors } from "@tauri-apps/api/window";
import { isTauriDesktop } from "./platformUtils";

export const REGION_SELECTED_EVENT = "obby://region-selected";
export const REGION_CANCELLED_EVENT = "obby://region-cancelled";

const OVERLAY_PREFIX = "region-overlay-";
const MARKER_LABEL = "region-marker";
const CONTROLS_LABEL = "region-controls";
/** The frame is drawn in a ring outside the recorded rectangle, so the
 *  recording does not contain the frame around itself. */
const MARKER_BORDER = 3;
const CONTROLS_WIDTH = 260;
const CONTROLS_HEIGHT = 56;
const CONTROLS_GAP = 10;
/** The dim sits lowest; what a person needs to press sits over it. */
const PICKER_LEVEL = 0;
const MARKER_LEVEL = 1;
const CONTROLS_LEVEL = 2;
export const OVERLAY_TITLE = "Obby Screen Region";
export const MARKER_TITLE = "Obby Recording Area";
export const CONTROLS_TITLE = "Obby Recording Controls";
export const RECORDING_STOP_EVENT = "obby://recording-stop";
export const RECORDING_CANCEL_EVENT = "obby://recording-cancel";

/** A rectangle as fractions of one screen, which is what the picker can state
 *  without knowing anything about screen scaling. */
export interface FractionalRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Below this a drag is a stray click rather than an area worth recording. */
export const MIN_REGION_FRACTION = 0.01;

export interface SelectedRegion {
  /** Index into availableMonitors(), so the marker can be put back on the
   *  same screen the rectangle was drawn on. */
  monitor: number;
  region: FractionalRegion;
}

/** Picking a rectangle on the desktop needs windows of our own placed over
 *  every screen, which only the desktop app can do. Whether a given desktop
 *  allows it is answered by regionRecordingSupported(). */
export function regionSelectionSupported(): boolean {
  return isTauriDesktop();
}

/** Hands the window to the native side, which keeps a tiling window manager
 *  from taking it into the layout and puts it above everything. */
async function takeOverWindow(label: string, level: number) {
  await invoke("prepare_region_overlay", { label, level }).catch(() => {});
}

async function closeWindows(match: (label: string) => boolean): Promise<void> {
  const windows = await WebviewWindow.getAll();
  await Promise.all(
    windows.filter((w) => match(w.label)).map((w) => w.close().catch(() => {})),
  );
}

/** Resolves with the rectangle the person drags over the desktop, or null when
 *  they cancel. */
export async function selectScreenRegion(): Promise<SelectedRegion | null> {
  const monitors = await availableMonitors();
  if (monitors.length === 0) return null;

  const settled = new Promise<SelectedRegion | null>((resolve) => {
    let done = false;
    const finish = (value: SelectedRegion | null) => {
      if (done) return;
      done = true;
      void unlistenSelected.then((fn) => fn());
      void unlistenCancelled.then((fn) => fn());
      // Awaited, so the dimming is off the screen before a recording starts
      // and before anything is placed where the picker used to be.
      void closeWindows((label) => label.startsWith(OVERLAY_PREFIX)).then(() =>
        resolve(value),
      );
    };
    const unlistenSelected = listen<SelectedRegion>(
      REGION_SELECTED_EVENT,
      (event) => finish(event.payload),
    );
    const unlistenCancelled = listen(REGION_CANCELLED_EVENT, () =>
      finish(null),
    );
  });

  await Promise.all(
    monitors.map(async (monitor, index) => {
      const scale = monitor.scaleFactor || 1;
      const overlay = new WebviewWindow(`${OVERLAY_PREFIX}${index}`, {
        url: `index.html?overlay=region&monitor=${index}`,
        // A tiling window manager that insists on managing this can be pointed
        // at it by title.
        title: OVERLAY_TITLE,
        // Sizing to the monitor beats fullscreen: on macOS a fullscreen window
        // moves to a Space of its own instead of covering what is there.
        x: monitor.position.x / scale,
        y: monitor.position.y / scale,
        width: monitor.size.width / scale,
        height: monitor.size.height / scale,
        transparent: true,
        decorations: false,
        alwaysOnTop: true,
        shadow: false,
        skipTaskbar: true,
        resizable: false,
        focus: index === 0,
      });
      await new Promise<void>((resolve) => {
        void overlay.once("tauri://created", () => resolve());
        void overlay.once("tauri://error", () => resolve());
      });
      await takeOverWindow(overlay.label, PICKER_LEVEL);
    }),
  );

  return settled;
}

interface PlacedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  monitorX: number;
  monitorY: number;
  monitorWidth: number;
  monitorHeight: number;
}

async function placeRegion(
  selection: SelectedRegion,
): Promise<PlacedRegion | null> {
  const monitors = await availableMonitors();
  const monitor = monitors[selection.monitor];
  if (!monitor) return null;
  const scale = monitor.scaleFactor || 1;
  const monitorWidth = monitor.size.width / scale;
  const monitorHeight = monitor.size.height / scale;
  const monitorX = monitor.position.x / scale;
  const monitorY = monitor.position.y / scale;
  return {
    x: monitorX + selection.region.x * monitorWidth,
    y: monitorY + selection.region.y * monitorHeight,
    width: selection.region.width * monitorWidth,
    height: selection.region.height * monitorHeight,
    monitorX,
    monitorY,
    monitorWidth,
    monitorHeight,
  };
}

/** Shows the person what is going out. The window is grown by the width of the
 *  frame and the frame drawn in that margin, so the recording stays free of it,
 *  and it ignores the cursor so it never gets in the way. */
export async function showRegionMarker(
  selection: SelectedRegion,
): Promise<void> {
  await hideRegionMarker();
  const placed = await placeRegion(selection);
  if (!placed) return;

  const marker = new WebviewWindow(MARKER_LABEL, {
    url: "index.html?overlay=marker",
    title: MARKER_TITLE,
    x: placed.x - MARKER_BORDER,
    y: placed.y - MARKER_BORDER,
    width: placed.width + MARKER_BORDER * 2,
    height: placed.height + MARKER_BORDER * 2,
    transparent: true,
    decorations: false,
    alwaysOnTop: true,
    shadow: false,
    skipTaskbar: true,
    resizable: false,
    focus: false,
  });
  await new Promise<void>((resolve) => {
    void marker.once("tauri://created", () => resolve());
    void marker.once("tauri://error", () => resolve());
  });
  await takeOverWindow(MARKER_LABEL, MARKER_LEVEL);
  // Only safe once the window exists: asking earlier crashes the webview on
  // some Linux builds.
  await marker.setIgnoreCursorEvents(true).catch(() => {});
}

export async function hideRegionMarker(): Promise<void> {
  await closeWindows((label) => label === MARKER_LABEL);
}

/** Offers the clock and the way to stop. It sits outside the rectangle so it
 *  stays out of the recording, and it is its own window so stopping never means
 *  finding the app again. */
export async function showRecordingControls(
  selection: SelectedRegion,
): Promise<void> {
  await hideRecordingControls();
  const placed = await placeRegion(selection);
  if (!placed) return;

  const below = placed.y + placed.height + MARKER_BORDER + CONTROLS_GAP;
  const fitsBelow =
    below + CONTROLS_HEIGHT <= placed.monitorY + placed.monitorHeight;
  const y = fitsBelow
    ? below
    : placed.y - MARKER_BORDER - CONTROLS_GAP - CONTROLS_HEIGHT;
  const centred = placed.x + placed.width / 2 - CONTROLS_WIDTH / 2;
  const x = Math.min(
    Math.max(centred, placed.monitorX),
    placed.monitorX + placed.monitorWidth - CONTROLS_WIDTH,
  );

  const controls = new WebviewWindow(CONTROLS_LABEL, {
    url: "index.html?overlay=recording",
    title: CONTROLS_TITLE,
    x,
    y: Math.max(y, placed.monitorY),
    width: CONTROLS_WIDTH,
    height: CONTROLS_HEIGHT,
    transparent: true,
    decorations: false,
    alwaysOnTop: true,
    shadow: false,
    skipTaskbar: true,
    resizable: false,
    // Focused so that escape and enter reach it without a global key grab,
    // which would otherwise swallow those keys from whatever is being recorded.
    focus: true,
  });
  await new Promise<void>((resolve) => {
    void controls.once("tauri://created", () => resolve());
    void controls.once("tauri://error", () => resolve());
  });
  await takeOverWindow(CONTROLS_LABEL, CONTROLS_LEVEL);
}

export async function hideRecordingControls(): Promise<void> {
  await closeWindows((label) => label === CONTROLS_LABEL);
}

export function requestRecordingStop(): Promise<void> {
  return emit(RECORDING_STOP_EVENT, {});
}

export function requestRecordingCancel(): Promise<void> {
  return emit(RECORDING_CANCEL_EVENT, {});
}

/** Clears any picker or marker window left over from a previous run. Without
 *  this a crash mid-selection leaves the desktop covered by a window the
 *  person has no way to dismiss. */
export async function closeStaleRegionWindows(): Promise<void> {
  if (!regionSelectionSupported()) return;
  await closeWindows(
    (label) =>
      label.startsWith(OVERLAY_PREFIX) ||
      label === MARKER_LABEL ||
      label === CONTROLS_LABEL,
  ).catch(() => {});
}

export function publishRegionSelection(
  selection: SelectedRegion,
): Promise<void> {
  return emit(REGION_SELECTED_EVENT, selection);
}

export function cancelRegionSelection(): Promise<void> {
  return emit(REGION_CANCELLED_EVENT, {});
}

/** Puts the app back in front once the overlay has gone, so the person lands
 *  back where they started rather than on whatever the picker covered. */
export async function focusMainWindow(): Promise<void> {
  if (!regionSelectionSupported()) return;
  const windows = await WebviewWindow.getAll().catch(() => []);
  const main = windows.find((w) => w.label === "main");
  await main?.setFocus().catch(() => {});
}
