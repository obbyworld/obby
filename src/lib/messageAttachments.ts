import type { Message } from "../types";
import {
  decodeMediaDescriptor,
  type MediaDescriptor,
  sanitizeFileName,
} from "./e2ee/media";
import { E2EE_MEDIA_TAG } from "./e2ee/messageFlags";
import {
  detectMediaType,
  extractMediaFromMessage,
  filenameFromUrl,
  type MediaType,
} from "./mediaUtils";

export type AttachmentKind = "image" | "video" | "audio" | "pdf" | "file";

export interface AttachmentSummary {
  kind: AttachmentKind;
  /** What to call the file in a compact place, such as a reply preview. */
  name: string;
  /** True when the bytes on the filehost are ciphertext. */
  encrypted: boolean;
  /** Readable straight from the DOM. Absent for an encrypted attachment,
   * whose bytes have to be fetched and decrypted before anything can show. */
  thumbnailUrl?: string;
}

const MIME_KINDS: [prefix: string, kind: AttachmentKind][] = [
  ["image/", "image"],
  ["video/", "video"],
  ["audio/", "audio"],
];

function kindFromMime(mime: string): AttachmentKind {
  if (mime === "application/pdf") return "pdf";
  for (const [prefix, kind] of MIME_KINDS) {
    if (mime.startsWith(prefix)) return kind;
  }
  return "file";
}

function kindFromMediaType(type: MediaType | null): AttachmentKind | null {
  switch (type) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "pdf":
      return "pdf";
    default:
      // `embed` is a link to somebody else's player, and `null` is a URL whose
      // type is still unknown. Neither is an attachment of ours.
      return null;
  }
}

/** The encrypted attachment a message carries, or null. Callers that need the
 * bytes want this; callers that only describe the file want
 * `describeAttachment`. */
export function encryptedDescriptor(message: Message): MediaDescriptor | null {
  const tag = message.tags?.[E2EE_MEDIA_TAG];
  return tag ? decodeMediaDescriptor(tag) : null;
}

/** The media element an attachment kind renders into, or null when the app has
 * nothing to display it with. */
export function kindMediaType(kind: AttachmentKind): MediaType | null {
  return kind === "file" ? null : kind;
}

/** The links in the body that are files we can show. `entry.type` is set only
 * for a trusted embed domain; a file is typed by its extension. Deliberately no
 * HEAD probe: a badge is not worth a request to a host the reader may not have
 * trusted. */
function attachmentLinks(
  message: Message,
): { url: string; kind: AttachmentKind }[] {
  const links: { url: string; kind: AttachmentKind }[] = [];
  for (const entry of extractMediaFromMessage(message)) {
    const kind = kindFromMediaType(entry.type ?? detectMediaType(entry.url));
    if (kind) links.push({ url: entry.url, kind });
  }
  return links;
}

/** The message body with the links to its own attachments taken out, for a
 *  compact preview that names the file separately. Repeating the raw link
 *  there costs a line and tells the reader nothing they cannot see. A link to
 *  somebody's page stays, because that one is the message. */
export function bodyWithoutAttachmentLinks(message: Message): string {
  let text = message.content;
  for (const { url } of attachmentLinks(message)) {
    text = text.split(url).join(" ");
  }
  return text.replace(/\s+/g, " ").trim();
}

/** What a message carries as an attachment, whichever way it got there. The two
 * sources are a plain URL in the body and an encrypted descriptor on a tag, and
 * everything downstream reads this shape rather than either of them, so a
 * reply preview and a message row cannot disagree about what a message holds.
 *
 * Returns null when the message carries no attachment. */
export function describeAttachment(message: Message): AttachmentSummary | null {
  {
    const descriptor = encryptedDescriptor(message);
    if (descriptor) {
      return {
        kind: kindFromMime(descriptor.mime),
        // A peer chooses this name and it is about to be shown as ours, so
        // control and bidi characters come out first.
        name: sanitizeFileName(descriptor.name),
        encrypted: true,
      };
    }
  }

  const [first] = attachmentLinks(message);
  if (!first) return null;
  return {
    kind: first.kind,
    name: filenameFromUrl(first.url) || first.url,
    encrypted: false,
    thumbnailUrl: first.kind === "image" ? first.url : undefined,
  };
}
