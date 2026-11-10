import { describe, expect, test } from "vitest";
import { photoRotation, physicalAngle } from "../../src/lib/deviceRotation";

describe("physicalAngle", () => {
  test("reads upright and upside-down portrait from the front-back tilt", () => {
    expect(physicalAngle(80, 5)).toBe(0);
    expect(physicalAngle(-80, 5)).toBe(180);
  });

  test("reads landscape from the side tilt", () => {
    expect(physicalAngle(5, 85)).toBe(90);
    expect(physicalAngle(5, -85)).toBe(270);
  });

  test("gives no answer for a phone lying flat", () => {
    expect(physicalAngle(4, -6)).toBeNull();
  });
});

describe("photoRotation", () => {
  test("leaves the photo alone when the screen followed the phone", () => {
    expect(photoRotation(90, 90, false)).toBe(0);
    expect(photoRotation(270, 270, true)).toBe(0);
  });

  test("turns a back camera photo against a turn the locked screen missed", () => {
    expect(photoRotation(90, 0, false)).toBe(270);
    expect(photoRotation(270, 0, false)).toBe(90);
    expect(photoRotation(180, 0, false)).toBe(180);
  });

  test("turns a front camera photo the other way, since its frames are mirrored", () => {
    expect(photoRotation(90, 0, true)).toBe(90);
    expect(photoRotation(270, 0, true)).toBe(270);
  });
});
