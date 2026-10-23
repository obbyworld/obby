import type * as React from "react";
import {
  forwardRef,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
  useCallback,
} from "react";

const handleMobileDone = (e: KeyboardEvent<HTMLInputElement>) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const input = e.target as HTMLInputElement;
    input.blur();
    input.form?.requestSubmit();
  }
};

/**
 * Find the nearest scrollable ancestor (overflow-y: auto/scroll).
 * iOS WKWebView's native scrollIntoView scrolls the wrong layer (body instead
 * of the overflow container), so we need to find the real scroll parent and
 * call scrollTo on it directly.
 */
const findScrollParent = (el: HTMLElement): HTMLElement | null => {
  let current = el.parentElement;
  while (current) {
    const style = getComputedStyle(current);
    if (style.overflowY === "auto" || style.overflowY === "scroll") {
      return current;
    }
    current = current.parentElement;
  }
  return null;
};

/**
 * Scroll the focused input into the visible area within its scroll container.
 * Adds temporary bottom padding so fields at the very bottom can be scrolled
 * above the keyboard (Ionic's "scroll assist" approach).
 */
const scrollInputIntoView = (e: React.FocusEvent<HTMLInputElement>) => {
  const input = e.target;

  setTimeout(() => {
    if (!input.isConnected) return;
    const scrollParent = findScrollParent(input);
    if (!scrollParent) {
      input.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    // Estimate keyboard height from visualViewport
    const keyboardHeight = window.visualViewport
      ? window.innerHeight - window.visualViewport.height
      : 0;

    // Add bottom padding so the last fields can scroll above the keyboard
    if (keyboardHeight > 100) {
      scrollParent.style.paddingBottom = `${keyboardHeight}px`;

      const removePadding = () => {
        scrollParent.style.paddingBottom = "";
        window.visualViewport?.removeEventListener("resize", onViewportResize);
      };

      const onViewportResize = () => {
        const currentKbHeight = window.visualViewport
          ? window.innerHeight - window.visualViewport.height
          : 0;
        if (currentKbHeight < 100) {
          removePadding();
        }
      };

      // Clean up padding when keyboard closes
      window.visualViewport?.addEventListener("resize", onViewportResize);
      // Safety: also clean up on blur
      input.addEventListener("blur", removePadding, { once: true });
    }

    // Calculate where the input is relative to the scroll container
    const inputRect = input.getBoundingClientRect();
    const parentRect = scrollParent.getBoundingClientRect();
    const inputRelativeTop =
      inputRect.top - parentRect.top + scrollParent.scrollTop;

    // Scroll so the input is roughly centered in the visible part of the container
    const visibleHeight = window.visualViewport?.height
      ? window.visualViewport.height - parentRect.top
      : parentRect.height;
    const targetScroll = inputRelativeTop - visibleHeight / 3;

    scrollParent.scrollTo({
      top: Math.max(0, targetScroll),
      behavior: "smooth",
    });
  }, 350);
};

/**
 * Drop-in replacement for <input> with
 * autocomplete/autocorrect disabled by default.
 * On mobile: shows "Done" on keyboard, Enter dismisses keyboard,
 * and focused input scrolls into view (avoids keyboard occlusion).
 */
export const TextInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ onKeyDown, onFocus, ...props }, ref) => {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      onKeyDown?.(e);
      if (!e.defaultPrevented) handleMobileDone(e);
    },
    [onKeyDown],
  );

  const handleFocus = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      scrollInputIntoView(e);
      onFocus?.(e);
    },
    [onFocus],
  );

  return (
    <input
      type="text"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      enterKeyHint="done"
      data-form-type="other"
      data-lpignore="true"
      ref={ref}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      {...props}
    />
  );
});
TextInput.displayName = "TextInput";

/**
 * Drop-in replacement for <textarea> with
 * autocomplete/autocorrect disabled by default.
 */
export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>((props, ref) => (
  <textarea
    autoComplete="off"
    autoCorrect="off"
    autoCapitalize="off"
    spellCheck={false}
    data-form-type="other"
    data-lpignore="true"
    ref={ref}
    {...props}
  />
));
TextArea.displayName = "TextArea";
