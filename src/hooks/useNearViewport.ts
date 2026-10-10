import { type RefObject, useEffect, useState } from "react";

// Starts work 200px before the element scrolls into view, so a preview is ready
// by the time the user reaches it.
const ROOT_MARGIN = "200px";

/** True once the element has come within `ROOT_MARGIN` of the viewport. Never
 * goes back to false: work that has already started is not worth undoing, and
 * flipping it would unmount media the user just scrolled past. */
export function useNearViewport(ref: RefObject<Element | null>): boolean {
  const [near, setNear] = useState(false);

  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        observer.disconnect();
        setNear(true);
      },
      { rootMargin: ROOT_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, near]);

  return near;
}
