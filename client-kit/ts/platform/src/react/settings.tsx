// DD-53 / ADR-09: shared presentation only. Hosts retain their existing
// preference stores, native notification permissions and keyboard handlers.
import { useState, type ReactNode } from "react";
import { useDeviceLocale } from "./context";
import {
  platformThemeModeKeys,
  setLocale,
  translate,
  type PlatformLocale,
  type PlatformThemeMode,
} from "../i18n";

export type SettingsSection = "profile" | "appearance" | "notifications" | "shortcuts";

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
export const settingsSectionKeys = {
  profile: "platform.settings.profile",
  appearance: "platform.settings.appearance",
  notifications: "platform.settings.notifications",
  shortcuts: "platform.settings.shortcuts",
} as const;

export function SettingsNavigation({
  locale,
  section,
  onSelect,
  icons,
}: {
  locale: PlatformLocale;
  section: SettingsSection;
  onSelect: (section: SettingsSection) => void;
  icons?: Partial<Record<SettingsSection, ReactNode>>;
}) {
  return (
    <nav aria-label={translate(locale, "platform.settings.title")} className="flex flex-wrap gap-1">
      {(Object.keys(settingsSectionKeys) as SettingsSection[]).map((value) => (
        <button
          key={value}
          type="button"
          data-testid={`settings-nav-${value}`}
          aria-pressed={section === value}
          onClick={() => onSelect(value)}
          className={`inline-flex min-h-8 items-center gap-2 rounded-md px-3 py-2 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ${section === value ? "bg-secondary text-secondary-foreground" : "text-foreground hover:bg-accent"}`}
        >
          {icons?.[value]}
          {translate(locale, settingsSectionKeys[value])}
        </button>
      ))}
    </nav>
  );
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

export type SettingsShortcut = { id: string; label: string; description?: string; keys: string };

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
  return (
    <section className="min-w-0" data-testid="settings-shortcuts">
      <h2 className="text-lg font-semibold">{translate(locale, "platform.settings.shortcuts")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {translate(locale, "platform.settings.shortcutsDescription")}
      </p>
      <dl className="mt-4 divide-y divide-border">
        {shortcuts.map((shortcut) => (
          <div key={shortcut.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <dt className="min-w-0 flex-1 text-sm">
              <span className="font-medium">{shortcut.label}</span>
              {shortcut.description ? (
                <p className="text-muted-foreground">{shortcut.description}</p>
              ) : null}
            </dt>
            <dd>
              <kbd className="rounded border border-border bg-muted px-2 py-1 font-mono text-xs">
                {shortcut.keys}
              </kbd>
            </dd>
          </div>
        ))}
      </dl>
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
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6" data-testid="settings-page">
      <SettingsNavigation locale={locale} section={section} onSelect={onSelect} />
      <div data-testid={`settings-panel-${section}`} className="flex flex-col gap-6">
        {section === "appearance" ? <LanguageSettings /> : null}
        {children}
      </div>
    </div>
  );
}
