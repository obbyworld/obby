import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingDefinition } from "../../../src/lib/settings/types";

vi.mock("../../../src/lib/history/historyDb", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usageBytes: vi.fn(),
  clearHistory: vi.fn(),
}));

vi.mock("../../../src/lib/search/recents", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  clearRecents: vi.fn(),
}));

import { HistoryUsageField } from "../../../src/components/ui/settings/HistoryUsageField";
import { clearHistory, usageBytes } from "../../../src/lib/history/historyDb";
import { clearRecents } from "../../../src/lib/search/recents";
import useStore from "../../../src/store";

const setting = { id: "preferences.historyUsage" } as SettingDefinition;

const renderField = () =>
  render(
    <HistoryUsageField setting={setting} value={null} onChange={vi.fn()} />,
  );

const setKeepHistory = (keepHistory: boolean) =>
  useStore.setState((state) => ({
    globalSettings: { ...state.globalSettings, keepHistory },
  }));

describe("HistoryUsageField", () => {
  beforeEach(() => {
    vi.mocked(usageBytes).mockReset();
    vi.mocked(clearHistory).mockReset();
    setKeepHistory(true);
  });

  it("shows megabytes with one decimal", async () => {
    vi.mocked(usageBytes).mockResolvedValue(12_340_000);
    renderField();
    expect(await screen.findByText("12.3 MB used")).toBeTruthy();
  });

  it("shows kilobytes under 1 MB", async () => {
    vi.mocked(usageBytes).mockResolvedValue(2000);
    renderField();
    expect(await screen.findByText("2.0 KB used")).toBeTruthy();
  });

  it("names the action that starts saving when nothing is saved", async () => {
    vi.mocked(usageBytes).mockResolvedValue(0);
    renderField();
    expect(
      await screen.findByText("Chat to start saving history"),
    ).toBeTruthy();
  });

  it("points at the setting when saving is off and nothing is saved", async () => {
    setKeepHistory(false);
    vi.mocked(usageBytes).mockResolvedValue(0);
    renderField();
    expect(
      await screen.findByText("Turn on Keep chat history to start saving"),
    ).toBeTruthy();
  });

  it("keeps the history when we cancel the confirmation", async () => {
    vi.mocked(usageBytes).mockResolvedValue(5_000_000);
    renderField();
    await screen.findByText("5.0 MB used");

    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    expect(screen.getByText("Clear all saved history?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Clear all saved history?")).toBeNull();
    expect(clearHistory).not.toHaveBeenCalled();
    expect(screen.getByText("5.0 MB used")).toBeTruthy();
  });

  it("clears the history once we confirm, then refreshes usage", async () => {
    vi.mocked(usageBytes)
      .mockResolvedValueOnce(5_000_000)
      .mockResolvedValueOnce(0);
    vi.mocked(clearHistory).mockResolvedValue();
    renderField();
    await screen.findByText("5.0 MB used");

    fireEvent.click(screen.getByRole("button", { name: "Clear history" }));
    expect(clearHistory).not.toHaveBeenCalled();
    const [, confirm] = screen.getAllByRole("button", {
      name: "Clear history",
    });
    fireEvent.click(confirm);

    await waitFor(() => expect(clearHistory).toHaveBeenCalledTimes(1));
    expect(clearRecents).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText("Chat to start saving history"),
    ).toBeTruthy();
    expect(screen.queryByText("Clear all saved history?")).toBeNull();
  });
});
