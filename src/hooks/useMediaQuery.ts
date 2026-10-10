import { useCallback, useSyncExternalStore } from "react";

// Every message row asks the same few queries, so we share one list per query.
const queryLists = new Map<string, MediaQueryList>();
let listsMadeBy: typeof window.matchMedia | null = null;

function queryList(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return null;
  if (listsMadeBy !== window.matchMedia) {
    queryLists.clear();
    listsMadeBy = window.matchMedia;
  }
  let list = queryLists.get(query);
  if (!list) {
    list = window.matchMedia(query);
    queryLists.set(query, list);
  }
  return list;
}

export function useMediaQuery(query = "(max-width: 768px)"): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = queryList(query);
      list?.addEventListener("change", onChange);
      return () => list?.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => queryList(query)?.matches ?? false,
    () => false,
  );
}
