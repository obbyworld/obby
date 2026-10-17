import { useMediaQuery } from "./useMediaQuery";

// We key touch UI (bottom sheets, long-press, drag handles) off the input
// device, so a narrow desktop window still gets mouse UI.
export const useIsTouchInput = (): boolean =>
  useMediaQuery("(pointer: coarse)");
