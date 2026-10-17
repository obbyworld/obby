import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../../src/lib/history/historyDb", () => ({
  clearHistory: vi.fn(),
  usageBytes: vi.fn(),
}));

import { clearHistory } from "../../src/lib/history/historyDb";
import useStore from "../../src/store";

describe("keepHistory setting", () => {
  beforeEach(() => {
    vi.mocked(clearHistory).mockClear();
  });

  test("turning it off keeps saved history", () => {
    useStore.getState().updateGlobalSettings({ keepHistory: false });
    expect(clearHistory).not.toHaveBeenCalled();
    expect(useStore.getState().globalSettings.keepHistory).toBe(false);
  });

  test("other updates leave history alone", () => {
    useStore.getState().updateGlobalSettings({ keepHistory: true });
    useStore.getState().updateGlobalSettings({ historyLimitMb: 250 });
    expect(clearHistory).not.toHaveBeenCalled();
  });
});
