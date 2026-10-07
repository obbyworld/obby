import { addPluginListener } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { isTauri, isTauriIOS, isTauriMobile } from "../lib/platformUtils";

interface IosKeyboardPayload {
  eventType: "will-show" | "did-show" | "will-hide" | "did-hide";
  keyboardHeight: number;
  animationDuration: number;
}

// Hook to handle keyboard visibility and viewport resizing on mobile platforms
export const useKeyboardResize = () => {
  useEffect(() => {
    const isMobile =
      /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      ) || window.innerWidth <= 768;

    if (!isMobile) {
      return;
    }

    // On Tauri desktop, bail out — keyboard handling is only needed on mobile.
    if (isTauri() && !isTauriMobile()) {
      return;
    }

    const root = document.getElementById("root");
    if (!root) return;

    let isKeyboardVisible = false;
    const resetRootStyle = () => {
      for (const prop of [
        "position",
        "top",
        "left",
        "right",
        "bottom",
        "height",
        "overflow",
      ] as const) {
        root.style[prop] = "";
      }
    };
    let baseHeight = window.visualViewport?.height ?? window.innerHeight;
    let baseWidth = window.visualViewport?.width ?? window.innerWidth;

    const setKeyboardVisible = (visible: boolean) => {
      isKeyboardVisible = visible;
      if (visible) {
        document.documentElement.dataset.keyboardVisible = "true";
        document.documentElement.dataset.keyboardOpen = "true";
      } else {
        delete document.documentElement.dataset.keyboardVisible;
        delete document.documentElement.dataset.keyboardOpen;
      }
    };

    // Eagerly set data-keyboard-visible on focus so CSS adjusts immediately.
    // These handlers only touch the CSS attribute — never isKeyboardVisible,
    // so the root.style.height logic is unaffected.
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        document.documentElement.dataset.keyboardVisible = "true";
      }
    };

    const handleFocusOut = (e: FocusEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      const isMovingToInput =
        related &&
        (related.tagName === "INPUT" ||
          related.tagName === "TEXTAREA" ||
          related.isContentEditable);
      // Only eagerly remove if the keyboard is confirmed gone.
      // Otherwise the keyboard handler will remove it when keyboard actually closes.
      if (!isMovingToInput && !isKeyboardVisible) {
        delete document.documentElement.dataset.keyboardVisible;
      }
    };

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);

    // iOS: visualViewport.resize never fires with viewport-fit=cover in WKWebView.
    // Use UIKeyboardWillShow/Hide notifications via tauri-plugin-ios-keyboard instead.
    if (isTauriIOS()) {
      let cleanupIos: (() => void) | undefined;

      // WebKit sometimes shrinks the web view for the keyboard and sometimes
      // only the visual viewport, so we pin the root to whatever is visible.
      const fitRootToVisibleArea = () => {
        const vv = window.visualViewport;
        if (!isKeyboardVisible || !vv) return;
        window.scrollTo(0, 0);
        root.style.top = `${vv.offsetTop}px`;
        root.style.height = `${vv.height}px`;
        root.style.bottom = "auto";
      };
      window.visualViewport?.addEventListener("resize", fitRootToVisibleArea);
      window.visualViewport?.addEventListener("scroll", fitRootToVisibleArea);

      (async () => {
        // The Swift side reports through Plugin.trigger, which only plugin
        // listeners receive, so we subscribe as one.
        const listener = await addPluginListener<IosKeyboardPayload>(
          "ios-keyboard",
          "plugin:keyboard::ios-keyboard-event",
          (payload) => {
            if (payload.eventType === "will-show") {
              root.style.position = "fixed";
              root.style.top = "0";
              root.style.left = "0";
              root.style.right = "0";
              root.style.bottom = `${payload.keyboardHeight}px`;
              // #root has a 100dvh height in CSS, which would beat the bottom inset.
              root.style.height = "auto";
              root.style.overflow = "hidden";
              document.documentElement.style.setProperty(
                "--keyboard-height",
                `${payload.keyboardHeight}px`,
              );
              // When keyboard is visible env(safe-area-inset-bottom) should be
              // 0 (the keyboard covers the home indicator area). WKWebView does
              // not always update the env() value, so force it here to remove
              // the bottom padding that would otherwise create a darker strip.
              document.documentElement.style.setProperty(
                "--safe-area-inset-bottom",
                "0px",
              );
              window.scrollTo(0, 0);
              setKeyboardVisible(true);
              window.dispatchEvent(new Event("resize"));
              requestAnimationFrame(fitRootToVisibleArea);
            } else if (payload.eventType === "did-show") {
              fitRootToVisibleArea();
              window.dispatchEvent(new Event("resize"));
            } else if (payload.eventType === "will-hide") {
              resetRootStyle();
              document.documentElement.style.removeProperty(
                "--keyboard-height",
              );
              document.documentElement.style.removeProperty(
                "--safe-area-inset-bottom",
              );
              window.scrollTo(0, 0);
              setKeyboardVisible(false);
              window.dispatchEvent(new Event("resize"));
            }
          },
        );
        cleanupIos = () => void listener.unregister();
      })();

      return () => {
        cleanupIos?.();
        window.visualViewport?.removeEventListener(
          "resize",
          fitRootToVisibleArea,
        );
        window.visualViewport?.removeEventListener(
          "scroll",
          fitRootToVisibleArea,
        );
        resetRootStyle();
        document.documentElement.style.removeProperty("--keyboard-height");
        document.documentElement.style.removeProperty(
          "--safe-area-inset-bottom",
        );
        document.removeEventListener("focusin", handleFocusIn);
        document.removeEventListener("focusout", handleFocusOut);
        delete document.documentElement.dataset.keyboardVisible;
        delete document.documentElement.dataset.keyboardOpen;
      };
    }

    // Android + web/browser: use visualViewport for height detection.
    // Android pans the visual viewport instead of resizing the layout viewport,
    // so position:fixed (anchored to the visual viewport) is used — same as iOS.
    const applyKeyboardOpen = () => {
      root.style.position = "fixed";
      root.style.top = "0";
      root.style.left = "0";
      root.style.right = "0";
      root.style.bottom = "0";
      root.style.overflow = "hidden";
    };

    const applyKeyboardClosed = () => {
      resetRootStyle();
      window.scrollTo(0, 0);
    };

    const handleVisualViewportChange = () => {
      if (!window.visualViewport) return;

      const currentHeight = window.visualViewport.height;
      // Android reports a zero height for one frame mid-rotation.
      if (currentHeight === 0) return;
      // A keyboard never changes the width, so a new width is a rotation and
      // we measure the keyboard against the new orientation from here on.
      if (Math.abs(window.visualViewport.width - baseWidth) > 1) {
        baseWidth = window.visualViewport.width;
        baseHeight = currentHeight;
      }
      const heightDifference = baseHeight - currentHeight;
      const wasVisible = isKeyboardVisible;
      const nowVisible = heightDifference > 150;

      if (nowVisible) {
        applyKeyboardOpen();
      } else if (wasVisible && !nowVisible) {
        applyKeyboardClosed();
      }

      if (wasVisible !== nowVisible) {
        setKeyboardVisible(nowVisible);
        window.dispatchEvent(new Event("resize"));
      }
    };

    const handleAndroidKeyboardShow = () => {
      if (!isKeyboardVisible) {
        setKeyboardVisible(true);
        applyKeyboardOpen();
        window.dispatchEvent(new Event("resize"));
      }
    };

    const handleAndroidKeyboardHide = () => {
      if (isKeyboardVisible) {
        setKeyboardVisible(false);
        applyKeyboardClosed();
        window.dispatchEvent(new Event("resize"));
      }
    };

    const handleWindowResize = () => {
      // Update base height when window resizes (e.g. browser chrome hides)
      // but only when keyboard is not visible
      if (!isKeyboardVisible) {
        baseHeight = window.visualViewport?.height ?? window.innerHeight;
      }
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener(
        "resize",
        handleVisualViewportChange,
      );
      window.visualViewport.addEventListener(
        "scroll",
        handleVisualViewportChange,
      );
    }

    window.addEventListener("keyboardDidShow", handleAndroidKeyboardShow);
    window.addEventListener("keyboardDidHide", handleAndroidKeyboardHide);
    window.addEventListener("resize", handleWindowResize);

    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener(
          "resize",
          handleVisualViewportChange,
        );
        window.visualViewport.removeEventListener(
          "scroll",
          handleVisualViewportChange,
        );
      }
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      window.removeEventListener("keyboardDidShow", handleAndroidKeyboardShow);
      window.removeEventListener("keyboardDidHide", handleAndroidKeyboardHide);
      window.removeEventListener("resize", handleWindowResize);

      applyKeyboardClosed();
      delete document.documentElement.dataset.keyboardVisible;
      delete document.documentElement.dataset.keyboardOpen;
    };
  }, []);
};
