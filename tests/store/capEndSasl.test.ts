import { beforeEach, describe, expect, test, vi } from "vitest";

// The handler reads saved servers to decide whether SASL is actually usable.
const savedServers = [{ id: "s1", saslEnabled: true, saslPassword: "hunter2" }];
vi.mock("../../src/store/localStorage", () => ({
  servers: { load: () => savedServers, save: vi.fn() },
  settings: { load: () => ({}), save: vi.fn() },
  channelOrder: { load: () => ({}), save: vi.fn() },
  pinnedPrivateChats: { load: () => ({}), save: vi.fn() },
  bouncerGroupAccents: { load: () => ({}), save: vi.fn() },
  loadUISelections: () => ({}),
  saveUISelections: vi.fn(),
  clearMetadata: vi.fn(),
}));

type CapAckPayload = { serverId: string; cliCaps: string };
let capAckListener: ((p: CapAckPayload) => void) | undefined;

const sendCapEnd = vi.fn();
const userOnConnect = vi.fn();

vi.mock("../../src/lib/ircClient", () => ({
  default: {
    on: (event: string, cb: (p: CapAckPayload) => void) => {
      if (event === "CAP ACK") capAckListener = cb;
    },
    capAck: vi.fn(),
    sendCapEnd,
    userOnConnect,
    capNegotiationComplete: new Map<string, boolean>(),
    sendRaw: vi.fn(),
    isCapNegotiationComplete: () => false,
  },
}));

describe("CAP END is held until SASL resolves", () => {
  beforeEach(async () => {
    vi.resetModules();
    sendCapEnd.mockClear();
    userOnConnect.mockClear();
    capAckListener = undefined;

    const { registerAuthHandlers } = await import(
      "../../src/store/handlers/auth"
    );

    let servers = [{ id: "s1", capabilities: [] as string[] }];
    const store = {
      getState: () => ({
        servers,
        pendingRegistration: null,
        ui: { linkSecurityWarnings: [] },
      }),
      setState: (fn: (s: unknown) => { servers: typeof servers }) => {
        const next = fn({ servers });
        servers = next.servers;
      },
      subscribe: vi.fn(),
      destroy: vi.fn(),
      // biome-ignore lint/suspicious/noExplicitAny: minimal store double
    } as any;

    registerAuthHandlers(store);
  });

  // Replays the h4ks transcript: one CAP REQ answered across two lines, with
  // `sasl` on the first. The second line must not end negotiation.
  test("a second ACK line without sasl does not end negotiation", () => {
    if (!capAckListener) throw new Error("handler did not register");
    capAckListener({ serverId: "s1", cliCaps: "away-notify sasl batch" });
    expect(sendCapEnd).not.toHaveBeenCalled();

    capAckListener({ serverId: "s1", cliCaps: "draft/bot-cmds" });
    expect(sendCapEnd).not.toHaveBeenCalled();
  });

  test("a negotiation with no sasl at all still ends", () => {
    if (!capAckListener) throw new Error("handler did not register");
    capAckListener({ serverId: "s1", cliCaps: "away-notify batch" });
    expect(sendCapEnd).toHaveBeenCalledTimes(1);
  });
});
