import { describe, expect, test, vi } from "vitest";
import {
  buildMediaDescriptor,
  CIPHERTEXT_EXTENSION,
  canEncryptMedia,
  ciphertextFileName,
  decodeMediaDescriptor,
  decryptMedia,
  encodeMediaDescriptor,
  encryptMedia,
  fetchDecryptedMedia,
  MAX_ENCRYPTABLE_BYTES,
  MediaFetchError,
  mediaKeyBytes,
  renderableMime,
  sanitizeFileName,
  unwrapDownload,
  wrapForUpload,
} from "../../../src/lib/e2ee/media";
import {
  E2EE_MEDIA_TAG,
  E2EE_SESSION_TAG,
  encryptedMediaOf,
  isFromEncryptedSession,
} from "../../../src/lib/e2ee/messageFlags";

const file = { name: "cat.png", type: "image/png", size: 5 };

describe("media encryption", () => {
  test("round-trips the bytes", () => {
    const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
    const media = encryptMedia(plaintext);
    expect(decryptMedia(media.ciphertext, media.key, media.nonce)).toEqual(
      plaintext,
    );
  });

  test("the ciphertext does not contain the plaintext", () => {
    const plaintext = new TextEncoder().encode("SECRET-MARKER-VALUE");
    const { ciphertext } = encryptMedia(plaintext);
    const asText = new TextDecoder().decode(ciphertext);
    expect(asText).not.toContain("SECRET-MARKER-VALUE");
  });

  test("a flipped ciphertext byte fails authentication", () => {
    const media = encryptMedia(new Uint8Array([9, 9, 9, 9]));
    media.ciphertext[0] ^= 0xff;
    expect(() =>
      decryptMedia(media.ciphertext, media.key, media.nonce),
    ).toThrow();
  });

  test("a truncated download fails rather than yielding partial content", () => {
    const media = encryptMedia(new Uint8Array(64).fill(7));
    const short = media.ciphertext.slice(0, media.ciphertext.length - 8);
    expect(() => decryptMedia(short, media.key, media.nonce)).toThrow();
  });

  test("another key cannot open it", () => {
    const media = encryptMedia(new Uint8Array([1, 2, 3]));
    const other = encryptMedia(new Uint8Array([1, 2, 3]));
    expect(() =>
      decryptMedia(media.ciphertext, other.key, media.nonce),
    ).toThrow();
  });

  test("each file gets its own key and nonce", () => {
    const a = encryptMedia(new Uint8Array([1]));
    const b = encryptMedia(new Uint8Array([1]));
    expect(a.key).not.toEqual(b.key);
    expect(a.nonce).not.toEqual(b.nonce);
  });
});

describe("media descriptor", () => {
  test("round-trips through the message body", () => {
    const media = encryptMedia(new Uint8Array([1, 2, 3]));
    const ref = buildMediaDescriptor("https://host/cat.png", media, file);
    const decoded = decodeMediaDescriptor(encodeMediaDescriptor(ref));
    expect(decoded).toEqual(ref);
  });

  test("carries the real type and name", () => {
    const media = encryptMedia(new Uint8Array([1]));
    const ref = buildMediaDescriptor("https://host/cat.png", media, file);
    expect(ref.mime).toBe("image/png");
    expect(ref.name).toBe("cat.png");
  });

  test("the decoded key opens the ciphertext", () => {
    const plaintext = new Uint8Array([4, 5, 6]);
    const media = encryptMedia(plaintext);
    const ref = decodeMediaDescriptor(
      encodeMediaDescriptor(
        buildMediaDescriptor("https://host/cat.png", media, file),
      ),
    );
    if (!ref) throw new Error("descriptor did not decode");
    const { key, nonce } = mediaKeyBytes(ref);
    expect(decryptMedia(media.ciphertext, key, nonce)).toEqual(plaintext);
  });

  test("anything that is not a descriptor decodes to null", () => {
    for (const input of [
      "hello there",
      "https://example.com/cat.png",
      "{not json",
      "",
      "[1,2,3]",
    ]) {
      expect(decodeMediaDescriptor(input)).toBeNull();
    }
  });

  test("a descriptor missing its key is rejected", () => {
    const media = encryptMedia(new Uint8Array([1]));
    const { k, ...withoutKey } = buildMediaDescriptor(
      "https://host/cat.png",
      media,
      file,
    );
    expect(decodeMediaDescriptor(JSON.stringify(withoutKey))).toBeNull();
  });

  test("a caption survives the round-trip", () => {
    const media = encryptMedia(new Uint8Array([1]));
    const ref = buildMediaDescriptor(
      "https://host/cat.png",
      media,
      file,
      "look at this",
    );
    expect(decodeMediaDescriptor(encodeMediaDescriptor(ref))?.caption).toBe(
      "look at this",
    );
  });
});

