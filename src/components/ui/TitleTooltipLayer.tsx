import type React from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import {
  TOOLTIP_SHOW_DELAY_MS,
  type TooltipAnchor,
  TooltipPanel,
  tooltipAnchorOf,
} from "./HoverTooltip";

const TITLED_SELECTOR = "[title]";
// An iframe title names the frame for screen readers, so we leave it to them.
const NON_HINT_SELECTOR = "iframe, svg *";

interface HeldTitle {
  el: Element;
  title: string;
  hasAddedLabel: boolean;
}

function hasAccessibleName(el: Element): boolean {
  return (
    el.hasAttribute("aria-label") ||
    el.hasAttribute("aria-labelledby") ||
    el.hasAttribute("alt") ||
    el instanceof HTMLImageElement ||
    ((el as HTMLInputElement).labels?.length ?? 0) > 0 ||
    !!el.textContent?.trim()
  );
}

// We hold the title only while its hint is up so the browser never shows its
// own, and we put it back on hide so React keeps owning the attribute.
function holdTitle(el: Element): HeldTitle | null {
  const title = el.getAttribute("title");
  if (!title) return null;
  const hasAddedLabel = !hasAccessibleName(el);
  el.removeAttribute("title");
  if (hasAddedLabel) el.setAttribute("aria-label", title);
  return { el, title, hasAddedLabel };
}

function releaseTitle({ el, title, hasAddedLabel }: HeldTitle) {
  if (!el.hasAttribute("title")) el.setAttribute("title", title);
  if (hasAddedLabel) el.removeAttribute("aria-label");
}

export const TitleTooltipLayer: React.FC = () => {
  const isTouch = useIsTouchInput();
  const [tip, setTip] = useState<{
    text: string;
    anchor: TooltipAnchor;
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heldRef = useRef<HeldTitle | null>(null);

  useEffect(() => {
    if (isTouch) return;
    const hideTooltip = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (heldRef.current) releaseTitle(heldRef.current);
      heldRef.current = null;
      setTip(null);
    };
    const showTitleOnPointerOver = (e: PointerEvent) => {
      if (e.pointerType === "touch" || !(e.target instanceof Element)) return;
      const held = heldRef.current;
      if (held?.el.contains(e.target)) return;
      hideTooltip();
      const el = e.target.closest(TITLED_SELECTOR);
      if (!el || el.matches(NON_HINT_SELECTOR)) return;
      const next = holdTitle(el);
      if (!next) return;
      heldRef.current = next;
      timerRef.current = setTimeout(() => {
        if (!el.isConnected) return;
        setTip({
          text: next.title,
          anchor: tooltipAnchorOf(el.getBoundingClientRect()),
        });
      }, TOOLTIP_SHOW_DELAY_MS);
    };
    const hideOnPointerOut = (e: PointerEvent) => {
      const held = heldRef.current;
      if (held && !held.el.contains(e.relatedTarget as Node)) hideTooltip();
    };
    const hideOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") hideTooltip();
    };
    document.addEventListener("pointerover", showTitleOnPointerOver);
    document.addEventListener("pointerout", hideOnPointerOut);
    document.addEventListener("pointerdown", hideTooltip, true);
    document.addEventListener("scroll", hideTooltip, true);
    document.addEventListener("keydown", hideOnEscape, true);
    return () => {
      document.removeEventListener("pointerover", showTitleOnPointerOver);
      document.removeEventListener("pointerout", hideOnPointerOut);
      document.removeEventListener("pointerdown", hideTooltip, true);
      document.removeEventListener("scroll", hideTooltip, true);
      document.removeEventListener("keydown", hideOnEscape, true);
      hideTooltip();
    };
  }, [isTouch]);

  return tip
    ? createPortal(
        <TooltipPanel anchor={tip.anchor} id="title-tooltip">
          {tip.text}
        </TooltipPanel>,
        document.body,
      )
    : null;
};

export default TitleTooltipLayer;
