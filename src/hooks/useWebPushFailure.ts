import { isTauri } from "../lib/platformUtils";
import useStore from "../store";
import type { WebPushFailure } from "../types";

// Background notifications need a push subscription, so we report a server whose subscription failed.
export function useWebPushFailure(): WebPushFailure | null {
  const isOn = useStore((s) => s.globalSettings.enableNotifications);
  const failure = useStore(
    (s) => s.servers.find((server) => server.webPushFailure)?.webPushFailure,
  );
  if (isTauri() || !isOn) return null;
  return failure ?? null;
}
