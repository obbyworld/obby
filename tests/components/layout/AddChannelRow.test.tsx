import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AddChannelRow } from "../../../src/components/layout/AddChannelRow";

function openRow(canAddLive: boolean, onAdd = vi.fn()) {
  render(<AddChannelRow canAddLive={canAddLive} onAdd={onAdd} />);
  fireEvent.click(screen.getByRole("button", { name: /add channel/i }));
  return onAdd;
}

function typeAndSubmit(label: string, value: string, secondLabel = label) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const input = screen.getByLabelText(secondLabel);
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("AddChannelRow", () => {
  it("only renders the kind picker button when canAddLive is true", () => {
    render(<AddChannelRow canAddLive={true} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add channel/i }));
    expect(
      screen.getByRole("button", { name: "Pick channel kind" }),
    ).toBeInTheDocument();
  });

  it("does not render the kind picker button when canAddLive is false", () => {
    render(<AddChannelRow canAddLive={false} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add channel/i }));
    expect(
      screen.queryByRole("button", { name: "Pick channel kind" }),
    ).not.toBeInTheDocument();
  });

  it("picking voice from the kind menu changes the input and submits a ^-prefixed name", () => {
    const onAdd = vi.fn();
    render(<AddChannelRow canAddLive={true} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: /add channel/i }));
    fireEvent.click(screen.getByRole("button", { name: "Pick channel kind" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Voice channel" }));

    const input = screen.getByLabelText("Voice channel");
    fireEvent.change(input, { target: { value: "lobby" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAdd).toHaveBeenCalledWith("^lobby");
    expect(screen.queryByLabelText("Voice channel")).not.toBeInTheDocument();
  });

  it("submits the prefixed name on Enter and closes", () => {
    const onAdd = vi.fn();
    render(<AddChannelRow canAddLive={true} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: /add channel/i }));

    const input = screen.getByLabelText("Text channel");
    fireEvent.change(input, { target: { value: "general" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAdd).toHaveBeenCalledWith("#general");
    expect(screen.queryByLabelText("Text channel")).not.toBeInTheDocument();
  });

  it("closes without submitting on Escape", () => {
    const onAdd = vi.fn();
    render(<AddChannelRow canAddLive={true} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: /add channel/i }));

    const input = screen.getByLabelText("Text channel");
    fireEvent.change(input, { target: { value: "general" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Text channel")).not.toBeInTheDocument();
  });

  it("does not submit an empty name", () => {
    const onAdd = vi.fn();
    render(<AddChannelRow canAddLive={true} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: /add channel/i }));

    const input = screen.getByLabelText("Text channel");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Text channel")).toBeInTheDocument();
  });

  it("switches to voice when the name starts with ^ and keeps only the name", () => {
    openRow(true);
    fireEvent.change(screen.getByLabelText("Text channel"), {
      target: { value: "^" },
    });
    const input = screen.getByLabelText("Voice channel") as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("adds the prefix that was typed first", () => {
    const onAdd = openRow(true);
    typeAndSubmit("Text channel", "$live", "Stream");
    expect(onAdd).toHaveBeenCalledWith("$live");
  });

  it("keeps a typed & as the prefix", () => {
    const onAdd = openRow(true);
    typeAndSubmit("Text channel", "&local");
    expect(onAdd).toHaveBeenCalledWith("&local");
  });

  it("takes only the first # so ##linux stays intact", () => {
    const onAdd = openRow(true);
    typeAndSubmit("Text channel", "##linux");
    expect(onAdd).toHaveBeenCalledWith("##linux");
  });

  it("adds a plain name as a # channel", () => {
    const onAdd = openRow(true);
    typeAndSubmit("Text channel", "general");
    expect(onAdd).toHaveBeenCalledWith("#general");
  });

  it("leaves a live prefix in the name where live channels are unavailable", () => {
    const onAdd = openRow(false);
    typeAndSubmit("Text channel", "^lobby");
    expect(onAdd).toHaveBeenCalledWith("#^lobby");
  });

  it("goes back to # when backspace hits an empty name", () => {
    openRow(true);
    fireEvent.change(screen.getByLabelText("Text channel"), {
      target: { value: "^" },
    });
    fireEvent.keyDown(screen.getByLabelText("Voice channel"), {
      key: "Backspace",
    });
    expect(screen.getByLabelText("Text channel")).toBeInTheDocument();
  });

  it("keeps a second # typed key by key so ##linux works", () => {
    const onAdd = openRow(true);
    const input = screen.getByLabelText("Text channel");
    fireEvent.change(input, { target: { value: "#" } });
    fireEvent.change(input, { target: { value: "#" } });
    fireEvent.change(input, { target: { value: "#linux" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("##linux");
  });

  it("keeps a ^ typed after a # prefix as part of the name", () => {
    const onAdd = openRow(true);
    const input = screen.getByLabelText("Text channel");
    fireEvent.change(input, { target: { value: "#" } });
    fireEvent.change(input, { target: { value: "^" } });
    fireEvent.keyDown(screen.getByLabelText("Text channel"), { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("#^");
  });
});
