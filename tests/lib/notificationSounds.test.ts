import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  playNotificationSound,
  shouldPlayNotificationSound,
} from "../../src/lib/notificationSounds";

// Mock Web Audio API
const mockAudioContext = {
  createOscillator: vi.fn(() => ({
    connect: vi.fn(),
    frequency: { setValueAtTime: vi.fn() },
    type: "sine",
    start: vi.fn(),
    stop: vi.fn(),
  })),
  createGain: vi.fn(() => ({
    connect: vi.fn(),
    gain: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
  })),
  destination: {},
  currentTime: 0,
};

// Mock HTML Audio API
const mockAudio = {
  play: vi.fn(() => Promise.resolve()),
  volume: 0.5,
};

// Mock URL API
const mockURL = {
  createObjectURL: vi.fn(() => "blob:test-url"),
  revokeObjectURL: vi.fn(),
};

// vitest 4 rejects arrow implementations invoked with `new`; a plain function
// that returns a prebuilt instance is the supported replacement for stubbing
// the AudioContext/Audio constructors.
function ctorReturning<T>(instance: T): () => T {
  function Ctor() {
    return instance;
  }
  return Ctor as unknown as () => T;
}

describe("notificationSounds", () => {
  beforeEach(() => {
    // Mock globals
    global.window = global.window || {};
    (
      global.window as unknown as {
        AudioContext: unknown;
        webkitAudioContext: unknown;
      }
    ).AudioContext = vi.fn(ctorReturning(mockAudioContext));
    (
      global.window as unknown as {
        AudioContext: unknown;
        webkitAudioContext: unknown;
      }
    ).webkitAudioContext = vi.fn(ctorReturning(mockAudioContext));
    (global as unknown as { Audio: unknown }).Audio = vi.fn(
      ctorReturning(mockAudio),
    );
    (global as unknown as { URL: unknown }).URL = mockURL;

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("playNotificationSound", () => {
    it("should not play sound if notification sounds are disabled", async () => {
      const globalSettings = {
        enableNotificationSounds: false,
        notificationVolume: 0,
        notificationSound: "",
      };

      await playNotificationSound(globalSettings);

      expect(global.Audio).not.toHaveBeenCalled();
      expect(mockAudioContext.createOscillator).not.toHaveBeenCalled();
    });

    it("should play default beep sound when no custom sound is set", async () => {
      const globalSettings = {
        enableNotificationSounds: true,
        notificationVolume: 0.8,
        notificationSound: "",
      };

      await playNotificationSound(globalSettings);

      expect(mockAudioContext.createOscillator).toHaveBeenCalled();
      expect(mockAudioContext.createGain).toHaveBeenCalled();
      expect(global.Audio).not.toHaveBeenCalled();
    });

    it("should play custom sound when notification sound is set", async () => {
      const globalSettings = {
        enableNotificationSounds: true,
        notificationSound: "custom-sound-url",
        notificationVolume: 0.3,
      };

      await playNotificationSound(globalSettings);

      expect(global.Audio).toHaveBeenCalledWith("custom-sound-url");
      expect(mockAudio.play).toHaveBeenCalled();
      expect(mockAudio.volume).toBe(0.3);
    });

    it("should handle audio playback errors gracefully", async () => {
      const globalSettings = {
        enableNotificationSounds: true,
        notificationVolume: 0.8,
        notificationSound: "invalid-url",
      };

      mockAudio.play.mockRejectedValueOnce(new Error("Audio failed"));
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await playNotificationSound(globalSettings);

      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to play notification sound:",
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });
  });

  describe("shouldPlayNotificationSound", () => {
    const mockCurrentUser = { username: "testuser" };

    it("should return false if notification sounds are disabled", () => {
      const message = {
        userId: "otheruser",
        content: "Hello testuser!",
        type: "message",
      };
      const globalSettings = {
        enableNotificationSounds: false,
        notificationVolume: 0,
        enableHighlights: true,
        customMentions: [],
      };

      const result = shouldPlayNotificationSound(
        message,
        mockCurrentUser,
        globalSettings,
      );
      expect(result).toBe(false);
    });

    it("should return false for messages from current user", () => {
      const message = {
        userId: "testuser",
        content: "Hello everyone!",
        type: "message",
      };
      const globalSettings = {
        enableNotificationSounds: true,
        notificationVolume: 0.8,
        enableHighlights: true,
        customMentions: [],
      };

      const result = shouldPlayNotificationSound(
        message,
        mockCurrentUser,
        globalSettings,
      );
      expect(result).toBe(false);
    });

    it("should return true for mentions when highlights are enabled", () => {
      const message = {
        userId: "otheruser",
        content: "Hello testuser!",
        type: "message",
      };
      const globalSettings = {
        enableNotificationSounds: true,
        notificationVolume: 0.8,
        enableHighlights: true,
        customMentions: [],
      };

      const result = shouldPlayNotificationSound(
        message,
        mockCurrentUser,
        globalSettings,
      );
      expect(result).toBe(true);
    });

    it("should return false for non-mentions when highlights are enabled", () => {
      const message = {
        userId: "otheruser",
        content: "Hello everyone!",
        type: "message",
      };
      const globalSettings = {
        enableNotificationSounds: true,
        notificationVolume: 0.8,
        enableHighlights: true,
        customMentions: [],
      };

      const result = shouldPlayNotificationSound(
        message,
        mockCurrentUser,
        globalSettings,
      );
      expect(result).toBe(false);
    });

    it("should return true for all messages when highlights are disabled", () => {
      const message = {
        userId: "otheruser",
        content: "Hello everyone!",
        type: "message",
      };
      const globalSettings = {
        enableNotificationSounds: true,
        notificationVolume: 0.8,
        enableHighlights: false,
        customMentions: [],
      };

      const result = shouldPlayNotificationSound(
        message,
        mockCurrentUser,
        globalSettings,
      );
      expect(result).toBe(true);
    });

    it("should detect mentions case-insensitively", () => {
      const message = {
        userId: "otheruser",
        content: "Hello TESTUSER!",
        type: "message",
      };
      const globalSettings = {
        enableNotificationSounds: true,
        notificationVolume: 0.8,
        enableHighlights: true,
        customMentions: [],
      };

      const result = shouldPlayNotificationSound(
        message,
        mockCurrentUser,
        globalSettings,
      );
      expect(result).toBe(true);
    });

    it("should handle null current user gracefully", () => {
      const message = {
        userId: "otheruser",
        content: "Hello everyone!",
        type: "message",
      };
      const globalSettings = {
        enableNotificationSounds: true,
        notificationVolume: 0.8,
        enableHighlights: true,
        customMentions: [],
      };

      const result = shouldPlayNotificationSound(message, null, globalSettings);
      expect(result).toBe(true);
    });
  });
});
