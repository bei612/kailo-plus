export const SOUND_NAMES = [
  "bong",
  "boo",
  "dng",
  "doo",
  "doodone",
  "doong",
  "doop",
  "flirl",
  "flutter",
  "oh-no",
  "ping",
  "unison",
] as const;
export type SoundName = (typeof SOUND_NAMES)[number];

export const SOUND_SLOTS = ["mention", "thread_reply"] as const;
export type SoundSlot = (typeof SOUND_SLOTS)[number];

export const SLOT_LABELS: Record<SoundSlot, string> = {
  mention: "@Mentions",
  thread_reply: "Thread replies",
};

export const SLOT_DESCRIPTIONS: Record<SoundSlot, string> = {
  mention: "When someone tags you in a channel.",
  thread_reply: "When someone replies in a thread you follow or posted in.",
};

export const RECOMMENDED_SOUND_BY_SLOT: Record<SoundSlot, SoundName> = {
  mention: "ping",
  thread_reply: "doop",
};

export type SlotSounds = Record<SoundSlot, SoundName>;

export const DEFAULT_SLOT_SOUNDS: SlotSounds = {
  mention: "flutter",
  thread_reply: "flutter",
};

/** Per-event alerts (notification + sound) on/off. */
export const DEFAULT_SLOT_ALERTS_ENABLED: Record<SoundSlot, boolean> = {
  mention: true,
  thread_reply: true,
};

export type SoundPreferences = {
  sounds: SlotSounds;
};

export function resolveSlotSound(
  prefs: SoundPreferences,
  slot: SoundSlot,
): SoundName {
  return prefs.sounds[slot];
}

const cache = new Map<SoundName, HTMLAudioElement>();

function getAudio(name: SoundName): HTMLAudioElement {
  let audio = cache.get(name);
  if (!audio) {
    audio = new Audio(`/sounds/${name}.mp3`);
    cache.set(name, audio);
  }
  return audio;
}

export function playNotificationSound(
  name: SoundName,
): HTMLAudioElement | null {
  try {
    const audio = getAudio(name);
    audio.currentTime = 0;
    audio.play().catch(() => {
      // Best-effort — user may not have interacted with the page yet.
    });
    return audio;
  } catch {
    // Best-effort only.
    return null;
  }
}
