// Types for the vendored otr.js v0.2.16 bundle (otr.bundle.js). Hand-written —
// the upstream library ships no types. Only the surface ObbyIRCd uses is typed;
// the library exposes more. See claudedocs/otr-interop-design.md.

export interface DSAKey {
  /** 40-hex SHA-1 fingerprint of the public key (the string Pidgin/irssi show). */
  fingerprint(): string;
  /** Serialise the private key (base64 of packed MPIs) for persistence. */
  packPrivate(): string;
}

export interface DSAStatic {
  new (): DSAKey;
  /** Reconstruct a key from packPrivate() output. */
  parsePrivate(packed: string): DSAKey;
}

export type OtrEvent = "io" | "ui" | "status" | "error" | "trust";

export interface OtrOptions {
  priv: DSAKey;
  /** Max bytes per fragment; OTR splits longer messages itself. ~400 for IRC. */
  fragment_size?: number;
  /** Delay between fragments (ms) to avoid IRC flood throttling. */
  send_interval?: number;
  instance_tag?: string;
  debug?: boolean;
}

export interface OtrInstance {
  /** Current message state; compare against OTRStatic.CONST.MSGSTATE_*. */
  msgstate: number;
  /** Peer's long-term public key, populated after a successful AKE. */
  their_priv_pk: DSAKey | null;
  on(event: "io", cb: (msg: string, meta?: unknown) => void): void;
  on(
    event: "ui",
    cb: (msg: string, encrypted: boolean, meta?: unknown) => void,
  ): void;
  on(event: "status", cb: (state: number) => void): void;
  on(
    event: "error",
    cb: (err: string | Error, severity?: string) => void,
  ): void;
  on(event: "trust", cb: (trust: boolean, type: string) => void): void;
  /** Send a user message; emits ciphertext frames via the "io" event. */
  sendMsg(msg: string): void;
  /** Feed an inbound OTR frame; emits "ui"/"io"/"status" as it processes. */
  receiveMsg(msg: string): void;
  /** Emit a `?OTRv23?` query to start a session; the peer's client replies. */
  sendQueryMsg(): void;
  /** Tear down the session, emitting a disconnect frame via "io". */
  endOtr(): void;
}

export interface OtrConst {
  MSGSTATE_PLAINTEXT: 0;
  MSGSTATE_ENCRYPTED: 1;
  MSGSTATE_FINISHED: 2;
  STATUS_AKE_SUCCESS: 2;
  STATUS_END_OTR: 3;
  [k: string]: number;
}

export interface OtrStatic {
  new (opts: OtrOptions): OtrInstance;
  CONST: OtrConst;
}

export const OTR: OtrStatic;
export const DSA: DSAStatic;
