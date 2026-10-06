import { useDeviceLocale } from "@client-kit/platform/react/context";
import {
  ShortcutSettings,
  shortcutText,
} from "@client-kit/platform/react/settings";
import {
  getShortcutsByCategory,
  getPlatformKeys,
} from "@/shared/lib/keyboard-shortcuts";

export function KeyboardShortcutsCard() {
  const locale = useDeviceLocale();
  return (
    <ShortcutSettings
      locale={locale}
      shortcuts={[...getShortcutsByCategory().values()]
        .flat()
        .flatMap((shortcut) => {
          const text = shortcutText(locale, shortcut.id);
          return text
            ? [{ id: shortcut.id, ...text, keys: getPlatformKeys(shortcut), category: shortcut.category }]
            : [];
        })}
    />
  );
}
