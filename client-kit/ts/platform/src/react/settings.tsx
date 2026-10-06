// DD-53 / ADR-09: shared presentation only. Hosts retain their existing
// preference stores, native notification permissions and keyboard handlers.
import { useState, type ReactNode } from "react";
import { useDeviceLocale } from "./context";
import { SettingsNavigation, SettingsContentSurface, SettingsSectionHeader, type SettingsSection } from "./settings-surface";
import { SettingsOptionGroup, SettingsOptionGroupList, SettingsOptionRow } from "./settings-option-group";
import { TooltipProvider } from "./sidebar/tooltip";
export { SettingsNavigation, SettingsContentSurface, SettingsSectionHeader, settingsSectionKeys, type SettingsSection } from "./settings-surface";
import {
  platformThemeModeKeys,
  setLocale,
  translate,
  type PlatformLocale,
  type PlatformThemeMode,
} from "../i18n";

export function LanguageSettings() {
  const locale = useDeviceLocale();
  const [failed, setFailed] = useState(false);
  return <fieldset className="flex min-w-0 flex-col gap-2" data-testid="settings-language">
    <legend className="mb-2 text-sm font-medium">{translate(locale, "platform.settings.language")}</legend>
    <div className="flex flex-wrap gap-2">
      {(["zh-CN", "en"] as const).map((language) => <label key={language}
        className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm">
        <input type="radio" name="interface-language" value={language} checked={locale === language}
          onChange={() => { try { setLocale(language); setFailed(false); } catch { setFailed(true); } }} />
        {translate(locale, language === "en" ? "platform.settings.languageEnglish" : "platform.settings.languageChinese")}
      </label>)}
    </div>
    <p className="text-sm text-muted-foreground">{translate(locale, "platform.settings.deviceLanguage")}</p>
    {failed ? <p role="alert">{translate(locale, "platform.settings.languageSaveFailed")}</p> : null}
  </fieldset>;
}
export function ThemeModeControl({
  locale,
  value,
  onChange,
}: {
  locale: PlatformLocale;
  value: PlatformThemeMode;
  onChange: (value: PlatformThemeMode) => void;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">
        {translate(locale, "platform.settings.theme")}
      </legend>
      <div className="flex flex-wrap gap-2">
        {(["system", "light", "dark"] as const).map((mode) => (
          <label
            key={mode}
            className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm"
          >
            <input
              type="radio"
              name="appearance-mode"
              value={mode}
              checked={value === mode}
              onChange={() => onChange(mode)}
              data-testid={`appearance-mode-${mode}`}
            />
            {translate(locale, platformThemeModeKeys[mode])}
          </label>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {translate(locale, "platform.settings.deviceAppearance")}
      </p>
    </fieldset>
  );
}

export type SettingsShortcut = { id: string; label: string; description?: string; keys: string; category?: "Navigation" | "Messages" | "Formatting" | "Zoom" };

const shortcutMessages = {
  "quick-search": [
    "platform.shortcuts.quick-search.label",
    "platform.shortcuts.quick-search.description",
  ],
  "open-settings": [
    "platform.shortcuts.open-settings.label",
    "platform.shortcuts.open-settings.description",
  ],
  "go-back": ["platform.shortcuts.go-back.label", "platform.shortcuts.go-back.description"],
  "go-forward": [
    "platform.shortcuts.go-forward.label",
    "platform.shortcuts.go-forward.description",
  ],
  "find-in-channel": [
    "platform.shortcuts.find-in-channel.label",
    "platform.shortcuts.find-in-channel.description",
  ],
  "go-home": ["platform.shortcuts.go-home.label", "platform.shortcuts.go-home.description"],
  "toggle-sidebar": [
    "platform.shortcuts.toggle-sidebar.label",
    "platform.shortcuts.toggle-sidebar.description",
  ],
  "mark-current-read": [
    "platform.shortcuts.mark-current-read.label",
    "platform.shortcuts.mark-current-read.description",
  ],
  "mark-all-read": [
    "platform.shortcuts.mark-all-read.label",
    "platform.shortcuts.mark-all-read.description",
  ],
  "zoom-in": ["platform.shortcuts.zoom-in.label", "platform.shortcuts.zoom-in.description"],
  "zoom-out": ["platform.shortcuts.zoom-out.label", "platform.shortcuts.zoom-out.description"],
  "zoom-reset": [
    "platform.shortcuts.zoom-reset.label",
    "platform.shortcuts.zoom-reset.description",
  ],
  "send-message": [
    "platform.shortcuts.send-message.label",
    "platform.shortcuts.send-message.description",
  ],
  "new-line": ["platform.shortcuts.new-line.label", "platform.shortcuts.new-line.description"],
  "close-dialog": [
    "platform.shortcuts.close-dialog.label",
    "platform.shortcuts.close-dialog.description",
  ],
  "format-bold": [
    "platform.shortcuts.format-bold.label",
    "platform.shortcuts.format-bold.description",
  ],
  "format-italic": [
    "platform.shortcuts.format-italic.label",
    "platform.shortcuts.format-italic.description",
  ],
  "format-strikethrough": [
    "platform.shortcuts.format-strikethrough.label",
    "platform.shortcuts.format-strikethrough.description",
  ],
  "format-code": [
    "platform.shortcuts.format-code.label",
    "platform.shortcuts.format-code.description",
  ],
  "format-link": [
    "platform.shortcuts.format-link.label",
    "platform.shortcuts.format-link.description",
  ],
} as const;

/** Labels describe the host's actual registered shortcuts, not new handlers. */
export function shortcutText(locale: PlatformLocale, id: string) {
  const keys = shortcutMessages[id as keyof typeof shortcutMessages];
  return keys
    ? { label: translate(locale, keys[0]), description: translate(locale, keys[1]) }
    : null;
}

export function ShortcutSettings({
  locale,
  shortcuts,
}: {
  locale: PlatformLocale;
  shortcuts: readonly SettingsShortcut[];
}) {
  const categories = new Map<string, SettingsShortcut[]>();
  for (const shortcut of shortcuts) {
    const category = shortcut.category ?? "Messages";
    categories.set(category, [...(categories.get(category) ?? []), shortcut]);
  }
  const categoryKeys = {
    Navigation: "platform.shortcuts.categoryNavigation", Messages: "platform.shortcuts.categoryMessages",
    Formatting: "platform.shortcuts.categoryFormatting", Zoom: "platform.shortcuts.categoryZoom",
  } as const;
  return (
    <section className="min-w-0" data-testid="settings-shortcuts">
      <SettingsSectionHeader title={translate(locale, "platform.settings.shortcuts")}
        description={translate(locale, "platform.settings.shortcutsDescription")} />
      <SettingsOptionGroupList>
        {[...categories].map(([category, entries]) => <SettingsOptionGroup key={category}
          title={translate(locale, categoryKeys[category as keyof typeof categoryKeys])}>
          {entries.map((shortcut) => <SettingsOptionRow key={shortcut.id} className="min-h-12 px-3 py-2" data-shortcut={shortcut.id}>
            <div className="min-w-0 flex-1"><span className="text-sm font-medium text-foreground">{shortcut.label}</span>
              <span className="ml-2 text-muted-foreground/70" data-settings-subcopy>{shortcut.description}</span></div>
            <span className="flex items-center gap-1" aria-label={shortcut.keys}>
              {shortcut.keys.replace(/^([⌘⌃⌥⇧]+)(.+)$/, (_all, modifiers: string, key: string) => [...modifiers, key].join("+"))
                .split(/(?<!\+)\+(?!\s*$)/).map((part) => part.trim()).filter(Boolean).map((part) =>
                <kbd key={part} className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-border/70 bg-muted/60 px-1.5 font-mono text-xs text-muted-foreground">{part}</kbd>)}
            </span>
          </SettingsOptionRow>)}
        </SettingsOptionGroup>)}
      </SettingsOptionGroupList>
    </section>
  );
}

export function SettingsPage({
  locale,
  section,
  onSelect,
  children,
}: {
  locale: PlatformLocale;
  section: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col bg-sidebar sm:flex-row" data-testid="settings-page">
      <nav aria-label={translate(locale, "platform.settings.title")} className="shrink-0 text-sidebar-foreground sm:w-(--sidebar-width)">
        <TooltipProvider><SettingsNavigation locale={locale} section={section} onSelect={onSelect} /></TooltipProvider>
      </nav>
      <SettingsContentSurface section={section}>{children}</SettingsContentSurface>
    </div>
  );
}
