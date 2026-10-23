import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";
import { FaMapMarkerAlt } from "react-icons/fa";
import { parseLocationShareUrl } from "../../lib/geolocation";
import { tilesForPreview, tileUrl } from "../../lib/osmTiles";
import useStore from "../../store";

const PREVIEW_WIDTH = 320;
const PREVIEW_HEIGHT = 180;
const TILE_SIZE = 256;

// Renders straight from OpenStreetMap's own tiles -- a small static card,
// never a live embedded map -- so the preview is just an ordinary set of
// trusted-source image requests, gated the same way every other trusted
// preview is. The interactive map lives in the media viewer, opened on click.
export const MapPreview: React.FC<{
  url: string;
  msgid?: string;
  serverId?: string;
  channelId?: string;
  onRenderFailed?: (url: string) => void;
}> = ({ url, msgid, serverId, channelId, onRenderFailed }) => {
  const openMedia = useStore((s) => s.openMedia);
  const [failedTileKeys, setFailedTileKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const location = parseLocationShareUrl(url);
  const placements = location
    ? tilesForPreview(
        location.latitude,
        location.longitude,
        location.zoom,
        PREVIEW_WIDTH,
        PREVIEW_HEIGHT,
      )
    : [];
  // A blocked or offline tile server fails every tile, leaving a blank card —
  // that counts the same as a parse failure: nothing worth showing.
  const failed =
    !location ||
    (placements.length > 0 && failedTileKeys.size >= placements.length);

  useEffect(() => {
    if (failed) onRenderFailed?.(url);
  }, [failed, onRenderFailed, url]);

  if (failed) return null;

  return (
    <div className="max-w-md">
      <button
        type="button"
        onClick={() => openMedia(url, msgid, serverId, channelId)}
        aria-label={t`Open map`}
        className="relative block overflow-hidden rounded-lg border border-discord-dark-500/50 shadow-sm hover:opacity-90 transition-opacity"
        style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}
      >
        {placements.map((p) => {
          const key = `${p.z}/${p.x}/${p.y}`;
          return (
            <img
              key={key}
              src={tileUrl(p.z, p.x, p.y)}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              className="absolute"
              style={{
                left: p.drawX,
                top: p.drawY,
                width: TILE_SIZE,
                height: TILE_SIZE,
              }}
              onError={() =>
                setFailedTileKeys((prev) => {
                  if (prev.has(key)) return prev;
                  return new Set(prev).add(key);
                })
              }
            />
          );
        })}
        <FaMapMarkerAlt
          aria-hidden="true"
          className="absolute text-red-600 drop-shadow-md"
          style={{
            left: PREVIEW_WIDTH / 2,
            top: PREVIEW_HEIGHT / 2,
            width: 28,
            height: 28,
            transform: "translate(-50%, -100%)",
          }}
        />
        <span className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-2 py-0.5 text-[11px] leading-tight text-white">
          © OpenStreetMap contributors
        </span>
      </button>
    </div>
  );
};

export default MapPreview;
