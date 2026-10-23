const TEXT_FIELD_SELECTOR =
  "input:not([type]), input[type='text'], input[type='search'], input[type='password'], textarea, [contenteditable='true']";

const MODAL_SELECTOR = "[aria-modal='true'], .modal-container";

let isKeyboardInput = false;
if (typeof document !== "undefined") {
  document.addEventListener(
    "keydown",
    () => {
      isKeyboardInput = true;
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    () => {
      isKeyboardInput = false;
    },
    true,
  );
}

// We move focus into newly opened menus only for keyboard users, so a mouse
// click never draws a focus ring.
export const wasLastInputKeyboard = (): boolean => isKeyboardInput;

export function findTextField(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(TEXT_FIELD_SELECTOR);
}

export function findTopModalDialog(): HTMLElement | null {
  const dialogs = document.querySelectorAll<HTMLElement>(MODAL_SELECTOR);
  return dialogs[dialogs.length - 1] ?? null;
}

export const keepInputFocus = (e: { preventDefault: () => void }) =>
  e.preventDefault();
