// Encrypted attachments for Obby private messages. The file is encrypted here,
// the ciphertext is uploaded to whatever filehost the server advertises, and
// the descriptor (location plus file key) travels as the plaintext of a `media`
// frame. The host stores bytes it cannot read, and the URL alone is useless.
//
// The descriptor is never message content, so the URL is never rendered as a
// link and nobody can follow it to bytes that will not open.

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { base64ToBytes, bytesToBase64 } from "../base64";

const KEY_BYTES = 32;
const NONCE_BYTES = 24;

// Ciphertext has no content type to sniff, so the upload carries a fixed header
// and its own extension. A filehost validates the header to tell an encrypted
// attachment from an arbitrary blob, and routes the extension away from any
// image pipeline: re-encoding would break the authentication tag below.
export const CIPHERTEXT_EXTENSION = ".obb";

const MAGIC = new Uint8Array([
  0x4f, 0x42, 0x42, 0x59, 0x45, 0x32, 0x45, 0x45, 0x01,
]);

export function ciphertextFileName(): string {
  return `${crypto.randomUUID()}${CIPHERTEXT_EXTENSION}`;
}

export function wrapForUpload(ciphertext: Uint8Array): Uint8Array {
  const out = new Uint8Array(MAGIC.length + ciphertext.length);
  out.set(MAGIC);
  out.set(ciphertext, MAGIC.length);
  return out;
}

// Returns null when the header is absent, which means the object was replaced
// or the host rewrote it. Copies rather than views, so the full download can be
// released once the ciphertext is out.
export function unwrapDownload(data: Uint8Array): Uint8Array | null {
  if (data.length < MAGIC.length) return null;
  for (let i = 0; i < MAGIC.length; i++) {
    if (data[i] !== MAGIC[i]) return null;
  }
  return data.slice(MAGIC.length);
}

// Encrypting is whole-file: the sender holds plaintext and ciphertext at once,
// and the receiver cannot decrypt until the whole object has been fetched, so
// there is no streaming or seeking. Past this size that stops being reasonable
// on a phone, and the file is offered as a normal unencrypted upload instead.
export const MAX_ENCRYPTABLE_BYTES = 25 * 1024 * 1024;

export function canEncryptMedia(sizeBytes: number): boolean {
  return sizeBytes <= MAX_ENCRYPTABLE_BYTES;
}

// Why bytes leave a locked conversation in the clear: past the size ceiling, or
// under a scheme that carries no frame for a file at all. The confirm prompt,
// the upload row and the upload path all label the same two cases.
export type PlainUploadReason = "too-large" | "scheme";

export interface EncryptedMedia {
  ciphertext: Uint8Array;
  key: Uint8Array;
  nonce: Uint8Array;
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export function encryptMedia(plaintext: Uint8Array): EncryptedMedia {
  const key = randomBytes(KEY_BYTES);
  const nonce = randomBytes(NONCE_BYTES);
  return {
    ciphertext: xchacha20poly1305(key, nonce).encrypt(plaintext),
    key,
    nonce,
  };
}

// Throws when the bytes were truncated, swapped, or rewritten: the AEAD tag
// covers the whole object, so a host that modifies uploads fails here instead
// of producing a plausible file.
export function decryptMedia(
  ciphertext: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
): Uint8Array {
  return xchacha20poly1305(key, nonce).decrypt(ciphertext);
}

// What a `media` frame decrypts to.
export interface MediaDescriptor {
  url: string;
  k: string;
  n: string;
  mime: string;
  name: string;
  size: number;
  caption?: string;
}

export function buildMediaDescriptor(
  url: string,
  media: EncryptedMedia,
  file: { name: string; type: string; size: number },
  caption?: string,
): MediaDescriptor {
  const descriptor: MediaDescriptor = {
    url,
    k: bytesToBase64(media.key),
    n: bytesToBase64(media.nonce),
    mime: file.type,
    name: file.name,
    size: file.size,
  };
  if (caption) descriptor.caption = caption;
  return descriptor;
}

export function encodeMediaDescriptor(descriptor: MediaDescriptor): string {
  return JSON.stringify(descriptor);
}

// Returns null for anything malformed so a peer cannot make the renderer throw
// by sending a broken descriptor.
export function decodeMediaDescriptor(text: string): MediaDescriptor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (
    typeof o.url !== "string" ||
    typeof o.k !== "string" ||
    typeof o.n !== "string" ||
    typeof o.mime !== "string" ||
    typeof o.name !== "string" ||
    typeof o.size !== "number"
  ) {
    return null;
  }
  const descriptor: MediaDescriptor = {
    url: o.url,
    k: o.k,
    n: o.n,
    mime: o.mime,
    name: o.name,
    size: o.size,
  };
  if (typeof o.caption === "string") descriptor.caption = o.caption;
  return descriptor;
}

// A peer chooses the name, and it reaches the UI as label and download target.
// Control and bidi characters are dropped because they can make a displayed
// extension read as something other than what is saved.
const UNSAFE_NAME_CHARS =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069/\\]/g;

export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(UNSAFE_NAME_CHARS, "");
  return cleaned.trim().slice(0, 120) || "attachment";
}

export function mediaKeyBytes(descriptor: MediaDescriptor): {
  key: Uint8Array;
  nonce: Uint8Array;
} {
  return {
    key: base64ToBytes(descriptor.k),
    nonce: base64ToBytes(descriptor.n),
  };
}

// Fetch and decrypt an attachment into a blob the existing media components can
// render. The URL is always a filehost the message came from, so the caller
// applies the same trust rules as any other media before calling.
export async function fetchDecryptedMedia(
  descriptor: MediaDescriptor,
  signal?: AbortSignal,
): Promise<Blob> {
  if (descriptor.size > MAX_ENCRYPTABLE_BYTES) {
    throw new Error("media descriptor exceeds the attachment limit");
  }
  const response = await fetch(descriptor.url, { signal });
  if (!response.ok) throw new Error(`media fetch failed: ${response.status}`);
  // A descriptor is peer-authored, so its size is a claim. Buffering the body
  // before checking it would let that claim allocate the tab's memory.
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_ENCRYPTABLE_BYTES + MAGIC.length) {
    throw new Error("media response exceeds the attachment limit");
  }
  const stored = new Uint8Array(await response.arrayBuffer());
  if (stored.length > MAX_ENCRYPTABLE_BYTES + MAGIC.length) {
    throw new Error("media response exceeds the attachment limit");
  }
  const ciphertext = unwrapDownload(stored);
  if (!ciphertext) throw new Error("media header missing");
  const { key, nonce } = mediaKeyBytes(descriptor);
  const plaintext = decryptMedia(ciphertext, key, nonce);
  return new Blob([plaintext.slice().buffer], {
    type: renderableMime(descriptor.mime),
  });
}

// A blob URL inherits this page's origin, so a peer-chosen type that a browser
// will render as a document is a script running with our localStorage. Only the
// types that go into a media element keep their type; everything else is handed
// over as bytes. SVG is excluded for the same reason the shared probe excludes
// it (see classifyContentType in mediaProbe).
export function renderableMime(mime: string): string {
  if (mime === "image/svg+xml") return "application/octet-stream";
  return /^(?:image|video|audio)\//.test(mime)
    ? mime
    : "application/octet-stream";
}