// The name is peer-authored and reaches the UI as a label and a download
// target, so it cannot carry characters that rewrite what the user sees.
describe("file name sanitising", () => {
  test("an ordinary name is untouched", () => {
    expect(sanitizeFileName("holiday photo.png")).toBe("holiday photo.png");
  });

  test("bidi overrides that disguise an extension are stripped", () => {
    expect(sanitizeFileName("photo\u202egnp.exe")).toBe("photognp.exe");
  });

  test("path separators cannot escape the download name", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("....etcpasswd");
  });

  test("control characters are stripped", () => {
    expect(sanitizeFileName("a\u0000b\u001fc")).toBe("abc");
  });

  test("an empty or all-stripped name still yields something to show", () => {
    expect(sanitizeFileName("")).toBe("attachment");
    expect(sanitizeFileName("\u0000\u0000")).toBe("attachment");
  });
});

describe("size gate", () => {
  test("ordinary media encrypts", () => {
    expect(canEncryptMedia(5 * 1024 * 1024)).toBe(true);
    expect(canEncryptMedia(MAX_ENCRYPTABLE_BYTES)).toBe(true);
  });

  test("past the limit the caller must fall back to a plain upload", () => {
    expect(canEncryptMedia(MAX_ENCRYPTABLE_BYTES + 1)).toBe(false);
  });
});

// A link sent inside an encrypted session points at a file the host stores in
// the clear, which is a different thing from an encrypted attachment. The two
// have to stay distinguishable so only one of them claims to be protected.
describe("plain media inside an encrypted session", () => {
  test("a session message carrying a URL is not an encrypted attachment", () => {
    const message = { tags: { [E2EE_SESSION_TAG]: "1" } };
    expect(isFromEncryptedSession(message)).toBe(true);
    expect(encryptedMediaOf(message)).toBeNull();
  });

  test("an encrypted attachment exposes its descriptor", () => {
    const media = encryptMedia(new Uint8Array([1]));
    const descriptor = buildMediaDescriptor(
      "https://host/cat.png",
      media,
      file,
    );
    const message = {
      tags: { [E2EE_MEDIA_TAG]: encodeMediaDescriptor(descriptor) },
    };
    expect(encryptedMediaOf(message)).toEqual(descriptor);
    expect(isFromEncryptedSession(message)).toBe(false);
  });

  test("a tampered descriptor reads as no attachment rather than throwing", () => {
    const message = { tags: { [E2EE_MEDIA_TAG]: "{not json" } };
    expect(encryptedMediaOf(message)).toBeNull();
  });
});

// Ciphertext is uploaded behind a fixed header so a filehost can tell an
// encrypted attachment from an arbitrary blob without reading it.
describe("upload framing", () => {
  test("wrapping then unwrapping returns the ciphertext", () => {
    const media = encryptMedia(new Uint8Array([1, 2, 3]));
    const stored = wrapForUpload(media.ciphertext);
    expect(unwrapDownload(stored)).toEqual(media.ciphertext);
  });

  test("bytes without the header are rejected", () => {
    expect(
      unwrapDownload(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])),
    ).toBeNull();
    expect(unwrapDownload(new Uint8Array([]))).toBeNull();
  });

  test("a wrapped payload still decrypts end to end", () => {
    // Rebuilt in this realm: jsdom's TextEncoder returns a Uint8Array whose
    // constructor differs from the one the cipher produces, and toEqual
    // compares constructors.
    const plaintext = Uint8Array.from(new TextEncoder().encode("hello"));
    const media = encryptMedia(plaintext);
    const roundTripped = unwrapDownload(wrapForUpload(media.ciphertext));
    if (!roundTripped) throw new Error("header did not survive");
    expect(decryptMedia(roundTripped, media.key, media.nonce)).toEqual(
      plaintext,
    );
  });

  test("the upload name carries the ciphertext extension", () => {
    expect(ciphertextFileName().endsWith(CIPHERTEXT_EXTENSION)).toBe(true);
  });
});

