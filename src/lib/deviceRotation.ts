import { useEffect, useRef } from "react";

export type QuarterTurn = 0 | 90 | 180 | 270;

// A phone lying almost flat tilts too little to tell which edge is up.
const MIN_TILT_DEGREES = 25;

/** How far the phone is turned from upright portrait, counted the way
 *  `screen.orientation.angle` counts it (90 = turned counterclockwise), read
 *  from the tilt sensor so it holds even with the screen rotation locked. */
export function physicalAngle(beta: number, gamma: number): QuarterTurn | null {
  if (Math.max(Math.abs(beta), Math.abs(gamma)) < MIN_TILT_DEGREES) return null;
  if (Math.abs(beta) >= Math.abs(gamma)) return beta > 0 ? 0 : 180;
  return gamma > 0 ? 90 : 270;
}

function screenAngle(): QuarterTurn {
  const angle =
    screen.orientation?.angle ??
    (window as { orientation?: number }).orientation ??
    0;
  return (((angle % 360) + 360) % 360) as QuarterTurn;
}

/** Degrees to turn a captured frame clockwise so the photo comes out upright.
 *  The browser already turns frames with the screen, so only the part of the
 *  phone's turn the screen did not follow is left. The front camera's frames
 *  are mirrored against the screen, so its turn goes the other way. */
export function photoRotation(
  physical: QuarterTurn,
  screenTurn: QuarterTurn,
  isFrontCamera: boolean,
): QuarterTurn {
  const unfollowed = (physical - screenTurn + 360) % 360;
  return (isFrontCamera ? unfollowed : (360 - unfollowed) % 360) as QuarterTurn;
}

type MotionPermissionEvent = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

/** iOS asks before sharing the tilt sensor, and only from inside a tap. */
export function requestTiltAccess(): void {
  const event = globalThis.DeviceOrientationEvent as
    | MotionPermissionEvent
    | undefined;
  void event?.requestPermission?.().catch(() => undefined);
}

/** The latest confident physical angle while `isActive`, kept in a ref so
 *  sensor updates do not re-render the camera. */
export function usePhysicalAngle(isActive: boolean) {
  const angleRef = useRef<QuarterTurn>(0);
  useEffect(() => {
    if (!isActive) return;
    const onTilt = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null) return;
      const angle = physicalAngle(event.beta, event.gamma);
      if (angle !== null) angleRef.current = angle;
    };
    window.addEventListener("deviceorientation", onTilt);
    return () => window.removeEventListener("deviceorientation", onTilt);
  }, [isActive]);
  return {
    rotationFor: (isFrontCamera: boolean): QuarterTurn =>
      photoRotation(angleRef.current, screenAngle(), isFrontCamera),
  };
}
