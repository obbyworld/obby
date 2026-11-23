function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    /^127\.\d+\.\d+\.\d+$/.test(hostname)
  );
}

export function isSafeServiceUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return true;
  // We allow http on loopback so a local dev stack can serve uploads.
  return url.protocol === "http:" && isLoopbackHost(url.hostname);
}
