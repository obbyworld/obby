import { t } from "@lingui/core/macro";
import { defaultWindowIcon } from "@tauri-apps/api/app";
import { Image } from "@tauri-apps/api/image";
import { Menu } from "@tauri-apps/api/menu";
import { TrayIcon } from "@tauri-apps/api/tray";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Server } from "../types";

export type UnreadLevel = "none" | "unread" | "mention";

const DOT_COLORS: Record<
  Exclude<UnreadLevel, "none">,
  [number, number, number]
> = {
  unread: [88, 101, 242],
  mention: [242, 63, 67],
};

export function withDot(
  rgba: Uint8Array,
  width: number,
  height: number,
  color: [number, number, number],
): Uint8Array {
  const dotted = new Uint8Array(rgba);
  const radius = Math.max(2, Math.round(Math.min(width, height) * 0.22));
  const centerX = width - radius - 1;
  const centerY = radius + 1;
  for (let y = centerY - radius; y <= centerY + radius; y++)
    for (let x = centerX - radius; x <= centerX + radius; x++) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 > radius ** 2) continue;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const at = (y * width + x) * 4;
      dotted.set([...color, 255], at);
    }
  return dotted;
}

export function unreadTotals(servers: Server[]): {
  unread: number;
  mentions: number;
} {
  let unread = 0;
  let mentions = 0;
  for (const server of servers)
    for (const chat of [...server.channels, ...(server.privateChats ?? [])]) {
      unread += chat.unreadCount;
      mentions += chat.mentionCount ?? 0;
    }
  return { unread, mentions };
}

export function unreadLevel(unread: number, mentions: number): UnreadLevel {
  if (mentions > 0) return "mention";
  return unread > 0 ? "unread" : "none";
}

export async function showMainWindow(): Promise<void> {
  const window = getCurrentWindow();
  await window.unminimize();
  await window.show();
  await window.setFocus();
}

let tray: TrayIcon | null = null;
let trayCreation: Promise<void> | null = null;
let baseIcon: Image | null = null;
const dottedIcons = new Map<UnreadLevel, Image>();

/** Creates the tray icon with its menu once per app, and hides the window on
 *  close while `shouldCloseToTray` says so. */
export function createDesktopTray(
  shouldCloseToTray: () => boolean,
): Promise<void> {
  trayCreation ??= buildTray(shouldCloseToTray);
  return trayCreation;
}

async function buildTray(shouldCloseToTray: () => boolean): Promise<void> {
  baseIcon = await defaultWindowIcon();
  const menu = await Menu.new({
    items: [
      { id: "show", text: t`Show Obby`, action: () => void showMainWindow() },
      {
        id: "quit",
        text: t`Quit Obby`,
        action: () => void getCurrentWindow().destroy(),
      },
    ],
  });
  tray = await TrayIcon.new({
    id: "main",
    icon: baseIcon ?? undefined,
    tooltip: "Obby",
    menu,
    showMenuOnLeftClick: false,
    action: (event) => {
      if (
        event.type === "Click" &&
        event.button === "Left" &&
        event.buttonState === "Up"
      )
        void showMainWindow();
    },
  });
  await getCurrentWindow().onCloseRequested((event) => {
    if (!shouldCloseToTray()) return;
    event.preventDefault();
    void getCurrentWindow().hide();
  });
}

async function iconFor(level: UnreadLevel): Promise<Image | null> {
  if (level === "none" || !baseIcon) return baseIcon;
  const cached = dottedIcons.get(level);
  if (cached) return cached;
  const { width, height } = await baseIcon.size();
  const rgba = await baseIcon.rgba();
  const icon = await Image.new(
    withDot(rgba, width, height, DOT_COLORS[level]),
    width,
    height,
  );
  dottedIcons.set(level, icon);
  return icon;
}

/** Shows the unread state on the tray icon and the mention count as the app
 *  badge, where the platform has one. */
export async function showUnreadState(
  level: UnreadLevel,
  mentions: number,
): Promise<void> {
  if (tray) await tray.setIcon(await iconFor(level));
  await getCurrentWindow()
    .setBadgeCount(mentions > 0 ? mentions : undefined)
    .catch(() => {});
}
