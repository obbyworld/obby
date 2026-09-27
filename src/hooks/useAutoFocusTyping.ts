import { type RefObject, useEffect, useRef } from "react";
import { findTextField, findTopModalDialog } from "../lib/focus";

function isEditableActive(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    (active as HTMLElement).isContentEditable
  );
}

// Insert text into a React-controlled input/textarea at the current cursor position.
// Using the native prototype setter triggers React's synthetic onChange.
function insertText(
  input: HTMLTextAreaElement | HTMLInputElement,
  text: string,
) {
  const proto =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (!setter) return;

  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  setter.call(
    input,
    input.value.slice(0, start) + text + input.value.slice(end),
  );
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.setSelectionRange(start + text.length, start + text.length);
}

// We send stray typing to an open inline editor, such as the add-channel row,
// and to the chat input otherwise.
let typingOwner: HTMLInputElement | null = null;

export function useTypingOwner(
  inputRef: RefObject<HTMLInputElement | null>,
  isActive: boolean,
) {
  useEffect(() => {
    const input = inputRef.current;
    if (!isActive || !input) return;
    typingOwner = input;
    return () => {
      if (typingOwner === input) typingOwner = null;
    };
  }, [inputRef, isActive]);
}

export function useAutoFocusTyping(
  inputRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>,
  isBlocked: () => boolean,
) {
  // Stable ref so the effect never needs to re-subscribe when isBlocked identity changes
  const isBlockedRef = useRef(isBlocked);
  isBlockedRef.current = isBlocked;

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      // Single-character key = printable; multi-character = special (Enter, ArrowLeft, F1…)
      if (e.key.length !== 1) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Don't steal focus from an already-focused editable element
      if (isEditableActive()) return;

      // We give stray typing to an open dialog's field so the chat behind it never gets it.
      const dialog = findTopModalDialog();
      if (dialog) {
        findTextField(dialog)?.focus();
        return;
      }

      // Caller says this context shouldn't capture right now
      if (isBlockedRef.current()) return;

      const input = typingOwner ?? inputRef.current;
      if (!input || document.activeElement === input) return;

      input.focus();
      // The browser fires keypress/beforeinput on the newly-focused element,
      // so the triggering character appears in the field automatically.
    };

    const handlePaste = (e: ClipboardEvent) => {
      // If an editable already has focus, let the browser handle it normally
      if (isEditableActive()) return;
      if (findTopModalDialog()) return;
      if (isBlockedRef.current()) return;

      const input = typingOwner ?? inputRef.current;
      if (!input) return;

      const text = e.clipboardData?.getData("text");
      if (!text) return;

      e.preventDefault();
      input.focus();
      insertText(input, text);
    };

    document.addEventListener("keydown", handleKeydown);
    document.addEventListener("paste", handlePaste);
    return () => {
      document.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("paste", handlePaste);
    };
  }, [inputRef]); // inputRef is stable; isBlocked is accessed via ref
}
