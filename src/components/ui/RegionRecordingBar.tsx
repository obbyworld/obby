import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import {
  cancelRegionRecording,
  desktopRectFor,
  finishRegionRecording,
  monitorCropFor,
  startRegionRecording,
} from "../../lib/screenRecorder";
import {
  hideRecordingControls,
  hideRegionMarker,
  RECORDING_CANCEL_EVENT,
  RECORDING_STOP_EVENT,
  type SelectedRegion,
  showRecordingControls,
  showRegionMarker,
} from "../../lib/screenRegion";

/** Why a recording ended with nothing. The caller turns these into the words a
 *  person reads, so no English reaches the screen from here. */
export type RecordingFailure = "screen-gone" | "recorder-failed";

/** Drives a recording of the chosen rectangle. There is nothing to show in the
 *  app itself: the clock and the buttons live in their own small window beside
 *  the area, so stopping never means hunting for this window behind whatever
 *  is being recorded. */
export function RegionRecordingBar({
  selection,
  onRecorded,
  onError,
  onFinished,
}: {
  selection: SelectedRegion | null;
  onRecorded: (file: File) => void;
  onError: (failure: RecordingFailure) => void;
  onFinished: () => void;
}) {
  const busyRef = useRef(false);
  const onRecordedRef = useRef(onRecorded);
  onRecordedRef.current = onRecorded;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  useEffect(() => {
    if (!selection) return;
    let cancelled = false;
    busyRef.current = false;

    const teardown = async () => {
      await hideRegionMarker();
      await hideRecordingControls();
    };

    const stop = async (keep: boolean) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        if (keep) {
          const file = await finishRegionRecording();
          await teardown();
          onRecordedRef.current(file);
        } else {
          await cancelRegionRecording();
          await teardown();
        }
      } catch (err) {
        console.error("region recording failed", err);
        await teardown();
        onErrorRef.current("recorder-failed");
      }
      onFinishedRef.current();
    };

    const listeners = Promise.all([
      listen(RECORDING_STOP_EVENT, () => void stop(true)),
      listen(RECORDING_CANCEL_EVENT, () => void stop(false)),
    ]);

    (async () => {
      // Listening has to be in place before anything can be pressed, or an
      // eager stop lands before this window is ready to hear it.
      await listeners;
      const rect = await desktopRectFor(selection);
      const crop = await monitorCropFor(selection);
      if (!rect || !crop) {
        onErrorRef.current("screen-gone");
        onFinishedRef.current();
        return;
      }
      try {
        await startRegionRecording(rect, crop, false, selection.monitor);
      } catch (err) {
        if (!cancelled) {
          console.error("region recording failed to start", err);
          onErrorRef.current("recorder-failed");
          onFinishedRef.current();
        }
        return;
      }
      if (cancelled) {
        await cancelRegionRecording().catch(() => {});
        return;
      }
      await showRegionMarker(selection);
      await showRecordingControls(selection);
    })();

    return () => {
      cancelled = true;
      void listeners.then((fns) => {
        for (const off of fns) off();
      });
      // Nothing is left on screen to stop a recording once this goes, so it
      // ends with it rather than running on with the overlays over everything.
      if (!busyRef.current) {
        busyRef.current = true;
        void cancelRegionRecording().catch(() => {});
        void teardown();
      }
    };
  }, [selection]);

  return null;
}

export default RegionRecordingBar;
