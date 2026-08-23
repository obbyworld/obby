// Lazily load the vendored OTR engine. The bundle is ~220KB of frozen 2013-era
// crypto; a static import would drag it into the app's initial module graph (and
// every consumer of the store). Loading it on demand keeps it out of startup —
// it is only fetched when a user actually starts an OTR session. Cached after
// the first load.

import type { DSAStatic, OtrStatic } from "./otr.bundle";

let loaded: Promise<{ OTR: OtrStatic; DSA: DSAStatic }> | null = null;

export function loadOtr(): Promise<{ OTR: OtrStatic; DSA: DSAStatic }> {
  if (!loaded) {
    loaded = import("./otr.bundle").then((m) => ({ OTR: m.OTR, DSA: m.DSA }));
  }
  return loaded;
}
