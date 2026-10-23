import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ModerationAction } from "../../src/components/ui/ModerationModal";
import ModerationModal from "../../src/components/ui/ModerationModal";

describe("ModerationModal", () => {
  const mockOnClose = vi.fn();
  const mockOnConfirm = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderModal = (action: ModerationAction = "warn", isOpen = true) => {
    return render(
      <ModerationModal
        isOpen={isOpen}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        username="testuser"
        action={action}
      />,
    );
  };

  test("does not render when isOpen is false", () => {
    renderModal("warn", false);
    expect(screen.queryByText("Warn User")).not.toBeInTheDocument();
  });

  test("renders warn modal correctly", () => {
    renderModal("warn");

    expect(
      screen.getByRole("heading", { name: "Warn User" }),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Send a warning message to testuser"),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("testuser")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Warn User" }),
    ).toBeInTheDocument();

    // Check button color for warn action (should be purple)
    const confirmButton = screen.getByRole("button", { name: "Warn User" });
    expect(confirmButton).toHaveClass("bg-discord-primary");
  });

  test("renders kick modal correctly", () => {
    renderModal("kick");

    expect(
      screen.getByRole("heading", { name: "Kick User" }),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("Remove testuser from the channel"),
    ).toBeInTheDocument();

    // Check button color for kick action (should be red)
    const confirmButton = screen.getByRole("button", { name: "Kick User" });
    expect(confirmButton).toHaveClass("bg-discord-red");
  });

  test("renders ban-nick modal correctly", () => {
    renderModal("ban-nick");

    expect(
      screen.getByRole("heading", { name: "Ban User (by Nickname)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(
        "Ban testuser by nickname (prevents them from rejoining with the same nick)",
      ),
    ).toBeInTheDocument();

    // Check button color for ban action (should be red)
    const confirmButton = screen.getByRole("button", {
      name: "Ban User (by Nickname)",
    });
    expect(confirmButton).toHaveClass("bg-discord-red");
  });

  test("renders ban-hostmask modal correctly", () => {
    renderModal("ban-hostmask");

    expect(
      screen.getByRole("heading", { name: "Ban User (by Hostmask)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(
        "Ban testuser by hostmask (prevents them from rejoining from the same IP/host)",
      ),
    ).toBeInTheDocument();

    // Check button color for ban action (should be red)
    const confirmButton = screen.getByRole("button", {
      name: "Ban User (by Hostmask)",
    });
    expect(confirmButton).toHaveClass("bg-discord-red");
  });

  test("calls onClose when close button is clicked", () => {
    renderModal("warn");

    const closeButton = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  test("calls onClose when cancel button is clicked", () => {
    renderModal("warn");

    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  test("submits form with custom reason", () => {
    renderModal("warn");

    const reasonInput = screen.getByPlaceholderText("Enter reason (optional)");
    fireEvent.change(reasonInput, { target: { value: "Test reason" } });

    const confirmButton = screen.getByRole("button", { name: "Warn User" });
    fireEvent.click(confirmButton);

    expect(mockOnConfirm).toHaveBeenCalledWith("warn", "Test reason");
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  test("submits form with default reason when empty", () => {
    renderModal("kick");

    const confirmButton = screen.getByRole("button", { name: "Kick User" });
    fireEvent.click(confirmButton);

    expect(mockOnConfirm).toHaveBeenCalledWith("kick", "no reason");
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  test("clears reason when modal closes", () => {
    renderModal("warn");

    const reasonInput = screen.getByPlaceholderText("Enter reason (optional)");
    fireEvent.change(reasonInput, { target: { value: "Test reason" } });

    // Close modal
    const closeButton = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);

    // Re-render modal to check if reason is cleared
    renderModal("warn");
    expect(reasonInput).toHaveValue("");
  });

  test("prevents form submission on enter key", () => {
    renderModal("warn");

    const reasonInput = screen.getByPlaceholderText("Enter reason (optional)");
    fireEvent.change(reasonInput, { target: { value: "Test reason" } });

    // Press enter in the input field
    fireEvent.submit(reasonInput);

    expect(mockOnConfirm).toHaveBeenCalledWith("warn", "Test reason");
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  test("username input is disabled", () => {
    renderModal("warn");

    const usernameInput = screen.getByDisplayValue("testuser");
    expect(usernameInput).toBeDisabled();
  });

  test("action description input is disabled", () => {
    renderModal("warn");

    const actionInput = screen.getByDisplayValue(
      "Send a warning message to testuser",
    );
    expect(actionInput).toBeDisabled();
  });
});
