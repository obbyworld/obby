import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression test for the WKWebView zero-media-section bug: WebKit never
// implemented createOffer's legacy offerToReceiveAudio/offerToReceiveVideo
// options, so a viewer that adds no local tracks used to produce an offer
// with no m-lines at all, which the SFU rejected with "no ice-ufrag".

type Handler = (payload: unknown) => void;

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, Set<Handler>>();
  return {
    handlers,
    sendRaw: vi.fn(),
    on: vi.fn((event: string, handler: Handler) => {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler);
    }),
    deleteHook: vi.fn((event: string, handler: Handler) => {
      handlers.get(event)?.delete(handler);
    }),
    emit: (event: string, payload: unknown) => {
      for (const h of handlers.get(event) ?? []) h(payload);
    },
  };
});

vi.mock("../../src/lib/ircClient", () => ({
  default: {
    on: mocks.on,
    deleteHook: mocks.deleteHook,
    sendRaw: mocks.sendRaw,
  },
}));

import { VoiceClient } from "../../src/lib/voice";

interface FakeTransceiver {
  kind: string;
  direction: string;
}

class FakePeerConnection {
  transceivers: FakeTransceiver[] = [];
  tracks: { track: MediaStreamTrack; stream: MediaStream }[] = [];
  onicecandidate: ((e: { candidate: RTCIceCandidate | null }) => void) | null =
    null;
  ontrack: ((e: RTCTrackEvent) => void) | null = null;
  createOfferCalls: unknown[] = [];
  localDescription: RTCSessionDescriptionInit | null = null;

  addTransceiver(kind: string, init?: { direction?: string }): void {
    this.transceivers.push({ kind, direction: init?.direction ?? "sendrecv" });
  }

  addTrack(track: MediaStreamTrack, stream: MediaStream): RTCRtpSender {
    this.tracks.push({ track, stream });
    return {} as RTCRtpSender;
  }

  getSenders(): RTCRtpSender[] {
    return [];
  }

  async createOffer(...args: unknown[]): Promise<RTCSessionDescriptionInit> {
    this.createOfferCalls.push(args);
    return { type: "offer", sdp: "v=0\r\no=fake offer\r\n" };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = desc;
  }

  async setRemoteDescription(): Promise<void> {}
  async addIceCandidate(): Promise<void> {}
  async getStats(): Promise<Map<string, unknown>> {
    return new Map();
  }

  close(): void {}
}

let lastPc: FakePeerConnection | undefined;

// Mirrors tests/lib/ircClient.test.ts's MockWebSocket pattern: a plain
// function returning a prebuilt instance, wired in via vi.fn(impl) so it
// still works when the code under test calls `new RTCPeerConnection(...)`.
function FakePeerConnectionCtor(): FakePeerConnection {
  lastPc = new FakePeerConnection();
  return lastPc;
}
vi.stubGlobal(
  "RTCPeerConnection",
  vi.fn(FakePeerConnectionCtor as unknown as () => FakePeerConnection),
);

function fakeAudioTrack(): MediaStreamTrack {
  return {
    id: "mic",
    kind: "audio",
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function fakeStream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    getTracks: () => tracks,
    addTrack: vi.fn(),
    removeTrack: vi.fn(),
  } as unknown as MediaStream;
}

const getUserMedia = vi.fn(async () => fakeStream([fakeAudioTrack()]));

vi.stubGlobal("navigator", {
  mediaDevices: { getUserMedia },
});

function fakeAudioSink(): HTMLAudioElement {
  return {} as unknown as HTMLAudioElement;
}

// Polls on microtask ticks rather than counting exact await chains through
// onSignal -> onJoined -> createOffer/setLocalDescription, which would make
// this test brittle against unrelated changes deeper in that call chain.
async function waitUntil(check: () => boolean, maxTicks = 50): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (check()) return;
    await Promise.resolve();
  }
  throw new Error("condition not met after flushing microtasks");
}

let currentClient: VoiceClient | undefined;

async function joinAs(role: "streamer" | "viewer") {
  const client = new VoiceClient({
    serverId: "s1",
    channel: "$stage",
    selfNick: "me",
    audioSink: fakeAudioSink(),
  });
  currentClient = client;
  client.attach({ onState: () => {}, onError: () => {} });

  const joinPromise = client.join();
  // The client waits for its own JOIN to echo back before signaling the
  // SFU; reproduce that handshake instead of reaching into private state.
  mocks.emit("JOIN", { username: "me", channelName: "$stage" });
  await joinPromise;

  mocks.emit("TAGMSG", {
    serverId: "s1",
    sender: "sfu",
    channelName: "$stage",
    mtags: {
      "+obsidianirc/rtc": JSON.stringify({
        type: "joined",
        mode: "stream",
        role,
        members: ["me"],
        streamers: role === "streamer" ? ["me"] : [],
      }),
    },
  });
  await waitUntil(() => !!lastPc?.createOfferCalls.length);

  const pc = lastPc;
  if (!pc) throw new Error("RTCPeerConnection was never constructed");
  return { client, pc };
}

describe("VoiceClient initial offer (viewer with no local tracks)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    lastPc = undefined;
    currentClient = undefined;
  });

  afterEach(() => {
    currentClient?.leave();
  });

  it("adds recvonly audio and video transceivers before offering, so the offer can't have zero media sections", async () => {
    const { pc } = await joinAs("viewer");

    expect(pc.transceivers).toEqual([
      { kind: "audio", direction: "recvonly" },
      { kind: "video", direction: "recvonly" },
    ]);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(pc.tracks).toEqual([]);
  });

  it("gives a streamer its mic track plus a recvonly video transceiver, with no extra audio transceiver", async () => {
    const { pc } = await joinAs("streamer");

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    expect(pc.tracks).toHaveLength(1);
    expect(pc.tracks[0].track.kind).toBe("audio");
    expect(pc.transceivers).toEqual([{ kind: "video", direction: "recvonly" }]);
  });

  it("calls createOffer with no arguments, never the legacy offerToReceiveAudio/Video options", async () => {
    const { pc } = await joinAs("viewer");

    expect(pc.createOfferCalls).toEqual([[]]);
  });
});
