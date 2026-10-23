import { t } from "@lingui/core/macro";
import type { Map as LeafletMap } from "leaflet";
import { useEffect, useRef } from "react";
import { FaCrosshairs, FaMapMarkerAlt } from "react-icons/fa";
import type { Coordinates } from "../../lib/geolocation";
import {
  clampMapZoom,
  loadLeaflet,
  MAP_ATTRIBUTION,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
} from "../../lib/leafletMap";
import { TILE_URL_TEMPLATE } from "../../lib/osmTiles";

export interface PickedLocation extends Coordinates {
  zoom: number;
}

/** A map whose pin sits at the centre of the view: dragging the map moves the
 *  pin, so the place being shared is whatever the person has framed. */
export const LocationPicker: React.FC<{
  initial: PickedLocation;
  onChange: (picked: PickedLocation) => void;
  /** A request to put the map back on the starting position at a given zoom.
   *  The token is what triggers it, so asking twice in a row works. */
  focus?: { zoom: number; token: number };
  /** Sizing for the map, so a caller can give it a fixed height or let it fill
   *  what a column has left. */
  className?: string;
}> = ({ initial, onChange, focus, className = "h-60" }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const focusTokenRef = useRef(focus?.token);
  // The map is built once. Re-centring it from the value it reports back would
  // fight the person's own dragging.
  const initialRef = useRef(initial);

  useEffect(() => {
    let cancelled = false;
    let map: LeafletMap | undefined;
    const start = initialRef.current;
    const element = containerRef.current;
    // The map fills whatever the modal has left, which is settled by the open
    // animation, the keyboard and rotation, so it measures itself on every
    // change rather than once.
    const resize = new ResizeObserver(() => map?.invalidateSize());

    loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current) return;
      map = L.map(containerRef.current, {
        center: [start.latitude, start.longitude],
        zoom: clampMapZoom(start.zoom),
        minZoom: MAP_MIN_ZOOM,
        maxZoom: MAP_MAX_ZOOM,
        zoomControl: false,
        attributionControl: true,
      });
      mapRef.current = map;
      L.tileLayer(TILE_URL_TEMPLATE, {
        attribution: MAP_ATTRIBUTION,
        maxZoom: MAP_MAX_ZOOM,
      }).addTo(map);
      map.on("moveend", () => {
        if (!map) return;
        const center = map.getCenter();
        onChangeRef.current({
          latitude: center.lat,
          longitude: center.lng,
          zoom: map.getZoom(),
        });
      });
      if (element) resize.observe(element);
    });

    return () => {
      cancelled = true;
      resize.disconnect();
      mapRef.current = null;
      map?.remove();
    };
  }, []);

  const showStart = (zoom: number) => {
    const start = initialRef.current;
    mapRef.current?.setView(
      [start.latitude, start.longitude],
      clampMapZoom(zoom),
    );
  };

  useEffect(() => {
    if (!focus || focus.token === focusTokenRef.current) return;
    focusTokenRef.current = focus.token;
    showStart(focus.zoom);
  });

  return (
    <div
      data-no-gesture=""
      className={`relative w-full min-h-[180px] overflow-hidden rounded-lg border border-discord-dark-500/50 ${className}`}
    >
      <div
        ref={containerRef}
        data-testid="location-picker"
        className="h-full"
      />
      <FaMapMarkerAlt
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 z-[500] text-red-600 drop-shadow-md"
        style={{ width: 28, height: 28, transform: "translate(-50%, -100%)" }}
      />
      <button
        type="button"
        onClick={() => showStart(initialRef.current.zoom)}
        aria-label={t`Centre on your location`}
        className="absolute right-2 top-2 z-[500] flex h-11 w-11 items-center justify-center rounded bg-discord-dark-300/90 text-discord-text-normal shadow hover:bg-discord-dark-200"
      >
        <FaCrosshairs aria-hidden="true" />
      </button>
    </div>
  );
};

export default LocationPicker;
