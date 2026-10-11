import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { GlobalNotifications } from "../../../src/components/ui/GlobalNotifications";
import useStore from "../../../src/store";

const toast = (inServerNotices?: boolean) => ({
  id: "n1",
  type: "fail" as const,
  command: "RECORD SCREEN",
  code: "RECORDING_FAILED",
  message: "The recording could not be made.",
  serverId: "s1",
  inServerNotices,
  timestamp: new Date(),
});

describe("GlobalNotifications", () => {
  const selectChannel = vi.fn();

  beforeEach(() => {
    selectChannel.mockClear();
    useStore.setState({
      servers: [{ id: "s1" } as never],
      selectServer: vi.fn(),
      selectChannel,
    });
  });

  test("opens the server notices for a reply filed there", () => {
    useStore.setState({ globalNotifications: [toast(true)] });
    render(<GlobalNotifications />);
    fireEvent.click(screen.getByTitle("See server notices"));
    expect(selectChannel).toHaveBeenCalledWith("server-notices", {
      navigate: true,
    });
  });

  test("only dismisses a problem the app found itself", () => {
    useStore.setState({ globalNotifications: [toast()] });
    render(<GlobalNotifications />);
    expect(screen.queryByTitle("See server notices")).toBeNull();
    fireEvent.click(screen.getByText("The recording could not be made."));
    expect(useStore.getState().globalNotifications).toHaveLength(0);
    expect(selectChannel).not.toHaveBeenCalled();
  });
});
