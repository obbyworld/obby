import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { MediaErrorBoundary } from "../../src/components/MediaErrorBoundary";

function Throws(): React.ReactNode {
  throw new Error("Failed to fetch dynamically imported module");
}

describe("MediaErrorBoundary", () => {
  test("a throwing player is reported and rendered as nothing", () => {
    const onError = vi.fn();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { container } = render(
      <MediaErrorBoundary onError={onError}>
        <Throws />
      </MediaErrorBoundary>,
    );

    expect(onError).toHaveBeenCalled();
    expect(container.textContent).toBe("");
    consoleError.mockRestore();
  });

  test("a working player renders and reports nothing", () => {
    const onError = vi.fn();
    const { getByText } = render(
      <MediaErrorBoundary onError={onError}>
        <span>player</span>
      </MediaErrorBoundary>,
    );

    expect(getByText("player")).toBeTruthy();
    expect(onError).not.toHaveBeenCalled();
  });
});
