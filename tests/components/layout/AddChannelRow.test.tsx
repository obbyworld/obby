import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AddChannelRow,
  toChannelName,
} from "../../../src/components/layout/AddChannelRow";

describe("toChannelName", () => {
  it("prefixes a plain name for text channels with #", () => {
    expect(toChannelName("text", "general")).toBe("#general");
  });

  it("keeps a typed & for text channels", () => {
    expect(toChannelName("text", "&general")).toBe("&general");
  });

  it("keeps a typed # for text channels", () => {
    expect(toChannelName("text", "#general")).toBe("#general");
  });

  it("prefixes voice channels with ^", () => {
    expect(toChannelName("voice", "lobby")).toBe("^lobby");
  });

  it("keeps an already-prefixed voice name", () => {
    expect(toChannelName("voice", "^lobby")).toBe("^lobby");
  });

  it("prefixes stream channels with $", () => {
    expect(toChannelName("stream", "live")).toBe("$live");
  });
});

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
});
