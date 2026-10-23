import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DeviceKind,
  describeMediaError,
  listDevices,
} from "../../../lib/mediaDevices";

const PROBE_CONSTRAINTS: Record<DeviceKind, MediaStreamConstraints> = {
  audioinput: { audio: true },
  videoinput: { video: true },
  // Output device labels unlock alongside any other granted permission, so a
  // microphone probe is the least invasive way to reveal them.
  audiooutput: { audio: true },
};

/** Enumerates devices of one kind and exposes the "allow access" flow that
 *  reveals their labels, shared by the microphone, camera, and speaker
 *  settings fields. */
export function useDeviceAccess(kind: DeviceKind) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [requested, setRequested] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const enumeratedRef = useRef(false);
  useEffect(() => {
    if (enumeratedRef.current) return;
    enumeratedRef.current = true;
    void listDevices(kind).then((found) => {
      if (mountedRef.current) setDevices(found);
    });
  }, [kind]);

  const requestAccess = useCallback(async (): Promise<MediaDeviceInfo[]> => {
    setRequesting(true);
    setPermissionError(null);
    let denied = false;
    try {
      const probe = await navigator.mediaDevices.getUserMedia(
        PROBE_CONSTRAINTS[kind],
      );
      for (const track of probe.getTracks()) track.stop();
    } catch (err) {
      if (
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "SecurityError")
      ) {
        denied = true;
      }
    }
    const found = await listDevices(kind);
    if (!mountedRef.current) return found;
    setDevices(found);
    setRequested(true);
    setRequesting(false);
    if (denied) {
      setPermissionError(
        describeMediaError(new DOMException("", "NotAllowedError")),
      );
    }
    return found;
  }, [kind]);

  // WebKit hands back an empty list until access is granted, rather than
  // devices with blank labels the way Chromium does, so an empty list before
  // the user has been asked means we still have to ask.
  const needsPermission =
    !requested &&
    (devices.length === 0 || !devices.some((d) => d.label !== ""));

  return {
    devices,
    needsPermission,
    requesting,
    permissionError,
    requestAccess,
  };
}
