import { useEffect, useRef, useState } from "react";

/** A drop or a paste anywhere over the app means the open conversation, so the
 *  whole window listens rather than only the message box. */
export function useWindowFileCapture({
  enabled,
  onFiles,
}: {
  enabled: boolean;
  onFiles: (files: File[]) => void;
}): boolean {
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  useEffect(() => {
    if (!enabled) {
      setIsDraggingFile(false);
      return;
    }

    // A modal takes the window over while it is up, so a file dropped on it
    // belongs to whatever it is showing.
    const conversationIsInFront = () =>
      !document.querySelector('[role="dialog"]');

    const editableHasFocus = () => {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLElement)) return false;
      return (
        focused.isContentEditable ||
        focused instanceof HTMLInputElement ||
        focused instanceof HTMLTextAreaElement
      );
    };

    const dragCarriesFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");

    let depth = 0;

    const onDragEnter = (event: DragEvent) => {
      if (!dragCarriesFiles(event) || !conversationIsInFront()) return;
      event.preventDefault();
      depth += 1;
      setIsDraggingFile(true);
    };

    const onDragOver = (event: DragEvent) => {
      if (!dragCarriesFiles(event) || !conversationIsInFront()) return;
      // Without this the browser opens the file in place of the app.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };

    const onDragLeave = (event: DragEvent) => {
      if (!dragCarriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setIsDraggingFile(false);
    };

    const onDrop = (event: DragEvent) => {
      if (!dragCarriesFiles(event)) return;
      depth = 0;
      setIsDraggingFile(false);
      if (!conversationIsInFront()) return;
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) onFilesRef.current(files);
    };

    const onPaste = (event: ClipboardEvent) => {
      // The message box handles its own paste, and anywhere someone is typing
      // the paste is theirs.
      if (event.defaultPrevented || editableHasFocus()) return;
      if (!conversationIsInFront()) return;
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      onFilesRef.current(files);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      document.removeEventListener("paste", onPaste);
    };
  }, [enabled]);

  return isDraggingFile;
}
