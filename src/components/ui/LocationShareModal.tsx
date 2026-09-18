import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import {
  APPROXIMATE_ZOOM,
  buildLocationShareUrl,
  describeGeolocationError,
  EXACT_ZOOM,
  getCurrentLocation,
  type LocationPrecision,
  roundCoordinate,
} from "../../lib/geolocation";
import BaseModal from "../../lib/modal/BaseModal";
import { Button, ModalBody, ModalFooter } from "../../lib/modal/components";
import useStore from "../../store";
import { LoadingSpinner } from "./LoadingSpinner";
import { LocationPicker, type PickedLocation } from "./LocationPicker";
import { SegmentedControl } from "./SegmentedControl";

interface LocationShareModalProps {
  isOpen: boolean;
  target: string;
  onCancel: () => void;
  onShare: (url: string) => void;
}

type Status = "loading" | "ready" | "error";

// Every path that shares a location routes here: sending it can't be taken
// back, and a rounded position must still be reviewed before it goes.
export function LocationShareModal({
  isOpen,
  target,
  onCancel,
  onShare,
}: LocationShareModalProps) {
  const { t } = useLingui();
  const isNarrowView = useStore((state) => state.ui.isNarrowView);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  // Where the device says we are, kept apart from the pin so the map can be
  // dragged away and brought back.
  const [origin, setOrigin] = useState<PickedLocation | null>(null);
  const [picked, setPicked] = useState<PickedLocation | null>(null);
  const [precision, setPrecision] = useState<LocationPrecision>("approximate");
  // Bumped on every press so asking for the same precision twice still puts
  // the map back where it started.
  const [focusToken, setFocusToken] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    setStatus("loading");
    setError(null);
    setOrigin(null);
    setPicked(null);
    setPrecision("approximate");
    setFocusToken(0);
    let cancelled = false;
    getCurrentLocation()
      .then((c) => {
        if (cancelled) return;
        const start = { ...c, zoom: APPROXIMATE_ZOOM };
        setOrigin(start);
        setPicked(start);
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

  const choosePrecision = (next: LocationPrecision) => {
    const zoom = next === "exact" ? EXACT_ZOOM : APPROXIMATE_ZOOM;
    setPrecision(next);
    setFocusToken((token) => token + 1);
    if (origin) setPicked({ ...origin, zoom });
  };

  const handleShare = () => {
    if (!picked) return;
    onShare(
      buildLocationShareUrl(
        picked.latitude,
        picked.longitude,
        precision,
        picked.zoom,
      ),
    );
  };

  const roundedLat = picked
    ? roundCoordinate(picked.latitude, precision)
    : null;
  const roundedLon = picked
    ? roundCoordinate(picked.longitude, precision)
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
        {status === "ready" && picked && (
          <div className="space-y-4 flex-1 min-h-0 flex flex-col">
            <p className="text-sm text-discord-text-normal">
              <Trans>Share your location with {target}.</Trans>
            </p>
            {origin && (
              <LocationPicker
                initial={origin}
                onChange={setPicked}
                focus={{
                  zoom: precision === "exact" ? EXACT_ZOOM : APPROXIMATE_ZOOM,
                  token: focusToken,
                }}
                className={isNarrowView ? "flex-1 min-h-0" : "h-60"}
              />
            )}
            <SegmentedControl
              value={precision}
              onChange={choosePrecision}
              segments={[
                {
                  value: "approximate" as const,
                  label: <Trans>Approximate</Trans>,
                },
                { value: "exact" as const, label: <Trans>Exact</Trans> },
              ]}
            />
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
