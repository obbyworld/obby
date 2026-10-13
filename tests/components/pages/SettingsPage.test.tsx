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

  it("does not resend a saved field when another field changes", () => {
    vi.useFakeTimers();
    render(<SettingsPage page={{ kind: "settings" }} />);

    const nickname = screen.getByDisplayValue("tester");
    fireEvent.change(nickname, { target: { value: "newnick" } });
    fireEvent.blur(nickname);
    act(() => {
      vi.runAllTimers();
    });

    const realname = screen.getByDisplayValue("Tester");
    fireEvent.change(realname, { target: { value: "New Name" } });
    fireEvent.blur(realname);
    act(() => {
      vi.runAllTimers();
    });

    expect(state.current.changeNick).toHaveBeenCalledTimes(1);
    expect(state.current.setName).toHaveBeenCalledWith("server1", "New Name");
    vi.useRealTimers();
  });

  it("keeps a sent value on screen until the server echoes it", () => {
    vi.useFakeTimers();
    render(<SettingsPage page={{ kind: "settings" }} />);

    const nickname = screen.getByDisplayValue("tester");
    fireEvent.change(nickname, { target: { value: "newnick" } });
    fireEvent.blur(nickname);
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByDisplayValue("newnick")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("drops the profile draft when the selected server changes", () => {
    vi.useFakeTimers();
    state.current.servers = [
      { id: "server1", name: "One", channels: [], privateChats: [] },
      { id: "server2", name: "Two", channels: [], privateChats: [] },
    ];
    const { rerender } = render(<SettingsPage page={{ kind: "settings" }} />);

    const nickname = screen.getByDisplayValue("tester");
    fireEvent.change(nickname, { target: { value: "newnick" } });
    fireEvent.blur(nickname);

    state.current = {
      ...state.current,
      ui: { ...(state.current.ui as object), selectedServerId: "server2" },
    };
    rerender(<SettingsPage page={{ kind: "settings" }} />);
    act(() => {
      vi.runAllTimers();
    });

    expect(screen.getByDisplayValue("tester")).toBeTruthy();
    expect(state.current.changeNick).toHaveBeenCalledTimes(1);
    expect(state.current.changeNick).toHaveBeenCalledWith("server1", "newnick");
    vi.useRealTimers();
  });

  it("sends a typed color only once it is complete", () => {
    vi.useFakeTimers();
    render(<SettingsPage page={{ kind: "settings" }} />);

    const color = screen.getByPlaceholderText("#000000");
    fireEvent.change(color, { target: { value: "#12" } });
    act(() => {
      vi.runAllTimers();
    });
    expect(state.current.sendRaw).not.toHaveBeenCalled();

    fireEvent.change(color, { target: { value: "#123456" } });
    act(() => {
      vi.runAllTimers();
    });
    expect(state.current.sendRaw).toHaveBeenCalledTimes(1);
    expect(state.current.sendRaw).toHaveBeenCalledWith(
      "server1",
      "METADATA * SET color :#123456",
    );
    vi.useRealTimers();
  });
});
