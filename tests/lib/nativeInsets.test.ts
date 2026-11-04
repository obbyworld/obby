import { afterEach, describe, expect, it } from "vitest";
import { followNativeInsets } from "../../src/lib/nativeInsets";

const inset = (side: string) =>
  document.documentElement.style.getPropertyValue(`--safe-area-inset-${side}`);

describe("followNativeInsets", () => {
  afterEach(() => {
    window.ObbyNative = undefined;
    document.documentElement.removeAttribute("style");
  });

  it("takes the insets the Android shell measured and follows changes", () => {
    const bridge = {
      setInCall: () => {},
      insets(this: unknown) {
        if (this !== bridge)
          throw new Error(
            "Java bridge method can't be invoked on a non-injected object",
          );
        return '{"top":24,"right":0,"bottom":48,"left":0}';
      },
    };
    window.ObbyNative = bridge;
    followNativeInsets();
    expect(inset("top")).toBe("24px");
    expect(inset("bottom")).toBe("48px");

    window.dispatchEvent(
      new CustomEvent("obby-native-insets", {
        detail: { top: 24, right: 0, bottom: 0, left: 0 },
      }),
    );
    expect(inset("bottom")).toBe("0px");
  });

  it("leaves env() in charge without the Android shell", () => {
    followNativeInsets();
    expect(inset("bottom")).toBe("");
  });
});
