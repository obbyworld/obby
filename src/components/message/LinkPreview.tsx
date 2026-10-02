import { useLingui } from "@lingui/react/macro";
import type React from "react";
import { useState } from "react";
import {
  decodeHtmlEntities,
  isUrlFromTrustedSource,
  serverFilehosts,
} from "../../lib/ircUtils";
import { mediaLevelToSettings } from "../../lib/mediaUtils";
import { stripIrcFormatting } from "../../lib/messageFormatter";
import { openExternalUrl } from "../../lib/openUrl";
import useStore from "../../store";
import ExternalLinkWarningModal from "../ui/ExternalLinkWarningModal";

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
}

interface LinkPreviewProps {
  title?: string;
  snippet?: string;
  imageUrl?: string;
  messageContent: string;
  serverId?: string;
}

export const LinkPreview: React.FC<LinkPreviewProps> = ({
  title,
  snippet,
  imageUrl,
  messageContent,
  serverId,
}) => {
  const { t } = useLingui();
  const [showWarningModal, setShowWarningModal] = useState(false);

  const { showSafeMedia, showExternalContent } = mediaLevelToSettings(
    useStore((state) => state.globalSettings.mediaVisibilityLevel),
  );
  const server = serverId
    ? useStore.getState().servers.find((s) => s.id === serverId)
    : null;

  // Don't render if there's no content to show
  if (!title && !snippet && !imageUrl) {
    return null;
  }

  // Strip IRC formatting codes and markdown bold markers before URL matching,
  // so URLs wrapped in color codes or **bold** are still detected correctly.
  const cleanContent = stripIrcFormatting(messageContent).replace(/\*\*/g, "");
  const urlRegex = /\b(?:https?):\/\/[^\s<>"']+/i;
  const match = cleanContent.match(urlRegex);
  const firstUrl = match ? match[0] : undefined;
  const host = firstUrl ? hostOf(firstUrl) : undefined;

  // Check if image is from a trusted source (server filehost or globally configured trusted URLs)
  const isTrustedImage =
    imageUrl && isUrlFromTrustedSource(imageUrl, serverFilehosts(server));
  // Show image if it's from a trusted source and safe media is enabled, or if external content is allowed
  const shouldShowImage =
    imageUrl && ((isTrustedImage && showSafeMedia) || showExternalContent);

  const handleClick = () => {
    if (firstUrl) {
      setShowWarningModal(true);
    }
  };

  const handleConfirmOpen = async () => {
    if (firstUrl) {
      await openExternalUrl(firstUrl);
    }
    setShowWarningModal(false);
  };

  const handleCancelOpen = () => {
    setShowWarningModal(false);
  };

  return (
    <>
      <ExternalLinkWarningModal
        isOpen={showWarningModal}
        url={firstUrl || ""}
        onConfirm={handleConfirmOpen}
        onCancel={handleCancelOpen}
      />
      <div
        className={`code-panel mt-2 max-w-lg flex gap-3 p-3 border-l-4 border-discord-dark-500 select-none ${firstUrl ? "cursor-pointer hover:bg-discord-dark-500/40 transition-colors" : ""}`}
        onClick={handleClick}
        role={firstUrl ? "button" : undefined}
        tabIndex={firstUrl ? 0 : undefined}
        onKeyDown={(e) => {
          if (firstUrl && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          {host && <span className="row-meta truncate">{host}</span>}
          {title && (
            <span className="text-sm font-semibold text-discord-text-link line-clamp-2">
              {decodeHtmlEntities(title)}
            </span>
          )}
          {snippet && (
            <span className="row-meta line-clamp-3">
              {decodeHtmlEntities(snippet)}
            </span>
          )}
        </div>
        {shouldShowImage && (
          <img
            src={imageUrl}
            alt={title || t`Link preview`}
            className="w-20 h-20 shrink-0 object-cover rounded"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}
      </div>
    </>
  );
};
