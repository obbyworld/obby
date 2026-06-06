/** deleteServer must key on the unique server id, not host:port. */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import ircClient from "../../src/lib/ircClient";
import useStore, { type AppState } from "../../src/store";

const PARENT_ID = "p-1";
const CHILD_A = "c-libera";
const CHILD_B = "c-oftc";

const HOST = "wss://soju.example";
const PORT = 6697;

const lsBacking = new Map<string, string>();
function installLocalStorageBacking() {
  lsBacking.clear();
  vi.mocked(window.localStorage.getItem).mockImplementation(
    (k: string) => lsBacking.get(k) ?? null,
  );
  vi.mocked(window.localStorage.setItem).mockImplementation(
    (k: string, v: string) => {
      lsBacking.set(k, v);
    },
  );
  vi.mocked(window.localStorage.removeItem).mockImplementation((k: string) => {
    lsBacking.delete(k);
  });
}

function seedBouncerTree() {
  installLocalStorageBacking();
  const stored = [
    {
      id: PARENT_ID,
      name: "soju",
      host: HOST,
      port: PORT,
      nickname: "alice",
      saslEnabled: true,
      saslAccountName: "alice",
      saslPassword: "secret",
      channels: [],
      isBouncerControl: true,
    },
    {
      id: CHILD_A,
      name: "Libera",
      host: HOST,
      port: PORT,
      nickname: "alice",
      saslEnabled: true,
      saslAccountName: "alice",
      saslPassword: "secret",
      channels: [],
      bouncerServerId: PARENT_ID,
      bouncerNetid: "42",
    },
    {
      id: CHILD_B,
      name: "OFTC",
      host: HOST,
      port: PORT,
      nickname: "alice",
      saslEnabled: true,
      saslAccountName: "alice",
      saslPassword: "secret",
      channels: [],
      bouncerServerId: PARENT_ID,
      bouncerNetid: "43",
    },
  ];
  lsBacking.set("savedServers", JSON.stringify(stored));
  useStore.setState({
    servers: stored.map((s) => ({
      id: s.id,
      name: s.name,
      host: s.host,
      port: s.port,
      channels: [],
      privateChats: [],
      isConnected: true,
      connectionState: "connected" as const,
      users: [],
      bouncerServerId: s.bouncerServerId,
      bouncerNetid: s.bouncerNetid,
      isBouncerControl: s.isBouncerControl,
    })),
  } as unknown as Partial<AppState>);
}

describe("deleteServer keys on id, not host:port", () => {
  beforeEach(() => {
    seedBouncerTree();
    vi.spyOn(ircClient, "removeServer").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    lsBacking.clear();
    useStore.setState({ servers: [] } as Partial<AppState>);
  });

  test("deleting one bouncer child leaves parent and sibling in localStorage", () => {
    useStore.getState().deleteServer(CHILD_A);

    const stored = JSON.parse(lsBacking.get("savedServers") ?? "[]");
    const ids = stored.map((s: { id: string }) => s.id).sort();
    expect(ids).toEqual([CHILD_B, PARENT_ID].sort());
  });

  test("deleting the parent leaves the children alone", () => {
    useStore.getState().deleteServer(PARENT_ID);

    const stored = JSON.parse(lsBacking.get("savedServers") ?? "[]");
    const ids = stored.map((s: { id: string }) => s.id).sort();
    expect(ids).toEqual([CHILD_A, CHILD_B].sort());
  });

  test("deleting a standalone server (no siblings) still works", () => {
    // Replace the seed with a single non-bouncer server so we know the
    // id-keyed filter handles the simple case identically.
    lsBacking.set(
      "savedServers",
      JSON.stringify([
        {
          id: "solo-1",
          name: "solo",
          host: "wss://other.example",
          port: 443,
          nickname: "bob",
          channels: [],
        },
      ]),
    );
    useStore.setState({
      servers: [
        {
          id: "solo-1",
          name: "solo",
          host: "wss://other.example",
          port: 443,
          channels: [],
          privateChats: [],
          isConnected: true,
          connectionState: "connected" as const,
          users: [],
        },
      ],
    } as unknown as Partial<AppState>);

    useStore.getState().deleteServer("solo-1");

    const stored = JSON.parse(lsBacking.get("savedServers") ?? "[]");
    expect(stored).toEqual([]);
  });
});
