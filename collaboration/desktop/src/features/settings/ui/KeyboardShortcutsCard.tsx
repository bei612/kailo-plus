import { resolveLocale } from "@client-kit/platform/i18n";
import {
  ShortcutSettings,
  shortcutText,
} from "@client-kit/platform/react/settings";
import {
  getShortcutsByCategory,
  getPlatformKeys,
} from "@/shared/lib/keyboard-shortcuts";

export function KeyboardShortcutsCard() {
  return (
    <ShortcutSettings
      locale={resolveLocale()}
      shortcuts={[...getShortcutsByCategory().values()]
        .flat()
        .flatMap((shortcut) => {
          const text = shortcutText(resolveLocale(), shortcut.id);
          return text
            ? [{ id: shortcut.id, ...text, keys: getPlatformKeys(shortcut) }]
            : [];
        })}
    />
  );
}
