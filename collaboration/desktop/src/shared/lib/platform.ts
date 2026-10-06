export {
  hasPrimaryShortcutModifier,
  isMacPlatform,
} from "@client-kit/platform/keyboard-platform";

/** Returns true on Linux desktops (excludes Android). */
export function isLinuxPlatform(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  return (
    /linux/i.test(navigator.platform) && !/android/i.test(navigator.userAgent)
  );
}
