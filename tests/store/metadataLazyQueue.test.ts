import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  _peekMetadataLazyQueue,
  _resetMetadataLazyQueue,
  enqueueMetadataList,
} from "../../src/store/metadataLazyQueue";

function makeMockClient() {
  return {
    metadataList: vi.fn(),
  } as unknown as Parameters<typeof enqueueMetadataList>[0];
}

describe("metadataLazyQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetMetadataLazyQueue();
  });

  afterEach(() => {
    _resetMetadataLazyQueue();
    vi.useRealTimers();
  });

  test("drips one METADATA LIST per interval, in order", () => {
    const client = makeMockClient();
    enqueueMetadataList(client, "s1", "alice");
    enqueueMetadataList(client, "s1", "bob");
    enqueueMetadataList(client, "s1", "carol");

    expect(client.metadataList).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(client.metadataList).toHaveBeenCalledTimes(1);
    expect(client.metadataList).toHaveBeenLastCalledWith("s1", "alice");

    vi.advanceTimersByTime(200);
    expect(client.metadataList).toHaveBeenCalledTimes(2);
    expect(client.metadataList).toHaveBeenLastCalledWith("s1", "bob");

    vi.advanceTimersByTime(200);
    expect(client.metadataList).toHaveBeenCalledTimes(3);
    expect(client.metadataList).toHaveBeenLastCalledWith("s1", "carol");
  });

  test("coalesces duplicate (serverId,target) pairs already in the queue", () => {
    const client = makeMockClient();
    enqueueMetadataList(client, "s1", "alice");
    enqueueMetadataList(client, "s1", "alice");
    enqueueMetadataList(client, "s1", "alice");

    expect(_peekMetadataLazyQueue()).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(client.metadataList).toHaveBeenCalledTimes(1);
  });

  test("same target on different servers is not coalesced", () => {
    const client = makeMockClient();
    enqueueMetadataList(client, "s1", "alice");
    enqueueMetadataList(client, "s2", "alice");
    expect(_peekMetadataLazyQueue()).toHaveLength(2);
    vi.advanceTimersByTime(200);
    vi.advanceTimersByTime(200);
    expect(client.metadataList).toHaveBeenCalledTimes(2);
    expect(client.metadataList).toHaveBeenNthCalledWith(1, "s1", "alice");
    expect(client.metadataList).toHaveBeenNthCalledWith(2, "s2", "alice");
  });

  test("idles when the queue empties and resumes on next enqueue", () => {
    const client = makeMockClient();
    enqueueMetadataList(client, "s1", "alice");
    vi.advanceTimersByTime(200);
    expect(client.metadataList).toHaveBeenCalledTimes(1);

    // Queue is now empty and the timer should be cleared. Advance many
    // intervals — nothing should happen until we enqueue again.
    vi.advanceTimersByTime(10_000);
    expect(client.metadataList).toHaveBeenCalledTimes(1);

    enqueueMetadataList(client, "s1", "bob");
    vi.advanceTimersByTime(200);
    expect(client.metadataList).toHaveBeenCalledTimes(2);
    expect(client.metadataList).toHaveBeenLastCalledWith("s1", "bob");
  });
});
