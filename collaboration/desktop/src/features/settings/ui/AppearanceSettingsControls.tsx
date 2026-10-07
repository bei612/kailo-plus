import { translate } from "@client-kit/platform/i18n";
import { useDeviceLocale } from "@client-kit/platform/react/context";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { LinkPreviewStyleSetting as SharedLinkPreviewStyleSetting } from "@client-kit/platform/react/link-preview";
import { isLinuxPlatform } from "@/shared/lib/platform";
import {
  DEFAULT_GLASS_OPACITY,
  GLASS_OPACITY_MAX,
  GLASS_OPACITY_MIN,
  useTheme,
} from "@/shared/theme/ThemeProvider";

import { Switch } from "@client-kit/platform/react/switch";
import { SettingsOptionRow } from "./SettingsOptionGroup";
import { SettingsSlider } from "./SettingsSlider";
import { ThreadLayoutSetting as SharedThreadLayoutSetting } from "@client-kit/platform/react/thread-layout-settings";

export function LinkPreviewStyleSetting() {
  const { isDark } = useTheme();
  return <SharedLinkPreviewStyleSetting isDark={isDark} />;
}

/** Native window glass rows sit below theme and accent choices. */
export function GlassBackgroundSetting() {
  const locale = useDeviceLocale();
  const {
    glassBackground,
    glassBackgroundSupported,
    glassOpacity,
    setGlassBackground,
    setGlassOpacity,
  } = useTheme();
  const shouldReduceMotion = useReducedMotion();

  if (isLinuxPlatform()) return null;

  const shouldShowOpacity = glassBackgroundSupported && glassBackground;
  const opacityRow = (
    <SettingsOptionRow data-testid="glass-opacity-row">
      <div className="min-w-0">
        <p className="text-sm font-medium">{translate(locale, "platform.appearance.glassOpacity")}</p>
        <p
          className="text-sm font-normal text-muted-foreground/70"
          data-settings-subcopy
          id="glass-opacity-description"
        >
          {translate(locale, "platform.appearance.glassOpacityDescription")}
        </p>
      </div>
      <div className="flex w-64 shrink-0 items-center">
        <SettingsSlider
          ariaDescribedBy="glass-opacity-description"
          ariaLabel={translate(locale, "platform.appearance.glassOpacity")}
          ariaValueText={translate(locale, "platform.appearance.opacity", { value: glassOpacity })}
          max={GLASS_OPACITY_MAX}
          min={GLASS_OPACITY_MIN}
          onChange={setGlassOpacity}
          onReset={() => setGlassOpacity(DEFAULT_GLASS_OPACITY)}
          resetLabel={translate(locale, "platform.appearance.resetGlassOpacity")}
          resetTestId="glass-opacity-reset"
          resetValue={DEFAULT_GLASS_OPACITY}
          testId="glass-opacity-slider"
          value={glassOpacity}
        />
      </div>
    </SettingsOptionRow>
  );

  return (
    <>
      <SettingsOptionRow data-testid="glass-background-row">
        <div className="min-w-0">
          <label
            className="text-sm font-medium"
            htmlFor="glass-background-switch"
          >
            {translate(locale, "platform.appearance.glassBackground")}
          </label>
          <p
            className="text-sm font-normal text-muted-foreground/70"
            data-settings-subcopy
          >
            {glassBackgroundSupported
              ? translate(locale, "platform.appearance.glassDescription")
              : translate(locale, "platform.appearance.glassMacOnly")}
          </p>
        </div>
        <Switch
          checked={glassBackgroundSupported && glassBackground}
          data-testid="glass-background-toggle"
          disabled={!glassBackgroundSupported}
          id="glass-background-switch"
          onCheckedChange={setGlassBackground}
        />
      </SettingsOptionRow>
      {shouldReduceMotion ? (
        shouldShowOpacity ? (
          opacityRow
        ) : null
      ) : (
        <AnimatePresence initial={false}>
          {shouldShowOpacity ? (
            <motion.div
              animate={{ height: "auto", opacity: 1, y: 0 }}
              className="overflow-hidden"
              exit={{ height: 0, opacity: 0, y: -6 }}
              initial={{ height: 0, opacity: 0, y: -6 }}
              key="glass-opacity"
              transition={{
                duration: 0.25,
                ease: [0.23, 1, 0.32, 1],
              }}
            >
              {opacityRow}
            </motion.div>
          ) : null}
        </AnimatePresence>
      )}
    </>
  );
}

export function ThreadLayoutSetting() {
  const { isDark } = useTheme();
  return <SharedThreadLayoutSetting isDark={isDark} />;
}
