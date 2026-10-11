// XHR-based file uploader with progress reporting.
//
// fetch() doesn't expose upload-side progress events, which is why
// we use XMLHttpRequest here instead -- the UI needs a real progress
// bar while large videos are streaming up.
//
// uploadFile() resolves with the absolute saved URL on success and
// rejects with an UploadFailure code that describeUploadFailure() translates.

import { t } from "@lingui/core/macro";

export interface UploadInfo {
  max_size: number;
  allowed_extensions: string[];
  scanning_enabled: boolean;
}

let cachedInfo: { url: string; info: UploadInfo; fetchedAt: number } | null =
  null;

// The policy is a server-side setting that can change under a running tab, and
// a client that caches it for the tab's lifetime keeps refusing uploads the
// server would now accept. Short enough that a deployment is picked up on its
// own, long enough that a batch of files costs one request.
const INFO_TTL_MS = 5 * 60_000;

/**
 * Fetch the backend's upload policy.  Cached per filehost URL so
 * mass-uploads don't hit the policy endpoint N times.  Returns null
 * when the backend has no /upload/info (older deployment) -- caller
 * falls back to "anything goes, see what sticks".
 */
export async function fetchUploadInfo(
  filehostUrl: string,
  options?: { refresh?: boolean },
): Promise<UploadInfo | null> {
  const cached =
    cachedInfo?.url === filehostUrl &&
    Date.now() - cachedInfo.fetchedAt < INFO_TTL_MS;
  if (cached && !options?.refresh && cachedInfo) return cachedInfo.info;
  try {
    const res = await fetch(`${filehostUrl}/upload/info`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const info = (await res.json()) as UploadInfo;
    cachedInfo = { url: filehostUrl, info, fetchedAt: Date.now() };
    return info;
  } catch {
    return null;
  }
}

type UploadFailure =
  | "network"
  | "cancelled"
  | "too-large"
  | "refused"
  | "bad-response";

const failureForStatus = (status: number): UploadFailure =>
  status === 413 ? "too-large" : "refused";

export function describeUploadFailure(failure: unknown): string {
  switch (failure) {
    case "network":
      return t`Could not reach the file host. Check your connection and try again.`;
    case "cancelled":
      return t`Upload cancelled.`;
    case "too-large":
      return t`Choose a smaller file. This one is too large for the file host.`;
    case "refused":
      return t`Choose a different file. The file host refused this one.`;
    case "bad-response":
      return t`Try the upload again. The file host sent back an answer we could not read.`;
    default:
      return t`Try the upload again.`;
  }
}

export interface UploadOptions {
  filehostUrl: string;
  bearerToken: string;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Upload a single file via the backend's POST /upload endpoint.
 * Resolves with the *absolute* URL of the saved file.
 *
 * The "file" form field is the new name; we pass it in addition to
 * "image" for back-compat with older backend deployments that only
 * recognise the legacy field name.
 */
export function uploadFile(file: File, opts: UploadOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `${opts.filehostUrl.replace(/\/$/, "")}/upload`;

    xhr.upload.addEventListener("progress", (e) => {
      if (!e.lengthComputable) return;
      opts.onProgress?.(e.loaded, e.total);
    });

    xhr.addEventListener("load", () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(failureForStatus(xhr.status));
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText) as { saved_url?: string };
        if (!body.saved_url) {
          reject("bad-response");
          return;
        }
        resolve(`${opts.filehostUrl.replace(/\/$/, "")}${body.saved_url}`);
      } catch {
        reject("bad-response");
      }
    });
    xhr.addEventListener("error", () => reject("network"));
    xhr.addEventListener("abort", () => reject("cancelled"));

    if (opts.signal) {
      if (opts.signal.aborted) {
        reject("cancelled");
        return;
      }
      opts.signal.addEventListener("abort", () => xhr.abort());
    }

    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${opts.bearerToken}`);

    const form = new FormData();
    // Send under both "file" (new) and "image" (legacy) so older
    // backends keep working.
    form.append("file", file);
    form.append("image", file);
    xhr.send(form);
  });
}

export interface TokenlessUploadOptions {
  /** Endpoint from draft/FILEHOST or soju.im/FILEHOST. */
  endpoint: string;
  /** soju.im/FILEHOST takes the file as the whole body, draft/FILEHOST a form. */
  rawBody?: boolean;
  authorization?: string;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * Extract the uploaded file's URL from a draft/FILEHOST response. The spec
 * uses the `Location` header (201), but real filehosts vary, so we accept
 * (in order): the Location header, a JSON body with `url`/`saved_url`, or a
 * plain-text URL body. Returns null when none is present.
 */
export function parseFilehostUploadResponse(
  location: string | null,
  body: string,
  endpoint?: string,
): string | null {
  if (location)
    return URL.canParse(location, endpoint)
      ? new URL(location, endpoint).href
      : null;
  const text = body.trim();
  try {
    const parsed = JSON.parse(text) as { url?: string; saved_url?: string };
    const u = parsed.url ?? parsed.saved_url;
    if (u) return u;
  } catch {
    // not JSON -- fall through to plain-text handling
  }
  if (/^https?:\/\/\S+$/.test(text)) return text;
  return null;
}

/**
 * Upload via the standard tokenless IRCv3 draft/FILEHOST flow: POST the
 * file (multipart `file` field) directly to an advertised endpoint, no auth.
 *
 * The spec returns 201 + a `Location` header, but real filehosts vary, so we
 * accept (in order): the `Location` header, a JSON body with `url`/`saved_url`,
 * or a plain-text URL body. Resolves with the file URL.
 *
 * Note: from a browser this only works if the endpoint serves CORS
 * (`Access-Control-Allow-Origin`), and reading a 201 `Location` cross-origin
 * additionally needs `Access-Control-Expose-Headers: Location`. Native clients
 * have no such restriction.
 */
export function uploadFileTokenless(
  file: File,
  opts: TokenlessUploadOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (!e.lengthComputable) return;
      opts.onProgress?.(e.loaded, e.total);
    });

    xhr.addEventListener("load", () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(failureForStatus(xhr.status));
        return;
      }
      const url = parseFilehostUploadResponse(
        xhr.getResponseHeader("Location"),
        xhr.responseText || "",
        opts.endpoint,
      );
      if (url) {
        resolve(url);
        return;
      }
      reject("bad-response");
    });
    xhr.addEventListener("error", () => reject("network"));
    xhr.addEventListener("abort", () => reject("cancelled"));

    if (opts.signal) {
      if (opts.signal.aborted) {
        reject("cancelled");
        return;
      }
      opts.signal.addEventListener("abort", () => xhr.abort());
    }

    xhr.open("POST", opts.endpoint);
    if (opts.authorization)
      xhr.setRequestHeader("Authorization", opts.authorization);
    if (opts.rawBody) {
      xhr.setRequestHeader(
        "Content-Type",
        file.type || "application/octet-stream",
      );
      xhr.setRequestHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      );
      xhr.send(file);
      return;
    }
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

// We log in to soju.im/FILEHOST with the SASL PLAIN credentials, and only over
// https so the password never crosses the network in the clear.
export function filehostBasicAuth(
  endpoint: string,
  account: string | undefined,
  password: string | undefined,
): string | undefined {
  if (!account || !password || !endpoint.startsWith("https://")) return;
  const bytes = new TextEncoder().encode(`${account}:${password}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

/** Byte count at the largest unit that keeps it readable. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Best-effort client-side validation against fetchUploadInfo() output.
 * Returns null when the file is OK; otherwise a human-readable reason
 * suitable for showing in the UI.
 */
export function validateFileAgainstInfo(
  file: File,
  info: UploadInfo | null,
): string | null {
  if (!info) return null;
  if (info.max_size > 0 && file.size > info.max_size) {
    const limit = formatFileSize(info.max_size);
    return t`Choose a file under ${limit}, the most the file host accepts.`;
  }
  if (info.allowed_extensions.length > 0) {
    const dot = file.name.lastIndexOf(".");
    const ext = dot === -1 ? "" : file.name.slice(dot).toLowerCase();
    if (!info.allowed_extensions.map((e) => e.toLowerCase()).includes(ext)) {
      return ext
        ? t`Choose a different file type. The file host does not accept ${ext} files.`
        : t`Choose a file with an extension. The file host does not accept files without one.`;
    }
  }
  return null;
}
