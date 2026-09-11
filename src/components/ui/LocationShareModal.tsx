import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import {
  buildLocationShareUrl,
  type Coordinates,
  describeGeolocationError,
  getCurrentLocation,
  type LocationPrecision,
  roundCoordinate,
} from "../../lib/geolocation";
import BaseModal from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";
import { MapPreview } from "../message/MapPreview";
import { LoadingSpinner } from "./LoadingSpinner";

interface LocationShareModalProps {
  isOpen: boolean;
  target: string;
  onCancel: () => void;
  onShare: (url: string) => void;
}

type Status = "loading" | "ready" | "error";

const toggleClasses = (active: boolean) =>
  `min-h-11 flex-1 rounded px-3 py-2 text-sm disabled:opacity-50 ${
    active
      ? "bg-discord-primary text-white"
      : "bg-discord-dark-400 text-discord-text-normal"
  }`;

// Every path that shares a location routes here: sending it can't be taken
// back, and a rounded position must still be reviewed before it goes.
export function LocationShareModal({
  isOpen,
  target,
  onCancel,
  onShare,
}: LocationShareModalProps) {
  const { t } = useLingui();
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [precision, setPrecision] = useState<LocationPrecision>("approximate");

  useEffect(() => {
    if (!isOpen) return;
    setStatus("loading");
    setError(null);
    setCoords(null);
    setPrecision("approximate");
    let cancelled = false;
    getCurrentLocation()
      .then((c) => {
        if (cancelled) return;
        setCoords(c);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(describeGeolocationError(err));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleShare = () => {
    if (!coords) return;
    onShare(
      buildLocationShareUrl(coords.latitude, coords.longitude, precision),
    );
  };

  const roundedLat = coords
    ? roundCoordinate(coords.latitude, precision)
    : null;
  const roundedLon = coords
    ? roundCoordinate(coords.longitude, precision)
    : null;
  // Same URL buildLocationShareUrl would send, so the preview always matches
  // the precision the user is about to share.
  const previewUrl = coords
    ? buildLocationShareUrl(coords.latitude, coords.longitude, precision)
    : null;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onCancel}
      title={t`Share Your Location`}
      maxWidth="sm"
    >
      <ModalBody>
        {status === "loading" && (
          <LoadingSpinner text={t`Finding your location…`} />
        )}
        {status === "error" && error && (
          <p className="text-sm text-red-400">{error}</p>
        )}
        {status === "ready" && coords && (
          <div className="space-y-4">
            <p className="text-sm text-discord-text-normal">
              <Trans>Share your location with {target}.</Trans>
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPrecision("approximate")}
                className={toggleClasses(precision === "approximate")}
              >
                <Trans>Approximate</Trans>
              </button>
              <button
                type="button"
                onClick={() => setPrecision("exact")}
                className={toggleClasses(precision === "exact")}
              >
                <Trans>Exact</Trans>
              </button>
            </div>
            <p className="text-xs text-discord-text-muted">
              {precision === "approximate" ? (
                <Trans>Rounded to your neighbourhood, about 100m.</Trans>
              ) : (
                <Trans>Your precise position.</Trans>
              )}
            </p>
            {previewUrl && (
              <div className="flex justify-center">
                <MapPreview key={previewUrl} url={previewUrl} />
              </div>
            )}
            {roundedLat !== null && roundedLon !== null && (
              <p className="text-center font-mono text-xs text-discord-text-muted">
                {roundedLat.toFixed(5)}, {roundedLon.toFixed(5)}
              </p>
            )}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
        <Button
          variant="primary"
          onClick={handleShare}
          disabled={status !== "ready"}
        >
          <Trans>Share</Trans>
        </Button>
      </ModalFooter>
    </BaseModal>
  );
}

export default LocationShareModal;
