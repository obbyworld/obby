import type { Message } from "../types/index";
import {
  canShowMedia,
  extractMediaFromMessage,
  type MediaVisibilityLevel,
} from "./mediaUtils";

export { isImageLikeUrl } from "./mediaUtils";

/** Returns all image-like URLs found in a message's content. */
export function extractImageUrlsFromMessage(message: Message): string[] {
  return extractMediaFromMessage(message)
    .filter((e) => e.type === "image")
    .map((e) => e.url);
}

export function canShowImageUrl(
  url: string,
  level: MediaVisibilityLevel,
  filehost?: string | string[] | null,
): boolean {
  // Trusted-sources (level 2) covers embedded services, not arbitrary images,
  // so showTrustedSourcesMedia is intentionally false for image-only contexts.
  return canShowMedia(
    url,
    {
      showSafeMedia: level >= 1,
      showTrustedSourcesMedia: false,
      showExternalContent: level >= 3,
    },
    filehost,
  );
}
