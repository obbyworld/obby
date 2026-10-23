import { isTauriDesktop } from "./platformUtils";

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  notes?: string;
  downloadAndInstall: (
    onProgress?: (downloaded: number, total?: number) => void,
  ) => Promise<void>;
}

// Dynamic imports keep the @tauri-apps/plugin-* modules out of the web/Docker
// bundle, where their native bindings do not exist.
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauriDesktop()) return null;

  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;

  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body || undefined,
    downloadAndInstall: async (onProgress) => {
      let total: number | undefined;
      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            onProgress?.(downloaded, total);
            break;
          case "Finished":
            onProgress?.(total ?? downloaded, total);
            break;
        }
      });
    },
  };
}

export async function relaunchApp(): Promise<void> {
  if (!isTauriDesktop()) return;
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
