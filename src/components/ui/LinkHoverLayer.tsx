import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useIsTouchInput } from "../../hooks/useIsTouchInput";
import LinkHoverCard, { LINK_HOVER_CARD } from "./LinkHoverCard";

const HOVER_OPEN_MS = 350;
const HOVER_CLOSE_MS = 200;
export const EXTERNAL_LINK = "a.external-link-security";

// One card for the whole app: we watch the document for a mouse resting on an
// external link, so every message, markdown block and panel shares it. Touch
// devices skip it, because Popover would render it as a sheet over the link.
export const LinkHoverLayer: React.FC = () => {
  const isTouch = useIsTouchInput();
  const [hovered, setHovered] = useState<{
    anchor: HTMLAnchorElement;
    url: string;
  } | null>(null);
  const isOpenRef = useRef(false);
  isOpenRef.current = hovered !== null;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const scheduleClose = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => setHovered(null), HOVER_CLOSE_MS);
  }, [clearTimer]);

  useEffect(() => {
    if (isTouch) return;
    const linkFrom = (target: EventTarget | null) =>
      target instanceof Element
        ? target.closest<HTMLAnchorElement>(EXTERNAL_LINK)
        : null;
    // The whole popover panel around the card counts, icons included.
    const cardFrom = (target: EventTarget | null) => {
      const panel =
        target instanceof Element
          ? target.closest("[data-popover-panel]")
          : null;
      return panel?.querySelector(LINK_HOVER_CARD) ? panel : null;
    };

    const handlePointerOver = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      if (cardFrom(e.target)) {
        clearTimer();
        return;
      }
      const anchor = linkFrom(e.target);
      const url = anchor?.getAttribute("href");
      if (!anchor || !url) {
        // A re-render can replace the hovered link without a pointerout, so
        // any pointer landing elsewhere closes the card.
        if (isOpenRef.current) scheduleClose();
        return;
      }
      clearTimer();
      timerRef.current = setTimeout(
        () => setHovered({ anchor, url }),
        HOVER_OPEN_MS,
      );
    };
    const handlePointerOut = (e: PointerEvent) => {
      const left = linkFrom(e.target) ?? cardFrom(e.target);
      if (!left || left.contains(e.relatedTarget as Node)) return;
      scheduleClose();
    };
    // A click opens the warning dialog, so the card gets out of its way.
    const handleClick = (e: MouseEvent) => {
      if (linkFrom(e.target)) {
        clearTimer();
        setHovered(null);
      }
    };

    const closeOnScroll = () => {
      if (!isOpenRef.current) return;
      clearTimer();
      setHovered(null);
    };

    document.addEventListener("pointerover", handlePointerOver);
    document.addEventListener("pointerout", handlePointerOut);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("pointerover", handlePointerOver);
      document.removeEventListener("pointerout", handlePointerOut);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("scroll", closeOnScroll, true);
      clearTimer();
    };
  }, [isTouch, clearTimer, scheduleClose]);

  return hovered?.anchor.isConnected ? (
    <LinkHoverCard
      url={hovered.url}
      anchor={hovered.anchor}
      onClose={() => setHovered(null)}
    />
  ) : null;
};

export default LinkHoverLayer;
