// Android WebView reports env(safe-area-inset-*) only in some versions, so the
// Android shell measures the system bars itself and we set the same CSS
// variables the layout reads everywhere else.

const NATIVE_INSETS_EVENT = "obby-native-insets";
const SIDES = ["top", "right", "bottom", "left"] as const;

type Insets = Record<(typeof SIDES)[number], number>;

export function applyInsets(insets: Insets): void {
  for (const side of SIDES)
    document.documentElement.style.setProperty(
      `--safe-area-inset-${side}`,
      `${insets[side]}px`,
    );
}

export function followNativeInsets(): void {
  const bridge = globalThis.window?.ObbyNative;
  if (!bridge?.insets) return;
  // Android runs a bridge method only when it is called on the bridge object.
  applyInsets(JSON.parse(bridge.insets()) as Insets);
  window.addEventListener(NATIVE_INSETS_EVENT, (e) =>
    applyInsets((e as CustomEvent<Insets>).detail),
  );
}
