// Shared from Buzz desktop/shared/lib/platform; keep native modifier semantics.
type ModifierKeyboardEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
>;

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform);
}

/** Returns true on Linux desktops (excludes Android). */
export function isLinuxPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  return (
    /linux/i.test(navigator.platform) && !/android/i.test(navigator.userAgent)
  );
}

export function hasPrimaryShortcutModifier(event: ModifierKeyboardEvent): boolean {
  if (isMacPlatform()) return event.metaKey && !event.ctrlKey;
  return event.ctrlKey && !event.metaKey;
}
