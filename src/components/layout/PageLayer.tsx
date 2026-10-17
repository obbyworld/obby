import type React from "react";
import { useEffect, useRef } from "react";
import useStore from "../../store";
import type { AppPage } from "../../store/types";
import PageHost, { parentPageOf } from "../pages/PageHost";
import { PagePreviewContext } from "../ui/page/PageShell";
import SwipeBackScreen from "./SwipeBackScreen";

// On a phone a page sits above the swipeable columns like a pushed screen.
// Swiping it away uncovers its parent page, or the column that opened it.
export const PageLayer: React.FC<{ page: AppPage }> = ({ page }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const parent = parentPageOf(page);

  // PageShell keeps focus off pages on touch, so we land screen readers on
  // the heading here; a heading takes focus without raising the keyboard.
  useEffect(() => {
    rootRef.current
      ?.querySelector<HTMLElement>("h1")
      ?.focus({ preventScroll: true });
  }, []);

  const leavePage = () => {
    (document.activeElement as HTMLElement | null)?.blur();
    const { openPage, closePage } = useStore.getState();
    if (parent) openPage(parent);
    else closePage();
  };

  return (
    <div ref={rootRef} className="absolute inset-0 z-20">
      <SwipeBackScreen
        onBack={leavePage}
        under={
          parent && (
            <PagePreviewContext.Provider value>
              <PageHost page={parent} />
            </PagePreviewContext.Provider>
          )
        }
      >
        <PageHost page={page} />
      </SwipeBackScreen>
    </div>
  );
};

export default PageLayer;
