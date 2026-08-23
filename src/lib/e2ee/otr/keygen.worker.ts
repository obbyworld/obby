// Off-main-thread OTR DSA keygen. The pure-JS DSA-1024 keygen blocks for ~2s, so
// it runs here to keep the UI responsive; the result is posted back serialised
// (packPrivate) and the identity layer persists it. globalThis.crypto is the
// CSPRNG source inside workers, so the vendored bundle generates keys securely.

import { DSA } from "../../otr/vendor/otr.bundle";

// The project's tsconfig uses the DOM lib, not WebWorker, so narrow `self` to the
// minimal worker surface we use rather than pulling in a conflicting lib.
const ctx = self as unknown as {
  onmessage: (() => void) | null;
  postMessage: (message: string) => void;
};

ctx.onmessage = () => {
  ctx.postMessage(new DSA().packPrivate());
};
