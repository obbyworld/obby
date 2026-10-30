import { base64EncodeUtf8 } from "./base64";
import { isTauri } from "./platformUtils";

/** Saves a file the app holds in memory, such as an attachment that has not
 *  been sent, to a place the user picks. */
export async function saveFileToDevice(file: File): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_file", new Uint8Array(await file.arrayBuffer()), {
      headers: { "x-file-name": base64EncodeUtf8(file.name) },
    });
    return;
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  // Some browsers read the URL only after the click returns, so we release it a minute later.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
