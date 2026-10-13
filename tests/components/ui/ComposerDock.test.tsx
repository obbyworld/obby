import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  ComposerDock,
  type UploadJob,
} from "../../../src/components/ui/ComposerDock";

const mockState = {
  ui: {
    activeMedia: null as { type: string; url: string } | null,
    openedMedia: null,
  },
  aiWorkflows: {} as Record<string, Record<string, unknown>>,
  aiWorkflowReopen: vi.fn(),
};

vi.mock("../../../src/store", () => ({
  default: Object.assign(
    vi.fn((selector: (state: unknown) => unknown) => selector(mockState)),
    { getState: () => mockState },
  ),
}));

const job = (id: string, name: string, loaded: number): UploadJob => ({
  id,
  file: new File(["x"], name),
  loaded,
  total: 1000,
  status: "uploading",
});

const workflow = (id: string, channel: string) => ({
  id,
  serverId: "s1",
  channel,
  senderNick: "helperbot",
  name: "Research",
  state: "running",
  startedAt: Date.now(),
  updatedAt: Date.now(),
  steps: [],
  collapsed: true,
  dismissed: false,
  historical: false,
});

beforeEach(() => {
  mockState.ui.activeMedia = null;
  mockState.aiWorkflows = {};
  mockState.aiWorkflowReopen.mockReset();
});

describe("ComposerDock", () => {
  test("renders nothing without activities", () => {
    const { container } = render(
      <ComposerDock jobs={[]} onCancel={vi.fn()} serverId="s1" channel="#a" />,
    );
    expect(container.firstChild).toBeNull();
  });

  test("summarizes uploads in one row and expands to one row per file", () => {
    render(
      <ComposerDock
        jobs={[job("1", "one.png", 200), job("2", "two.png", 300)]}
        onCancel={vi.fn()}
        serverId="s1"
        channel="#a"
      />,
    );
    expect(screen.getByText(/Uploading # files/)).toBeTruthy();
    expect(screen.queryByText("one.png")).toBeNull();

    fireEvent.click(screen.getByText(/Uploading # files/));

    expect(screen.getByText("one.png")).toBeTruthy();
    expect(screen.getByText("two.png")).toBeTruthy();
  });

  test("cancels one upload or all of them", () => {
    const onCancel = vi.fn();
    render(
      <ComposerDock
        jobs={[job("1", "one.png", 200), job("2", "two.png", 300)]}
        onCancel={onCancel}
        serverId="s1"
        channel="#a"
      />,
    );
    fireEvent.click(screen.getByLabelText("Cancel all uploads"));
    expect(onCancel.mock.calls).toEqual([["1"], ["2"]]);

    onCancel.mockReset();
    fireEvent.click(screen.getByText(/Uploading # files/));
    fireEvent.click(screen.getAllByLabelText("Cancel upload")[1]);
    expect(onCancel).toHaveBeenCalledWith("2");
  });

  test("shows a running workflow of the current channel only and opens it", () => {
    mockState.aiWorkflows = {
      s1: { w1: workflow("w1", "#a"), w2: workflow("w2", "#b") },
    };
    render(
      <ComposerDock jobs={[]} onCancel={vi.fn()} serverId="s1" channel="#a" />,
    );
    const rows = screen.getAllByText("helperbot");
    expect(rows).toHaveLength(1);

    fireEvent.click(rows[0]);
    expect(mockState.aiWorkflowReopen).toHaveBeenCalledWith("s1", "w1");
  });

  test("collapses more than three rows behind a toggle", () => {
    mockState.aiWorkflows = {
      s1: {
        w1: workflow("w1", "#a"),
        w2: workflow("w2", "#a"),
        w3: workflow("w3", "#a"),
        w4: workflow("w4", "#a"),
      },
    };
    render(
      <ComposerDock jobs={[]} onCancel={vi.fn()} serverId="s1" channel="#a" />,
    );
    expect(screen.getAllByText("helperbot")).toHaveLength(2);

    fireEvent.click(screen.getByText("Show 2 more"));
    expect(screen.getAllByText("helperbot")).toHaveLength(4);
  });
});
