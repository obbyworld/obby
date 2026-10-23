import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./platformUtils";

/**
 * Opens URL in system browser (native) or new tab (web)
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauri()) {
    await invoke("open_external_url", { url });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
