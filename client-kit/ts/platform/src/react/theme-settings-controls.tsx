import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown, Moon, Sun, SunMoon } from "lucide-react";
import { twJoin, twMerge } from "tailwind-merge";
import { translate, platformThemeModeKeys, type PlatformThemeMode, type PlatformLocale, type PlatformMessageKey } from "../i18n";
import { SegmentedControl } from "./segmented-control";
import { SettingsOptionGroup, SettingsOptionRow } from "./settings-option-group";
import { isBuzzTheme, ACCENT_COLORS, NEUTRAL_ACCENT, type Appearance } from "../theme/use-appearance";
import { LIGHT_THEMES, SYNTAX_THEMES, type SyntaxThemeName, getThemePair } from "../theme/theme-loader";
import { BUZZ_GRADIENT_STOPS, SystemPreferencePreviewFrame, ThemePreviewFrame, type ThemePreviewVars } from "../theme/theme-preview-frame";
import { getThemeFallbackPreviewVars, useThemePreviewVars, withAccentPreviewVars } from "../theme/use-theme-preview-vars";
import { contrastColorForBackground } from "../theme/color-contrast";
const cn = (...values: Parameters<typeof twJoin>) => twMerge(twJoin(...values));
const APPEARANCE_MODE_OPTIONS = [
  { mode: "system" as const, Icon: SunMoon },
  { mode: "light" as const, Icon: Sun },
  { mode: "dark" as const, Icon: Moon },
] as const;
const accentKeys: Record<(typeof ACCENT_COLORS)[number]["name"], PlatformMessageKey> = {
  Neutral: "platform.theme.accentNeutral",
  Blue: "platform.theme.accentBlue",
  Cyan: "platform.theme.accentCyan",
  Green: "platform.theme.accentGreen",
  Orange: "platform.theme.accentOrange",
  Red: "platform.theme.accentRed",
  Pink: "platform.theme.accentPink",
  Lilac: "platform.theme.accentLilac",
  Purple: "platform.theme.accentPurple",
  Indigo: "platform.theme.accentIndigo",
};
function formatThemeLabel(name: string): string {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Derive a display label for a paired theme from its light variant name.
 * Strips mode-specific tokens (light, latte, dawn, lotus, ochin, lighter, plus)
 * from any position, handling names like "github-light-default", "light-plus",
 * "material-theme-lighter", and "gruvbox-light-soft".
 */
function pairedThemeLabel(lightName: string): string {
  const modeTokens = new Set([
    "light",
    "latte",
    "dawn",
    "lotus",
    "ochin",
    "lighter",
    "plus",
  ]);
  const parts = lightName.split("-").filter((t) => !modeTokens.has(t));
  // If stripping removed everything (e.g. "light-plus"), fall back to the raw name
  const base = parts.length > 0 ? parts.join("-") : lightName;
  return formatThemeLabel(base);
}

/**
 * Categorize themes into three groups:
 * 1. Paired — themes with both a light and dark variant (auto-switches with system)
 * 2. Light-only — light themes with no dark counterpart
 * 3. Dark-only — dark themes with no light counterpart
 *
 * For paired themes, we deduplicate by only keeping the light member
 * (the dark member is shown alongside it as a preview).
 */
function useThemeCategories() {
  return useMemo(() => {
    const pairedLight: SyntaxThemeName[] = [];
    const lightOnly: SyntaxThemeName[] = [];
    const darkOnly: SyntaxThemeName[] = [];

    // Track which themes are the "dark side" of a pair so we skip them
    const darkPairMembers = new Set<string>();
    for (const name of SYNTAX_THEMES) {
      if (LIGHT_THEMES.has(name)) {
        const pair = getThemePair(name);
        if (pair) {
          darkPairMembers.add(pair);
        }
      }
    }

    for (const name of SYNTAX_THEMES) {
      // Skip dark members of pairs — they'll be shown alongside their light counterpart
      if (darkPairMembers.has(name)) continue;

      if (LIGHT_THEMES.has(name)) {
        const pair = getThemePair(name);
        if (pair) {
          pairedLight.push(name);
        } else {
          lightOnly.push(name);
        }
      } else {
        darkOnly.push(name);
      }
    }

    return { pairedLight, lightOnly, darkOnly };
  }, []);
}

function PairedThemeTile({
  isActive,
  lightName,
  lightVars,
  darkVars,
  onSelect,
}: {
  isActive: boolean;
  lightName: SyntaxThemeName;
  lightVars: ThemePreviewVars | null;
  darkVars: ThemePreviewVars | null;
  onSelect: () => void;
}) {
  const darkName = getThemePair(lightName);
  return (
    <button
      aria-pressed={isActive}
      className="group flex w-[168px] shrink-0 flex-col items-center text-center focus-visible:outline-hidden"
      data-testid={`theme-pair-${lightName}`}
      onClick={onSelect}
      type="button"
    >
      <SystemPreferencePreviewFrame
        className={cn(
          "h-[112px] w-[168px] transition-shadow",
          isActive
            ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
            : "group-hover:ring-2 group-hover:ring-border",
        )}
        darkGradient={darkName ? BUZZ_GRADIENT_STOPS[darkName] : undefined}
        darkVars={darkVars}
        lightGradient={BUZZ_GRADIENT_STOPS[lightName]}
        lightVars={lightVars}
      />
      <span
        className={cn(
          "mt-1.5 w-full truncate text-xs",
          isActive ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {pairedThemeLabel(lightName)}
      </span>
    </button>
  );
}

function SingleThemeTile({
  isActive,
  name,
  vars,
  onSelect,
}: {
  isActive: boolean;
  name: SyntaxThemeName;
  vars: ThemePreviewVars | null;
  onSelect: () => void;
}) {
  return (
    <button
      aria-pressed={isActive}
      className="group flex w-[168px] shrink-0 flex-col items-center text-center focus-visible:outline-hidden"
      data-testid={`theme-option-${name}`}
      onClick={onSelect}
      type="button"
    >
      <ThemePreviewFrame
        className={cn(
          "h-[112px] w-[168px] transition-shadow",
          isActive
            ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
            : "group-hover:ring-2 group-hover:ring-border",
        )}
        sidebarGradient={BUZZ_GRADIENT_STOPS[name]}
        vars={vars}
      />
      <span
        className={cn(
          "mt-1.5 w-full truncate text-xs",
          isActive ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {formatThemeLabel(name)}
      </span>
    </button>
  );
}

// Reveal/hide motion for the accent picker: a small translate + opacity fade.
// The picker sits below the theme grid and reads as tucking up behind it, so
// it enters from above (slides *down* into place when a non-Buzz theme reveals
// it) and exits upward (slides up behind the grid when Buzz hides it). No
// height/scale — height collapse clipped the swatches behind the grid's bottom
// fade (the "white bar"). Snappier than the modal 0.2s since this is a small
// settings control, sharing the modal/ProfileSettingsCard easing curve.
const ACCENT_PICKER_TRANSITION = {
  duration: 0.16,
  ease: [0.23, 1, 0.32, 1] as const,
};

export function ThemeSettingsControls({ locale, name, appearance, children }: {
  locale: PlatformLocale; name: string; appearance: Appearance; children?: ReactNode;
}) {
  const {
    setTheme,
    selectedThemeName,
    themeName,
    isDark,
    accentColor,
    setAccentColor,
    followSystem,
    setFollowSystem,
  } = appearance;

  // Buzz themes pin a neutral accent (GitHub black in light, white in dark),
  // so the accent picker is hidden while a Buzz theme is active. `themeName` is
  // the effective theme, so this also covers System mode resolving to Buzz.
  const buzzThemeSelected = isBuzzTheme(themeName);
  const accentPickerHidden = buzzThemeSelected;
  const shouldReduceMotion = useReducedMotion();

  const previewVarsByTheme = useThemePreviewVars();
  const { pairedLight, lightOnly, darkOnly } = useThemeCategories();

  // Determine the active mode from current state
  const activeMode: PlatformThemeMode = followSystem
    ? "system"
    : isDark
      ? "dark"
      : "light";

  const [selectedMode, setSelectedMode] =
    useState<PlatformThemeMode>(activeMode);
  const [themeStyleExpanded, setThemeStyleExpanded] = useState(false);

  const getVars = (name: SyntaxThemeName) =>
    withAccentPreviewVars(
      previewVarsByTheme[name] ?? getThemeFallbackPreviewVars(name),
      accentColor,
    );

  // All light themes (paired light + light-only)
  const allLightThemes = useMemo(
    () => [...pairedLight, ...lightOnly],
    [pairedLight, lightOnly],
  );

  // All dark themes (paired dark + dark-only)
  const allDarkThemes = useMemo(() => {
    const pairedDark = pairedLight
      .map((l) => getThemePair(l))
      .filter(Boolean) as SyntaxThemeName[];
    return [...pairedDark, ...darkOnly];
  }, [pairedLight, darkOnly]);

  const handleModeSelect = (mode: PlatformThemeMode) => {
    setSelectedMode(mode);
    if (mode === "system") {
      setFollowSystem(true);
      // If the current theme is unpaired, resolveSystemTheme can't switch it
      // with the OS. Fall back to the first paired theme so System mode works.
      const pair = getThemePair(selectedThemeName as SyntaxThemeName);
      if (!pair && pairedLight.length > 0) {
        setTheme(pairedLight[0]!);
      }
    } else {
      setFollowSystem(false);
      // Switch to the counterpart theme when the current theme doesn't match
      // the selected mode. E.g. if the stored theme is light and the user
      // clicks Dark, apply the dark pair so the app immediately reflects the
      // chosen mode. For unpaired themes (no counterpart), fall back to the
      // first available theme in the target mode's list.
      const currentIsLight = LIGHT_THEMES.has(
        selectedThemeName as SyntaxThemeName,
      );
      const needsDark = mode === "dark" && currentIsLight;
      const needsLight = mode === "light" && !currentIsLight;
      if (needsDark || needsLight) {
        const pair = getThemePair(selectedThemeName as SyntaxThemeName);
        if (pair) {
          setTheme(pair);
        } else {
          // Unpaired theme — pick the first theme from the target mode
          const fallback = needsDark ? allDarkThemes[0] : allLightThemes[0];
          if (fallback) {
            setTheme(fallback);
          }
        }
      }
    }
  };

  const handleSelectTheme = (name: SyntaxThemeName) => {
    setTheme(name);
    if (selectedMode === "system") {
      setFollowSystem(true);
    } else {
      setFollowSystem(false);
    }
  };

  /** Check if a paired theme (by its light member) is the active selection */
  const isPairActive = (lightName: SyntaxThemeName) => {
    const darkName = getThemePair(lightName);
    return selectedThemeName === lightName || selectedThemeName === darkName;
  };
  const selectedPairedTheme =
    selectedMode === "system" ? pairedLight.find(isPairActive) : undefined;
  const selectedTheme = selectedThemeName as SyntaxThemeName;
  const selectedPairedDarkTheme = selectedPairedTheme
    ? getThemePair(selectedPairedTheme)
    : undefined;
  const selectedThemeLabel = selectedPairedTheme
    ? pairedThemeLabel(selectedPairedTheme)
    : formatThemeLabel(selectedTheme);
  const selectedThemePreview = selectedPairedTheme ? (
    <SystemPreferencePreviewFrame
      className="h-[112px] w-[168px] shrink-0"
      darkGradient={
        selectedPairedDarkTheme
          ? BUZZ_GRADIENT_STOPS[selectedPairedDarkTheme]
          : undefined
      }
      darkVars={
        selectedPairedDarkTheme ? getVars(selectedPairedDarkTheme) : null
      }
      lightGradient={BUZZ_GRADIENT_STOPS[selectedPairedTheme]}
      lightVars={getVars(selectedPairedTheme)}
    />
  ) : (
    <ThemePreviewFrame
      className="h-[112px] w-[168px] shrink-0"
      sidebarGradient={BUZZ_GRADIENT_STOPS[selectedTheme]}
      vars={getVars(selectedTheme)}
    />
  );
  const themeStyleGrid = (
    <div
      className="px-4 pb-4 pt-1"
      data-testid="theme-style-options"
      id="theme-style-options"
    >
      {/* Theme grid — constrained to ~3 rows, scrolls internally */}
      <div className="relative">
        {/* Top fade */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 z-10 h-3"
          style={{
            background:
              "linear-gradient(to bottom, hsl(var(--background)), hsl(var(--background) / 0))",
          }}
        />
        {/* Bottom fade — hidden while the accent picker is visible so its
            near-white gradient (Buzz light) can't mask the swatches below it
            (the "white bar"). Kept only when the picker is hidden. */}
        {accentPickerHidden ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-3"
            style={{
              background:
                "linear-gradient(to top, hsl(var(--background)), hsl(var(--background) / 0))",
            }}
          />
        ) : null}
        <div className="max-h-[430px] overflow-y-auto rounded-lg pt-2">
          <div className="flex flex-wrap gap-4 p-1">
            {selectedMode === "system" &&
              pairedLight.map((lightName) => {
                const darkName = getThemePair(lightName);
                if (!darkName) return null;
                return (
                  <PairedThemeTile
                    darkVars={getVars(darkName)}
                    isActive={isPairActive(lightName)}
                    key={lightName}
                    lightName={lightName}
                    lightVars={getVars(lightName)}
                    onSelect={() => handleSelectTheme(lightName)}
                  />
                );
              })}
            {selectedMode === "light" &&
              allLightThemes.map((name) => (
                <SingleThemeTile
                  isActive={selectedThemeName === name}
                  key={name}
                  name={name}
                  onSelect={() => handleSelectTheme(name)}
                  vars={getVars(name)}
                />
              ))}
            {selectedMode === "dark" &&
              allDarkThemes.map((name) => (
                <SingleThemeTile
                  isActive={selectedThemeName === name}
                  key={name}
                  name={name}
                  onSelect={() => handleSelectTheme(name)}
                  vars={getVars(name)}
                />
              ))}
          </div>
        </div>
      </div>
    </div>
  );

  return (
        <SettingsOptionGroup
          data-testid="appearance-theme-card"
          title={translate(locale, "platform.settings.theme")}
        >
          <SettingsOptionRow data-testid="appearance-color-mode-row">
            <div className="min-w-0">
              <p className="text-sm font-medium">{translate(locale, "platform.theme.colorMode")}</p>
              <p className="text-sm font-normal text-muted-foreground/70" data-settings-subcopy>
                {translate(locale, "platform.theme.colorModeDescription")}
              </p>
            </div>
            <SegmentedControl
              indicatorTestId="appearance-color-mode-indicator"
              legend={translate(locale, "platform.theme.colorMode")}
              onValueChange={handleModeSelect}
              optionTestIdPrefix="appearance-mode"
              options={APPEARANCE_MODE_OPTIONS.map(({ mode, Icon }) => ({
                value: mode,
                label: translate(locale, platformThemeModeKeys[mode]),
                Icon,
              }))}
              testId="appearance-color-mode-control"
              value={selectedMode}
            />
          </SettingsOptionRow>

          <SettingsOptionRow data-testid="theme-style-row">
            <div className="min-w-0">
              <p className="text-sm font-medium">{translate(locale, "platform.theme.style")}</p>
              <p
                className="text-sm font-normal text-muted-foreground/70"
                data-settings-subcopy
              >
                {translate(locale, "platform.theme.styleDescription", { name })}
              </p>
            </div>
            <button
              aria-label={translate(locale, "platform.theme.styleSelected", { name: selectedThemeLabel })}
              aria-controls="theme-style-options"
              aria-expanded={themeStyleExpanded}
              className="flex h-auto min-w-0 items-center gap-2 rounded-md bg-transparent p-0 text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="theme-style-trigger"
              onClick={() => setThemeStyleExpanded((expanded) => !expanded)}
              type="button"
            >
              <span
                className="shrink-0"
                data-testid="theme-style-selected-preview"
              >
                {selectedThemePreview}
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none",
                  themeStyleExpanded && "rotate-180",
                )}
              />
            </button>
          </SettingsOptionRow>

          {shouldReduceMotion ? (
            themeStyleExpanded ? (
              themeStyleGrid
            ) : null
          ) : (
            <AnimatePresence initial={false}>
              {themeStyleExpanded ? (
                <motion.div
                  animate={{ height: "auto", opacity: 1, y: 0 }}
                  className="overflow-hidden"
                  exit={{ height: 0, opacity: 0, y: -6 }}
                  initial={{ height: 0, opacity: 0, y: -6 }}
                  key="theme-style-options"
                  transition={{
                    duration: 0.22,
                    ease: [0.23, 1, 0.32, 1],
                  }}
                >
                  {themeStyleGrid}
                </motion.div>
              ) : null}
            </AnimatePresence>
          )}

          {/* Accent color picker — hidden for Buzz themes (pinned neutral accent).
              Reveal/hide with the translate-up + opacity fade defined by
              ACCENT_PICKER_TRANSITION above. Reduced motion skips the transition
              and just renders/unrenders. */}
          {shouldReduceMotion ? (
            accentPickerHidden ? null : (
              <AccentPickerContent
                locale={locale}
                accentColor={accentColor}
                isDark={isDark}
                setAccentColor={setAccentColor}
              />
            )
          ) : (
            <AnimatePresence initial={false}>
              {accentPickerHidden ? null : (
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  className="will-change-[opacity,transform]"
                  exit={{ opacity: 0, y: -10 }}
                  initial={{ opacity: 0, y: -10 }}
                  key="accent-picker"
                  transition={ACCENT_PICKER_TRANSITION}
                >
                  <AccentPickerContent
                locale={locale}
                    accentColor={accentColor}
                    isDark={isDark}
                    setAccentColor={setAccentColor}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          )}

          {children}
        </SettingsOptionGroup>
  );
}
/** Accent swatches — shared by the animated and reduced-motion reveal paths. */
function AccentPickerContent({
  locale,
  accentColor,
  isDark,
  setAccentColor,
}: {
  locale: PlatformLocale;
  accentColor: string;
  isDark: boolean;
  setAccentColor: (value: string) => void;
}) {
  return (
    <SettingsOptionRow className="items-start">
      <div className="min-w-0">
        <p className="text-sm font-medium">{translate(locale, "platform.theme.accentColor")}</p>
        <p
          className="text-sm font-normal text-muted-foreground/70"
          data-settings-subcopy
        >
          {translate(locale, "platform.theme.accentDescription")}
        </p>
      </div>
      <div
        className="min-w-0 max-w-[34rem] shrink-0 overflow-x-auto rounded-xl bg-muted p-2"
        data-testid="accent-color-options"
      >
        <div className="flex w-max min-w-full flex-nowrap justify-end gap-2">
          {ACCENT_COLORS.map((color) => {
            const isNeutral = color.value === NEUTRAL_ACCENT;
            const isSelected = accentColor === color.value;
            const swatchColor = isNeutral
              ? "hsl(var(--foreground))"
              : color.value;
            const selectionColor = isNeutral
              ? isDark
                ? "#000000"
                : "#FFFFFF"
              : contrastColorForBackground(color.value);

            return (
              <button
                aria-label={translate(locale, accentKeys[color.name])}
                aria-pressed={isSelected}
                className="relative h-9 w-9 shrink-0 rounded-full border border-border transition-transform duration-200 ease-out hover:scale-[1.15] focus-visible:scale-[1.15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transform-none motion-reduce:transition-none"
                data-testid={`accent-color-${color.name.toLowerCase()}`}
                key={color.value}
                onClick={() => setAccentColor(color.value)}
                style={{ backgroundColor: swatchColor }}
                title={translate(locale, accentKeys[color.name])}
                type="button"
              >
                {isSelected ? (
                  <span
                    className="absolute inset-1 rounded-full border-[3px]"
                    data-testid="accent-color-selection"
                    style={{ borderColor: selectionColor }}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </SettingsOptionRow>
  );
}
