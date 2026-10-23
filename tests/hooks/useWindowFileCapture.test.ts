import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWindowFileCapture } from "../../src/hooks/useWindowFileCapture";

function pasteEvent(files: File[]): ClipboardEvent {
  const event = new Event("paste", {
    bubbles: true,
    cancelable: true,
  }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", { value: { files } });
  return event;
}

function dropEvent(type: string, files: File[]): DragEvent {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
  }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", {
    value: { files, types: ["Files"] },
    writable: true,
  });
  return event;
}

const png = () => new File(["x"], "a.png", { type: "image/png" });

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useWindowFileCapture", () => {
  it("takes a file pasted with nothing focused", () => {
    const onFiles = vi.fn();
    renderHook(() => useWindowFileCapture({ enabled: true, onFiles }));

    document.dispatchEvent(pasteEvent([png()]));

    expect(onFiles).toHaveBeenCalledTimes(1);
  });

  // Paste has to keep working everywhere else in the app, so anywhere someone
  // is typing the paste stays theirs.
  it("leaves a paste alone while a field has focus", () => {
    const onFiles = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    renderHook(() => useWindowFileCapture({ enabled: true, onFiles }));

    document.dispatchEvent(pasteEvent([png()]));

    expect(onFiles).not.toHaveBeenCalled();
  });

  it("leaves a paste alone while a dialog is up", () => {
    const onFiles = vi.fn();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    renderHook(() => useWindowFileCapture({ enabled: true, onFiles }));

    document.dispatchEvent(pasteEvent([png()]));
    window.dispatchEvent(dropEvent("drop", [png()]));

    expect(onFiles).not.toHaveBeenCalled();
  });

  it("ignores a paste that carries no file", () => {
    const onFiles = vi.fn();
    renderHook(() => useWindowFileCapture({ enabled: true, onFiles }));

    const event = pasteEvent([]);
    document.dispatchEvent(event);

    expect(onFiles).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("takes a file dropped anywhere in the window", () => {
    const onFiles = vi.fn();
    const { result, rerender } = renderHook(() =>
      useWindowFileCapture({ enabled: true, onFiles }),
    );

    window.dispatchEvent(dropEvent("dragenter", [png()]));
    rerender();
    expect(result.current).toBe(true);

    window.dispatchEvent(dropEvent("drop", [png()]));
    rerender();
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(false);
  });

  it("hears nothing once it is switched off", () => {
    const onFiles = vi.fn();
    renderHook(() => useWindowFileCapture({ enabled: false, onFiles }));

    document.dispatchEvent(pasteEvent([png()]));
    window.dispatchEvent(dropEvent("drop", [png()]));

    expect(onFiles).not.toHaveBeenCalled();
  });
});
