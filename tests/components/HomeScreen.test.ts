import { describe, expect, it } from "vitest";

interface DiscoverServer {
  name: string;
  description: string;
  wss?: string;
  ircs?: string;
  obby?: boolean;
}

interface PrefillResult {
  host: string;
  port: string;
  useWebSocket: boolean;
  lockWebSocket: boolean;
}

// Logic mirroring HomeScreen.handleServerClick
function buildPrefill(
  server: DiscoverServer,
  isTauri: boolean,
): PrefillResult | null {
  const hasWss = !!server.wss;
  const hasIrcs = !!server.ircs;

  if (!hasWss && !hasIrcs) return null;
  if (!isTauri && !hasWss) return null; // browser can't connect without wss

  const useWebSocket = isTauri ? !hasIrcs : false;
  // Browser always uses wss (non-wss servers are filtered before this point).
  // Tauri: ircs unless forced to wss.
  const uri = isTauri
    ? useWebSocket
      ? server.wss
      : (server.ircs ?? server.wss)
    : server.wss;
  if (!uri) return null;
  const parsed = new URL(uri);

  return {
    host: uri,
    port: parsed.port || (isTauri ? "6697" : "443"),
    useWebSocket,
    lockWebSocket: isTauri && !(hasWss && hasIrcs),
  };
}

// Logic mirroring HomeScreen filteredServers platform filter
function isVisible(server: DiscoverServer, isTauri: boolean): boolean {
  return isTauri ? !!(server.wss || server.ircs) : !!server.wss;
}

// Mock servers.json examples covering all cases
const bothProtocols: DiscoverServer = {
  name: "h4ks.com",
  description: "Both wss and ircs available",
  wss: "wss://irc.h4ks.com:443",
  ircs: "ircs://irc.h4ks.com:6697",
};

const ircsOnly: DiscoverServer = {
  name: "IRCsOnly Network",
  description: "Raw TCP only, no WebSocket endpoint",
  ircs: "ircs://irc.ircsonly.net:6697",
};

const wssOnly: DiscoverServer = {
  name: "WSSOnly Network",
  description: "WebSocket only, no raw TCP endpoint",
  wss: "wss://irc.wssonly.net:8097",
};

const nonStandardPort: DiscoverServer = {
  name: "InspIRCd Test Network",
  description: "Non-standard ports on both protocols",
  wss: "wss://testnet.inspircd.org:8097",
  ircs: "ircs://testnet.inspircd.org:6697",
};

const noUrls: DiscoverServer = {
  name: "No URLs",
  description: "Missing both protocols",
};

describe("HomeScreen server list filtering", () => {
  const allServers = [
    bothProtocols,
    ircsOnly,
    wssOnly,
    nonStandardPort,
    noUrls,
  ];

  it("browser: shows only servers with wss", () => {
    const visible = allServers.filter((s) => isVisible(s, false));
    expect(visible.map((s) => s.name)).toEqual([
      "h4ks.com",
      "WSSOnly Network",
      "InspIRCd Test Network",
    ]);
  });

  it("browser: hides ircs-only servers (no WebSocket available)", () => {
    expect(isVisible(ircsOnly, false)).toBe(false);
  });

  it("Tauri: shows servers with wss, ircs, or both", () => {
    const visible = allServers.filter((s) => isVisible(s, true));
    expect(visible.map((s) => s.name)).toEqual([
      "h4ks.com",
      "IRCsOnly Network",
      "WSSOnly Network",
      "InspIRCd Test Network",
    ]);
  });

  it("Tauri: hides servers with neither protocol", () => {
    expect(isVisible(noUrls, true)).toBe(false);
  });
});

describe("HomeScreen prefill building — browser (non-Tauri)", () => {
  it("uses wss URL for a server with both protocols", () => {
    const result = buildPrefill(bothProtocols, false);
    expect(result?.host).toBe("wss://irc.h4ks.com:443");
    expect(result?.port).toBe("443");
    expect(result?.useWebSocket).toBe(false); // not used; wss checkbox hidden on web
    expect(result?.lockWebSocket).toBe(false);
  });

  it("uses wss URL for a wss-only server", () => {
    const result = buildPrefill(wssOnly, false);
    expect(result?.host).toBe("wss://irc.wssonly.net:8097");
    expect(result?.port).toBe("8097");
  });

  it("returns null for ircs-only server (not connectable from browser)", () => {
    expect(buildPrefill(ircsOnly, false)).toBeNull();
  });

  it("returns null when no protocols available", () => {
    expect(buildPrefill(noUrls, false)).toBeNull();
  });
});

describe("HomeScreen prefill building — Tauri", () => {
  it("both protocols: defaults to ircs, WSS toggle unlocked", () => {
    const result = buildPrefill(bothProtocols, true);
    expect(result?.host).toBe("ircs://irc.h4ks.com:6697");
    expect(result?.port).toBe("6697");
    expect(result?.useWebSocket).toBe(false);
    expect(result?.lockWebSocket).toBe(false);
  });

  it("ircs-only: uses ircs, WSS toggle locked (off)", () => {
    const result = buildPrefill(ircsOnly, true);
    expect(result?.host).toBe("ircs://irc.ircsonly.net:6697");
    expect(result?.port).toBe("6697");
    expect(result?.useWebSocket).toBe(false);
    expect(result?.lockWebSocket).toBe(true);
  });

  it("wss-only: uses wss, WSS toggle locked (on)", () => {
    const result = buildPrefill(wssOnly, true);
    expect(result?.host).toBe("wss://irc.wssonly.net:8097");
    expect(result?.port).toBe("8097");
    expect(result?.useWebSocket).toBe(true);
    expect(result?.lockWebSocket).toBe(true);
  });

  it("non-standard ports: preserves correct port from URL", () => {
    const result = buildPrefill(nonStandardPort, true);
    expect(result?.host).toBe("ircs://testnet.inspircd.org:6697");
    expect(result?.port).toBe("6697");
    expect(result?.useWebSocket).toBe(false);
    expect(result?.lockWebSocket).toBe(false);
  });

  it("returns null when no protocols available", () => {
    expect(buildPrefill(noUrls, true)).toBeNull();
  });
});

describe("AddServerModal host display (scheme stripped when field is disabled)", () => {
  it("strips wss:// scheme for display", () => {
    const host = "wss://irc.h4ks.com:443";
    expect(new URL(host).hostname).toBe("irc.h4ks.com");
  });

  it("strips ircs:// scheme for display", () => {
    const host = "ircs://testnet.inspircd.org:6697";
    expect(new URL(host).hostname).toBe("testnet.inspircd.org");
  });

  it("leaves plain hostname unchanged", () => {
    const host = "irc.example.com";
    const display = host.includes("://") ? new URL(host).hostname : host;
    expect(display).toBe("irc.example.com");
  });
});
