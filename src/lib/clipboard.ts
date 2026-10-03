// Resolves false when the platform refuses the write (no clipboard API, no
// permission, or an unfocused document), so callers can show that it failed.
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    if (error instanceof DOMException) return false;
    throw error;
  }
}
