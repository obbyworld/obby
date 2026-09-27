const TEXT_FIELD_SELECTOR =
  "input:not([type]), input[type='text'], input[type='search'], input[type='password'], textarea, [contenteditable='true']";

const MODAL_SELECTOR = "[aria-modal='true'], .modal-container";

export function findTextField(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(TEXT_FIELD_SELECTOR);
}

export function findTopModalDialog(): HTMLElement | null {
  const dialogs = document.querySelectorAll<HTMLElement>(MODAL_SELECTOR);
  return dialogs[dialogs.length - 1] ?? null;
}
