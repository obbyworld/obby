import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { GlobalNotifications } from "../../../src/components/ui/GlobalNotifications";
import useStore from "../../../src/store";

describe("GlobalNotifications", () => {
  test("dismisses the toast on click", () => {
    useStore.setState({
      globalNotifications: [
        {
          id: "n1",
          type: "fail",
          command: "RECORD SCREEN",
          code: "RECORDING_FAILED",
          message: "The recording could not be made.",
          serverId: "s1",
          timestamp: new Date(),
        },
      ],
    });
    render(<GlobalNotifications />);
    fireEvent.click(screen.getByText("The recording could not be made."));
    expect(useStore.getState().globalNotifications).toHaveLength(0);
  });
});