// A descriptor is peer-authored, so its claimed size is refused before any
// request goes out and the delivered body is refused before it is buffered.
describe("inbound size limit", () => {
  const descriptor = {
    url: "https://host/x.obb",
    k: "",
    n: "",
    mime: "image/png",
    name: "x.png",
    size: MAX_ENCRYPTABLE_BYTES + 1,
  };

  test("an oversized claim never reaches the network", async () => {
    let fetched = false;
    vi.stubGlobal("fetch", async () => {
      fetched = true;
      return new Response(new Uint8Array());
    });
    await expect(fetchDecryptedMedia(descriptor)).rejects.toThrow();
    expect(fetched).toBe(false);
    vi.unstubAllGlobals();
  });

  test("a body larger than the limit is refused", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(new Uint8Array(64), {
          headers: { "content-length": String(MAX_ENCRYPTABLE_BYTES * 2) },
        }),
    );
    await expect(
      fetchDecryptedMedia({ ...descriptor, size: 10 }),
    ).rejects.toThrow();
    vi.unstubAllGlobals();
  });
});

// A file the host lost and a file the host rewrote are different answers to the
// user: one is routine, the other says the bytes were interfered with.
describe("why an attachment did not open", () => {
  function storedDescriptor() {
    const media = encryptMedia(new TextEncoder().encode("hello"));
    return {
      descriptor: buildMediaDescriptor("https://host/x.obb", media, file),
      stored: wrapForUpload(media.ciphertext),
    };
  }

  test("a host that no longer holds the object reports it unavailable", async () => {
    const { descriptor } = storedDescriptor();
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
    await expect(fetchDecryptedMedia(descriptor)).rejects.toThrow(
      expect.objectContaining({ reason: "unavailable" }),
    );
    vi.unstubAllGlobals();
  });

  test("bytes the host rewrote report as tampering", async () => {
    const { descriptor, stored } = storedDescriptor();
    stored[stored.length - 1] ^= 0xff;
    vi.stubGlobal("fetch", async () => new Response(stored));
    const error = await fetchDecryptedMedia(descriptor).catch((e) => e);
    expect(error).toBeInstanceOf(MediaFetchError);
    expect(error.reason).toBe("tampered");
    vi.unstubAllGlobals();
  });

  test("an object without the header reports as tampering", async () => {
    const { descriptor } = storedDescriptor();
    vi.stubGlobal("fetch", async () => new Response(new Uint8Array(32)));
    await expect(fetchDecryptedMedia(descriptor)).rejects.toThrow(
      expect.objectContaining({ reason: "tampered" }),
    );
    vi.unstubAllGlobals();
  });
});

// The filehost validates this header before storing the object, so the two
// implementations have to agree byte for byte or every upload is rejected.
test("the upload header is the agreed OBBYE2EE magic", () => {
  const stored = wrapForUpload(new Uint8Array([1, 2, 3]));
  const header = Array.from(stored.slice(0, 9));
  expect(header).toEqual([
    ...Array.from("OBBYE2EE", (c) => c.charCodeAt(0)),
    1,
  ]);
  expect(CIPHERTEXT_EXTENSION).toBe(".obb");
});

// A blob URL inherits the app's origin, so a peer-chosen type a browser renders
// as a document would be script running with our localStorage, where the E2EE
// identity and pins live.
describe("blob typing refuses anything but real media", () => {
  test("media types are kept, so previews still render", () => {
    expect(renderableMime("image/png")).toBe("image/png");
    expect(renderableMime("video/mp4")).toBe("video/mp4");
    expect(renderableMime("audio/ogg")).toBe("audio/ogg");
  });

  test("a document type is handed over as bytes", () => {
    for (const mime of [
      "text/html",
      "application/xhtml+xml",
      "application/pdf",
      "",
    ]) {
      expect(renderableMime(mime)).toBe("application/octet-stream");
    }
  });

  test("svg is refused, matching the shared media probe", () => {
    expect(renderableMime("image/svg+xml")).toBe("application/octet-stream");
  });
});
