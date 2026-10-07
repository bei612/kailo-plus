// Original Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/settings/ui/AppearanceSettingsControls.tsx::GlassBackgroundSetting.
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { translate } from "../i18n";
import { DEFAULT_GLASS_OPACITY, GLASS_OPACITY_MAX, GLASS_OPACITY_MIN, type GlassAppearance } from "../theme/glass-preference";
import { useUiLocale } from "./context";
import { Switch } from "./switch";
import { SettingsOptionRow } from "./settings-option-group";
import { SettingsSlider } from "./settings-slider";

export function GlassBackgroundSetting({ glass, hidden = false, performDefaultHaptic }: {
  glass?: GlassAppearance; hidden?: boolean; performDefaultHaptic?: () => void;
}) {
  const locale = useUiLocale();
  const shouldReduceMotion = useReducedMotion();
  if (hidden) return null;

  const glassBackgroundSupported = glass?.glassBackgroundSupported === true;
  const shouldShowOpacity = glassBackgroundSupported && glass?.glassBackground;
  const opacityRow = glass ? (
    <SettingsOptionRow data-testid="glass-opacity-row">
      <div className="min-w-0">
        <p className="text-sm font-medium">{translate(locale, "platform.appearance.glassOpacity")}</p>
        <p className="text-sm font-normal text-muted-foreground/70" data-settings-subcopy id="glass-opacity-description">
          {translate(locale, "platform.appearance.glassOpacityDescription")}
        </p>
      </div>
      <div className="flex w-64 shrink-0 items-center">
        <SettingsSlider
          ariaDescribedBy="glass-opacity-description"
          ariaLabel={translate(locale, "platform.appearance.glassOpacity")}
          ariaValueText={translate(locale, "platform.appearance.opacity", { value: glass.glassOpacity })}
          compact handleAlwaysVisible max={GLASS_OPACITY_MAX} min={GLASS_OPACITY_MIN}
          onChange={glass.setGlassOpacity}
          onReset={() => glass.setGlassOpacity(DEFAULT_GLASS_OPACITY)}
          resetLabel={translate(locale, "platform.appearance.resetGlassOpacity")}
          resetTestId="glass-opacity-reset" resetValue={DEFAULT_GLASS_OPACITY}
          testId="glass-opacity-slider" value={glass.glassOpacity} performDefaultHaptic={performDefaultHaptic}
        />
      </div>
    </SettingsOptionRow>
  ) : null;

  return <>
    <SettingsOptionRow data-testid="glass-background-row">
      <div className="min-w-0">
        <label className="text-sm font-medium" htmlFor="glass-background-switch">
          {translate(locale, "platform.appearance.glassBackground")}
        </label>
        <p className="text-sm font-normal text-muted-foreground/70" data-settings-subcopy>
          {glassBackgroundSupported ? translate(locale, "platform.appearance.glassDescription") : translate(locale, "platform.appearance.glassMacOnly")}
        </p>
      </div>
      <Switch checked={glassBackgroundSupported && glass?.glassBackground === true}
        data-testid="glass-background-toggle" disabled={!glassBackgroundSupported}
        id="glass-background-switch" onCheckedChange={glass?.setGlassBackground} />
    </SettingsOptionRow>
    {shouldReduceMotion ? (shouldShowOpacity ? opacityRow : null) : <AnimatePresence initial={false}>
      {shouldShowOpacity ? <motion.div animate={{ height: "auto", opacity: 1, y: 0 }} className="overflow-hidden"
        exit={{ height: 0, opacity: 0, y: -6 }} initial={{ height: 0, opacity: 0, y: -6 }} key="glass-opacity"
        transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}>{opacityRow}</motion.div> : null}
    </AnimatePresence>}
  </>;
}
