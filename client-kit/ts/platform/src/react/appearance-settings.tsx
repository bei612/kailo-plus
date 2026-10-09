// Original ThemeSettingsCard composition from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/settings/ui/SettingsPanels.tsx. The theme/settings stores
// are shared; native vibrancy and haptics remain real host capabilities.
import { translate } from "../i18n";
import { isBuzzTheme, type Appearance } from "../theme/use-appearance";
import type { GlassAppearance } from "../theme/glass-preference";
import { useUiLocale } from "./context";
import { ThemeSettingsControls } from "./theme-settings-controls";
import { SettingsSectionHeader, LanguageSettings } from "./settings";
import { SettingsOptionGroup, SettingsOptionGroupList } from "./settings-option-group";
import { GlassBackgroundSetting } from "./glass-background-setting";
import { ProminentActiveTabSetting } from "./prominent-active-tab-setting";
import { ConversationDisplaySettings } from "./conversation-display-settings";
import { LinkPreviewStyleSetting } from "./link-preview";
import { ThreadLayoutSetting } from "./thread-layout-settings";

export function AppearanceSettings({ name, appearance, glass, hideGlass = false, performDefaultHaptic }: {
  name: string; appearance: Appearance; glass?: GlassAppearance; hideGlass?: boolean;
  performDefaultHaptic?: () => void;
}) {
  const locale = useUiLocale();
  return <section className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="settings-theme">
    <SettingsSectionHeader title={translate(locale, "platform.settings.appearance")}
      description={translate(locale, "platform.theme.appearanceDescription", { name })} />
    <SettingsOptionGroupList>
      <LanguageSettings />
      <ThemeSettingsControls locale={locale} name={name} appearance={appearance}>
        <GlassBackgroundSetting glass={glass} hidden={hideGlass} performDefaultHaptic={performDefaultHaptic} />
        {isBuzzTheme(appearance.themeName) ? <ProminentActiveTabSetting locale={locale}
          prominentActiveTab={appearance.prominentActiveTab} setProminentActiveTab={appearance.setProminentActiveTab} /> : null}
      </ThemeSettingsControls>
      <SettingsOptionGroup data-testid="appearance-preferences-card" title={translate(locale, "platform.settings.preferences")}>
        <ConversationDisplaySettings locale={locale} name={name} />
        <LinkPreviewStyleSetting isDark={appearance.isDark} />
        <ThreadLayoutSetting isDark={appearance.isDark} />
      </SettingsOptionGroup>
    </SettingsOptionGroupList>
  </section>;
}
