// XHR-based file uploader with progress reporting.
//
// fetch() doesn't expose upload-side progress events, which is why
// we use XMLHttpRequest here instead -- the UI needs a real progress
// bar while large videos are streaming up.
//
// uploadFile() resolves with the absolute saved URL on success and
// rejects with a `string` describing the failure (string -- not Error
// -- so the UI can show server text verbatim without unwrapping).

export interface UploadInfo {
  max_size: number;
  allowed_extensions: string[];
  scanning_enabled: boolean;
}

let cachedInfo: { url: string; info: UploadInfo } | null = null;

/**
 * Fetch the backend's upload policy.  Cached per filehost URL so
 * mass-uploads don't hit the policy endpoint N times.  Returns null
 * when the backend has no /upload/info (older deployment) -- caller
 * falls back to "anything goes, see what sticks".
 */
export async function fetchUploadInfo(
  filehostUrl: string,
): Promise<UploadInfo | null> {
  if (cachedInfo && cachedInfo.url === filehostUrl) return cachedInfo.info;
  try {
    const res = await fetch(`${filehostUrl}/upload/info`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const info = (await res.json()) as UploadInfo;
    cachedInfo = { url: filehostUrl, info };
    return info;
  } catch {
    return null;
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
        reject(xhr.responseText || `${xhr.status} ${xhr.statusText}`);
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText) as { saved_url?: string };
        if (!body.saved_url) {
          reject("Backend response did not include saved_url");
          return;
        }
        resolve(`${opts.filehostUrl.replace(/\/$/, "")}${body.saved_url}`);
      } catch {
        reject("Backend returned invalid JSON");
      }
    });
    xhr.addEventListener("error", () => reject("Network error during upload"));
    xhr.addEventListener("abort", () => reject("Upload cancelled"));

    if (opts.signal) {
      if (opts.signal.aborted) {
        reject("Upload cancelled");
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
  /** Endpoint from draft/FILEHOST; we POST the file here as-is. */
  endpoint: string;
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
): string | null {
  if (location) return location;
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
        reject(xhr.responseText || `${xhr.status} ${xhr.statusText}`);
        return;
      }
      const url = parseFilehostUploadResponse(
        xhr.getResponseHeader("Location"),
        xhr.responseText || "",
      );
      if (url) {
        resolve(url);
        return;
      }
      reject("Filehost response did not include a URL");
    });
    xhr.addEventListener("error", () => reject("Network error during upload"));
    xhr.addEventListener("abort", () => reject("Upload cancelled"));

    if (opts.signal) {
      if (opts.signal.aborted) {
        reject("Upload cancelled");
        return;
      }
      opts.signal.addEventListener("abort", () => xhr.abort());
    }

    xhr.open("POST", opts.endpoint);
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
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
    return `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB > ${(info.max_size / 1024 / 1024).toFixed(0)} MB).`;
  }
  if (info.allowed_extensions.length > 0) {
    const dot = file.name.lastIndexOf(".");
    const ext = dot === -1 ? "" : file.name.slice(dot).toLowerCase();
    if (!info.allowed_extensions.map((e) => e.toLowerCase()).includes(ext)) {
      return `File type "${ext || "(none)"}" is not allowed.`;
    }
  }
  return null;
}
