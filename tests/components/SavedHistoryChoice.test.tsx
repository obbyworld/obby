import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SavedHistoryChoice } from "../../src/components/ui/SavedHistoryChoice";
import { hasSavedHistory } from "../../src/store/handlers/history";

vi.mock("../../src/store/handlers/history", () => ({
  hasSavedHistory: vi.fn(),
}));

const renderChoice = (serverIds: string[]) =>
  render(
    <SavedHistoryChoice
      serverIds={serverIds}
      shouldDelete={false}
      onChange={() => {}}
    />,
  );

describe("SavedHistoryChoice", () => {
  it("stays hidden when no server has saved history", async () => {
    vi.mocked(hasSavedHistory).mockResolvedValue(false);
    renderChoice(["a", "b"]);

    await waitFor(() => expect(hasSavedHistory).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shows the choice when any server has saved history", async () => {
    vi.mocked(hasSavedHistory).mockImplementation(async (id) => id === "b");
    renderChoice(["a", "b"]);

    expect(await screen.findByRole("checkbox")).not.toBeChecked();
  });
});
