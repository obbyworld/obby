import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "../../../src/components/pages/SettingsPage";

const state = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("../../../src/store", () => {
  const useStore = vi.fn((selector?: (s: unknown) => unknown) =>
    selector ? selector(state.current) : state.current,
  );
  return {
    default: Object.assign(useStore, { setState: vi.fn(), getState: vi.fn() }),
    loadSavedServers: vi.fn(() => [{ id: "server1", operOnConnect: false }]),
    serverSupportsMetadata: vi.fn(() => true),
  };
});

vi.mock("../../../src/lib/ircClient", () => ({
  default: {
    getCurrentUser: vi.fn(() => ({
      username: "tester",
      realname: "Tester",
      metadata: {},
    })),
  },
}));

vi.mock("../../../src/components/ui/AvatarUpload", () => ({
  default: () => null,
}));
vi.mock("../../../src/components/ui/InvitationsPanel", () => ({
  default: () => null,
}));
vi.mock("../../../src/components/ui/PersistenceSettingsPanel", () => ({
  default: () => null,
}));

const makeState = () => ({
  ui: {
    page: null,
    isNarrowView: false,
    selectedServerId: "server1",
    perServerSelections: {},
  },
  servers: [{ id: "server1", name: "Test", channels: [], privateChats: [] }],
  globalSettings: { enableNotificationSounds: true },
  closePage: vi.fn(),
  updateGlobalSettings: vi.fn(),
  updateServer: vi.fn(),
  changeNick: vi.fn(),
  setName: vi.fn(),
  sendRaw: vi.fn(),
  openPage: vi.fn(),
  openProfile: vi.fn(),
});

describe("SettingsPage", () => {
  beforeEach(() => {
    state.current = makeState();
  });

  it("saves a toggle as soon as it is switched", () => {
    render(
      <SettingsPage page={{ kind: "settings", section: "notifications" }} />,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: "Enable Notification Sounds" }),
    );

    expect(state.current.updateGlobalSettings).toHaveBeenCalledWith({
      enableNotificationSounds: false,
    });
  });

  it("sends a profile change shortly after the field is committed", () => {
    vi.useFakeTimers();
    render(<SettingsPage page={{ kind: "settings" }} />);

    const nickname = screen.getByDisplayValue("tester");
    fireEvent.change(nickname, { target: { value: "newnick" } });
    fireEvent.blur(nickname);
    expect(state.current.changeNick).not.toHaveBeenCalled();

    act(() => {
      vi.runAllTimers();
    });
    expect(state.current.changeNick).toHaveBeenCalledWith("server1", "newnick");
    vi.useRealTimers();
  });
});
