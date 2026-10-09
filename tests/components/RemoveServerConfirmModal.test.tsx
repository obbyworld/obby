import {
  fireEvent,
  type RenderResult,
  render,
  screen,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RemoveServerConfirmModal } from "../../src/components/ui/RemoveServerConfirmModal";

const confirmRemoveServer = vi.fn();
const cancelRemoveServer = vi.fn();

const state = {
  servers: [{ id: "srv", name: "TestNet" }],
  ui: { removeServerConfirmTarget: "srv" as string | null },
  confirmRemoveServer,
  cancelRemoveServer,
};

vi.mock("../../src/store", () => ({
  default: (selector: (s: typeof state) => unknown) => selector(state),
}));

vi.mock("../../src/store/handlers/history", () => ({
  hasSavedHistory: vi.fn(async () => true),
}));

describe("RemoveServerConfirmModal", () => {
  let view: RenderResult;

  beforeEach(() => {
    vi.clearAllMocks();
    state.ui.removeServerConfirmTarget = "srv";
    view = render(<RemoveServerConfirmModal />);
  });

  it("names the server being removed", () => {
    expect(screen.getByText(/TestNet/)).toBeInTheDocument();
  });

  it("leaves the delete-history box unchecked", async () => {
    expect(await screen.findByRole("checkbox")).not.toBeChecked();
  });

  it("disconnects and keeps the history by default", () => {
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(confirmRemoveServer).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("disconnects and deletes the history once the box is ticked", async () => {
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(confirmRemoveServer).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("cancels without confirming", () => {
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(cancelRemoveServer).toHaveBeenCalledOnce();
    expect(confirmRemoveServer).not.toHaveBeenCalled();
  });

  it("unticks the box when the dialog opens again for a new target", async () => {
    fireEvent.click(await screen.findByRole("checkbox"));
    expect(screen.getByRole("checkbox")).toBeChecked();

    state.ui.removeServerConfirmTarget = null;
    view.rerender(<RemoveServerConfirmModal />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    state.ui.removeServerConfirmTarget = "srv";
    view.rerender(<RemoveServerConfirmModal />);

    expect(await screen.findByRole("checkbox")).not.toBeChecked();
  });
});
