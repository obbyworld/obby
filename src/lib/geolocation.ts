import { t } from "@lingui/core/macro";
import {
  checkPermissions as checkNativePermissions,
  getCurrentPosition as getNativePosition,
  requestPermissions as requestNativePermissions,
} from "@tauri-apps/plugin-geolocation";
import { isTauriDesktop, isTauriMobile } from "./platformUtils";

export type LocationPrecision = "exact" | "approximate";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

// 3 decimal places is about 111m at the equator -- enough to blur which
// building someone is in while still placing them in their neighbourhood.
const APPROXIMATE_DECIMALS = 3;

export const EXACT_ZOOM = 17;
export const APPROXIMATE_ZOOM = 14;

const DEFAULT_TIMEOUT_MS = 15_000;

export function roundCoordinate(
  value: number,
  precision: LocationPrecision,
): number {
  if (precision === "exact") return value;
  return Number(value.toFixed(APPROXIMATE_DECIMALS));
}

// A plain OpenStreetMap link: readable in any IRC client and opens in the
// reader's own browser or map app, so nothing in this app ever has to fetch
// a tile on the reader's behalf.
export function buildLocationShareUrl(
  latitude: number,
  longitude: number,
  precision: LocationPrecision,
  zoom?: number,
): string {
  const lat = roundCoordinate(latitude, precision);
  const lon = roundCoordinate(longitude, precision);
  const mapZoom =
    zoom ?? (precision === "exact" ? EXACT_ZOOM : APPROXIMATE_ZOOM);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${mapZoom}/${lat}/${lon}`;
}

export interface ParsedLocationUrl {
  latitude: number;
  longitude: number;
  zoom: number;
}

// The inverse of buildLocationShareUrl. Reads mlat/mlon out of the URL
// itself, so the preview reflects whatever precision the link was built
// with -- our own share button's, or one a person simply pasted.
export function parseLocationShareUrl(url: string): ParsedLocationUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname.replace(/^www\./, "") !== "openstreetmap.org") {
    return null;
  }
  const mlat = parsed.searchParams.get("mlat");
  const mlon = parsed.searchParams.get("mlon");
  if (mlat === null || mlon === null) return null;
  const latitude = Number(mlat);
  const longitude = Number(mlon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const fragmentZoom = parsed.hash.match(/#map=(\d+)\//)?.[1];
  const zoom = fragmentZoom ? Number(fragmentZoom) : APPROXIMATE_ZOOM;
  return { latitude, longitude, zoom };
}

// The plugin behind this is Android/iOS only (no desktop implementation),
// and the macOS webview exposes no geolocation API of its own, so the entry
// point must be absent on desktop rather than present and broken there.
export function locationSharingSupported(): boolean {
  if (isTauriDesktop()) return false;
  if (isTauriMobile()) return true;
  return typeof navigator !== "undefined" && !!navigator.geolocation;
}

export class GeolocationTimeoutError extends Error {
  constructor() {
    super("Timed out waiting for a location fix.");
    this.name = "GeolocationTimeoutError";
  }
}

export class GeolocationPermissionDeniedError extends Error {
  constructor() {
    super("Location permission was denied.");
    this.name = "GeolocationPermissionDeniedError";
  }
}

function errorCode(err: unknown): number | null {
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "number"
  ) {
    return (err as { code: number }).code;
  }
  return null;
}

// Web's GeolocationPositionError codes: 1 PERMISSION_DENIED, 2
// POSITION_UNAVAILABLE, 3 TIMEOUT. The native plugin checks permission
// state up front instead of surfacing a matching code, so that path is
// caught above via GeolocationPermissionDeniedError.
export function describeGeolocationError(err: unknown): string {
  if (err instanceof GeolocationPermissionDeniedError || errorCode(err) === 1) {
    return t`Location access was denied. Allow location access in your browser or system settings, then try again.`;
  }
  if (err instanceof GeolocationTimeoutError || errorCode(err) === 3) {
    return t`Could not find your location in time. Try again somewhere with a clearer view of the sky.`;
  }
  if (errorCode(err) === 2) {
    return t`This device could not find your location right now. Try again in a moment.`;
  }
  return t`Could not get your location.`;
}

function getCurrentPositionWeb(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not available."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      reject,
      { enableHighAccuracy: true },
    );
  });
}

async function getCurrentPositionNative(): Promise<Coordinates> {
  let permissions = await checkNativePermissions();
  if (
    permissions.location === "prompt" ||
    permissions.location === "prompt-with-rationale"
  ) {
    permissions = await requestNativePermissions(["location"]);
  }
  if (permissions.location !== "granted") {
    throw new GeolocationPermissionDeniedError();
  }
  const position = await getNativePosition();
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
}

// The plugin's own timeout option is ignored on iOS entirely and ignored by
// getCurrentPosition on Android, so a device that never gets a fix would
// leave the caller waiting forever without a timer of our own.
export function getCurrentLocation(
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Coordinates> {
  const capture = isTauriMobile()
    ? getCurrentPositionNative()
    : getCurrentPositionWeb();
  return Promise.race([
    capture,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new GeolocationTimeoutError()), timeoutMs);
    }),
  ]);
}
