import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { FaLink } from "react-icons/fa";
import { extractHostname } from "../../lib/mediaUtils";
import CopyButton from "./CopyButton";
import Popover from "./Popover";

interface LinkHoverCardProps {
  url: string;
  anchor: HTMLElement;
  onClose: () => void;
}

export const LINK_HOVER_CARD = "[data-link-hover-card]";

// We build the card from data already on screen, so hovering stays offline.
export const LinkHoverCard: React.FC<LinkHoverCardProps> = ({
  url,
  anchor,
  onClose,
}) => {
  const { t } = useLingui();
  return (
    <Popover isOpen onClose={onClose} anchor={anchor}>
      <div data-link-hover-card="" className="surface-list flex flex-col gap-1">
        <div className="flex items-center gap-2 pl-2">
          <FaLink className="text-xs text-discord-text-muted shrink-0" />
          <span className="flex-1 min-w-0 truncate text-sm font-medium text-white">
            {extractHostname(url) ?? url}
          </span>
          <CopyButton getText={() => url} label={t`Copy link`} />
        </div>
        <span className="px-2 pb-1 row-meta break-all line-clamp-3 select-text">
          {url}
        </span>
      </div>
    </Popover>
  );
};

export default LinkHoverCard;
