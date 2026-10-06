import * as React from "react";
import { translate, type PlatformLocale } from "@client-kit/platform/i18n";
import { useDeviceLocale } from "@client-kit/platform/react/context";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Eye } from "lucide-react";
import {
  setThreadViewMode,
  useThreadViewMode,
  type ThreadViewMode,
} from "@/features/channels/lib/threadViewModePreference";
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
import { SegmentedControl } from "@client-kit/platform/react/segmented-control";

export function LinkPreviewStyleSetting() {
  const { isDark } = useTheme();
  return <SharedLinkPreviewStyleSetting isDark={isDark} />;
}

const threadViewModeOptions = (locale: PlatformLocale): {
  value: ThreadViewMode;
  label: string;
  description: string;
}[] => [
  {
    value: "focus",
    label: translate(locale, "platform.appearance.focus"),
    description: translate(locale, "platform.appearance.focusDescription"),
  },
  {
    value: "split",
    label: translate(locale, "platform.appearance.split"),
    description: translate(locale, "platform.appearance.splitDescription"),
  },
];

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

/** Compact thread preference row in the Appearance preferences card. */
/**
 * Abstract diagram for the thread layout preview, in the same soft-block
 * style as the links sample: a rounded frame holding a channel surface and a
 * thread surface, with light skeleton bars. Inline SVG (not a data-URL image)
 * so fills reference theme tokens directly and follow light/dark and accent
 * changes automatically. Only the panel proportions change between modes.
 */
function ThreadLayoutDiagram({ mode }: { mode: ThreadViewMode }) {
  const { isDark } = useTheme();
  const gradientId = React.useId();
  // Inline SVG resolves CSS variables, so the frame gradient references the
  // Buzz gradient tokens directly and follows theme.css automatically.
  const gradientTop = isDark
    ? "var(--buzz-gradient-dark-top, #4a4616)"
    : "var(--buzz-gradient-light-top, #e6e6b6)";
  const gradientBottom = isDark
    ? "var(--buzz-gradient-dark-bottom, #0a1423)"
    : "var(--buzz-gradient-light-bottom, #c4d0da)";
  const channelSurface = "hsl(var(--muted))";
  const threadSurface = "hsl(var(--background))";
  const channelOpacity = isDark ? 0.88 : 0.78;
  const threadOpacity = isDark ? 0.98 : 0.96;
  const bar = "hsl(var(--foreground) / 0.24)";
  const barSoft = "hsl(var(--foreground) / 0.14)";

  const isFocus = mode === "focus";
  // Inner content area: 10..230 x 10..122 (inside the frame padding).
  // Split: channel and thread share the area side by side with a gap.
  // Focus: the channel continues beneath the overlaid thread, leaving only
  // a narrow orientation sliver visible at the left edge.
  const gap = 6;
  const threadX = isFocus ? 42 : 124;
  const channelWidth = isFocus ? 64 : threadX - 10 - gap;
  const threadWidth = 230 - threadX;

  /** Two skeleton text bars, clipped to the panel they sit in. */
  const skeleton = (x: number, y: number, width: number) => (
    <>
      <rect fill={bar} height={7} rx={3.5} width={width * 0.62} x={x} y={y} />
      <rect
        fill={barSoft}
        height={7}
        rx={3.5}
        width={width * 0.86}
        x={x}
        y={y + 13}
      />
    </>
  );

  return (
    <svg
      aria-hidden="true"
      className="block w-full max-w-60"
      data-testid={`thread-layout-diagram-${mode}`}
      role="img"
      viewBox="0 0 240 132"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={gradientTop} />
          <stop offset="1" stopColor={gradientBottom} />
        </linearGradient>
      </defs>
      {/* Frame */}
      <rect fill={`url(#${gradientId})`} height={132} rx={18} width={240} />
      {/* Channel surface */}
      <rect
        fill={channelSurface}
        height={112}
        opacity={channelOpacity}
        rx={10}
        width={channelWidth}
        x={10}
        y={10}
      />
      {channelWidth > 60 ? skeleton(22, 24, channelWidth - 24) : null}
      {/* Thread surface */}
      <path
        d={`M ${threadX + 10} 10 H 220 Q 230 10 230 20 V 112 Q 230 122 220 122 H ${threadX + 10} Q ${threadX} 122 ${threadX} 112 V 20 Q ${threadX} 10 ${threadX + 10} 10 Z`}
        fill={threadSurface}
        opacity={threadOpacity}
      />
      {skeleton(threadX + 12, 24, threadWidth - 24)}
    </svg>
  );
}

function ThreadLayoutPreview({ mode }: { mode: ThreadViewMode }) {
  const locale = useDeviceLocale();
  return (
    <div className="px-4 py-3" data-testid="thread-layout-preview">
      <div
        aria-hidden="true"
        className="relative overflow-hidden rounded-xl border border-border/65 bg-transparent"
        data-testid="thread-layout-preview-surface"
      >
        <span className="absolute right-3.5 top-3 inline-flex items-center gap-1 text-2xs font-medium text-muted-foreground/55">
          <Eye aria-hidden="true" className="size-3" />
          {translate(locale, "platform.settings.preview")}
        </span>
        <div className="p-4 pr-24">
          <ThreadLayoutDiagram mode={mode} />
        </div>
      </div>
    </div>
  );
}

export function ThreadLayoutSetting() {
  const locale = useDeviceLocale();
  const THREAD_VIEW_MODE_OPTIONS = threadViewModeOptions(locale);
  const threadViewMode = useThreadViewMode();
  const [previewMode, setPreviewMode] = React.useState<ThreadViewMode | null>(
    null,
  );
  const displayedMode = previewMode ?? threadViewMode;
  const activeOption =
    THREAD_VIEW_MODE_OPTIONS.find((option) => option.value === displayedMode) ??
    THREAD_VIEW_MODE_OPTIONS[0];

  return (
    <div data-testid="thread-layout-group">
      <SettingsOptionRow>
        <div className="min-w-0">
          <p className="text-sm font-medium">{translate(locale, "platform.appearance.threadLayout")}</p>
          <p
            className="text-sm font-normal text-muted-foreground/70"
            data-settings-subcopy
          >
            {activeOption.description}
          </p>
        </div>
        <SegmentedControl
          size="compact"
          legend={translate(locale, "platform.appearance.threadLayout")}
          onPreviewChange={setPreviewMode}
          onValueChange={setThreadViewMode}
          optionTestIdPrefix="thread-layout"
          options={THREAD_VIEW_MODE_OPTIONS}
          testId="thread-layout-control"
          value={threadViewMode}
        />
      </SettingsOptionRow>
      <ThreadLayoutPreview mode={displayedMode} />
    </div>
  );
}
