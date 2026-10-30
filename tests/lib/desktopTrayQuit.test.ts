import { beforeAll, describe, expect, it, vi } from "vitest";

const exit = vi.hoisted(() => vi.fn(async () => {}));
const hide = vi.hoisted(() => vi.fn(async () => {}));
const closeHandlers = vi.hoisted(() => [] as (() => void)[]);
const menus = vi.hoisted(
  () => [] as { items: { id: string; action: () => void }[] }[],
);

vi.mock("@tauri-apps/plugin-process", () => ({ exit }));
vi.mock("@tauri-apps/api/app", () => ({
  defaultWindowIcon: async () => null,
}));
vi.mock("@tauri-apps/api/image", () => ({ Image: {} }));
vi.mock("@tauri-apps/api/menu", () => ({
  Menu: {
    new: async (options: { items: { id: string; action: () => void }[] }) => {
      menus.push(options);
      return {};
    },
  },
}));
vi.mock("@tauri-apps/api/tray", () => ({
  TrayIcon: { getById: async () => null, new: async () => ({}) },
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    hide,
    onCloseRequested: async (handler: () => void) => {
      closeHandlers.push(handler);
      return () => {};
    },
  }),
}));

import { createDesktopTray } from "../../src/lib/desktopTray";

const menuItem = (id: string) => menus[0].items.find((item) => item.id === id);

describe("the desktop tray", () => {
  beforeAll(() => createDesktopTray());

  it("hides the window to the tray from its menu", () => {
    menuItem("hide")?.action();
    expect(hide).toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("ends the whole app from its menu", () => {
    menuItem("quit")?.action();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("ends the whole app when the window closes", () => {
    exit.mockClear();
    closeHandlers[0]();
    expect(exit).toHaveBeenCalledWith(0);
  });
});
