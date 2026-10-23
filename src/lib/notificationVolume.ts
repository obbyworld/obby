import useStore from "../store";

const UNMUTED_VOLUME = 0.4;

export function isNotificationSoundMuted(): boolean {
  return useStore.getState().globalSettings.notificationVolume <= 0;
}

export async function toggleNotificationSound(): Promise<void> {
  const volume = isNotificationSoundMuted() ? UNMUTED_VOLUME : 0;
  useStore.getState().updateGlobalSettings({ notificationVolume: volume });
  if (volume === 0) return;
  // We play a sample on unmute so the user hears the new level right away.
  const audio = new Audio("/sounds/notif2.mp3");
  audio.volume = volume;
  try {
    await audio.play();
  } catch (error) {
    console.error("Failed to play notification sound:", error);
  }
}
