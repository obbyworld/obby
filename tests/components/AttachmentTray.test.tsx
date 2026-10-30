import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AttachmentTray,
  type PendingAttachment,
} from "../../src/components/ui/AttachmentTray";

const saveFileToDevice = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("../../src/lib/saveFile", () => ({ saveFileToDevice }));

afterEach(cleanup);

function file(name: string, type: string): PendingAttachment {
  return {
    id: name,
    kind: "file",
    file: new File(["x"], name, { type }),
    previewUrl: null,
  };
}

describe("AttachmentTray", () => {
  it("stays out of the way while nothing is queued", () => {
    render(<AttachmentTray attachments={[]} onRemove={vi.fn()} />);

    expect(screen.queryByTestId("attachment-tray")).toBeNull();
  });

  // Nothing here has left the device yet, so removing an item is the only undo
  // a person needs before sending.
  it("drops one item without touching the rest", () => {
    const onRemove = vi.fn();
    render(
      <AttachmentTray
        attachments={[
          file("a.png", "image/png"),
          file("b.pdf", "application/pdf"),
        ]}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /remove/i })[0]);

    expect(onRemove).toHaveBeenCalledWith("a.png");
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("saves a queued file without removing it", () => {
    const onRemove = vi.fn();
    const video = file("clip.mp4", "video/mp4");
    render(<AttachmentTray attachments={[video]} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole("button", { name: /save file/i }));

    expect(saveFileToDevice).toHaveBeenCalledWith(
      video.kind === "file" ? video.file : null,
    );
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("drops everything at once", () => {
    const onRemove = vi.fn();
    render(
      <AttachmentTray
        attachments={[
          file("a.png", "image/png"),
          file("b.pdf", "application/pdf"),
        ]}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /remove every attachment/i }),
    );

    expect(onRemove.mock.calls.map(([id]) => id)).toEqual(["a.png", "b.pdf"]);
  });

  it("names a queued link by what it is", () => {
    render(
      <AttachmentTray
        attachments={[
          { id: "pin", kind: "link", url: "https://map/1", label: "Location" },
        ]}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByText("Location")).toBeInTheDocument();
  });
});
