import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ChannelList } from "../../src/components/layout/ChannelList";
import PluginsScreen from "../../src/components/ui/PluginsScreen";
import useStore from "../../src/store";

describe("Plugins home entry", () => {
  beforeEach(() => {
    useStore.setState((state) => ({
      ui: { ...state.ui, selectedServerId: null, homeView: undefined },
    }));
  });

  it("opens the plugins page from the home sidebar and back to Discover", () => {
    render(<ChannelList />);

    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    expect(useStore.getState().ui.homeView).toBe("plugins");

    fireEvent.click(screen.getByRole("button", { name: "Discover" }));
    expect(useStore.getState().ui.homeView).toBeUndefined();
  });

  it("lists mock plugins that cannot be installed yet and filters them", () => {
    render(<PluginsScreen />);

    const installs = screen.getAllByRole("button", { name: "Install" });
    expect(installs.length).toBeGreaterThan(3);
    for (const install of installs) expect(install).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("Search plugins..."), {
      target: { value: "translate" },
    });
    expect(screen.getAllByRole("button", { name: "Install" })).toHaveLength(1);
  });
});
