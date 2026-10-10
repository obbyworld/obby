const HIGHLIGHT_MS = 2000;

export function findMessageRow(
  root: ParentNode,
  id: string,
): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(id)}"]`,
  );
}

const scrollBehavior = (): ScrollBehavior =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";

export function centerRow(
  container: HTMLElement,
  row: Element,
  behavior: ScrollBehavior = scrollBehavior(),
): void {
  const top =
    row.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop;
  container.scrollTo({
    top: top - container.clientHeight / 2 + row.clientHeight / 2,
    behavior,
  });
}

export function flashHighlight(element: Element): () => void {
  element.classList.add("jump-highlight");
  const timer = setTimeout(
    () => element.classList.remove("jump-highlight"),
    HIGHLIGHT_MS,
  );
  return () => {
    clearTimeout(timer);
    element.classList.remove("jump-highlight");
  };
}

export function highlightRow(container: HTMLElement, row: Element) {
  centerRow(container, row);
  return flashHighlight(row);
}
