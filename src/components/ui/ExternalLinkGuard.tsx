import type React from "react";
import { useEffect, useState } from "react";
import { openExternalUrl } from "../../lib/openUrl";
import ExternalLinkWarningModal from "./ExternalLinkWarningModal";
import { EXTERNAL_LINK } from "./LinkHoverLayer";

const WRAPPED = "[data-link-wrapper]";

// Chat text renders links in many places. EnhancedLinkWrapper handles the ones
// inside it, and we catch every other one here, so no link leaves the app
// without the warning.
export const ExternalLinkGuard: React.FC = () => {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.(EXTERNAL_LINK);
      if (!link || link.closest(WRAPPED)) return;
      event.preventDefault();
      event.stopPropagation();
      const url = link.getAttribute("href");
      if (url) setPendingUrl(url);
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, []);

  return (
    <ExternalLinkWarningModal
      isOpen={pendingUrl !== null}
      url={pendingUrl ?? ""}
      onConfirm={() => {
        if (pendingUrl) void openExternalUrl(pendingUrl);
        setPendingUrl(null);
      }}
      onCancel={() => setPendingUrl(null)}
    />
  );
};

export default ExternalLinkGuard;
