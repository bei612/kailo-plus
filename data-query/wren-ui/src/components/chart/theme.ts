import type { Config } from 'vega-lite';

// DD-167 (`20` §15.2 第三方渲染面): Vega draws SVG attributes, so the Kailo
// tokens are read from the document when a chart is built and the chart is
// rebuilt whenever the theme, locale, text size or zoom changes
// (useKailoSession().presentationKey). Canvas transparent, text foreground /
// muted-foreground, grid and axes border, series chart-1…5, the Kailo font,
// sizes on the Kailo type scale. Without a document (server, unit tests) the
// light values below are used.

export interface ChartTokens {
  foreground: string;
  muted: string;
  border: string;
  background: string;
  font: string;
  series: string[];
}

const LIGHT: ChartTokens = {
  foreground: 'hsl(240, 13.73%, 10%)',
  muted: 'hsl(234.5, 4.93%, 43.7%)',
  border: 'hsl(240, 13.73%, 90%)',
  background: 'hsl(0, 0%, 100%)',
  font: 'Inter Variable, Inter, system-ui, sans-serif',
  series: [
    'hsl(247.7, 98.6%, 72%)',
    'hsl(202.3, 94.04%, 46.1%)',
    'hsl(153.7, 95.29%, 33.3%)',
    'hsl(38.8, 96.55%, 45.5%)',
    'hsl(286.4, 67.49%, 60.2%)',
  ],
};

/** "H S% L%" (a --kailo-hsl-* triplet) as a comma hsl() every parser reads. */
export function hslOf(triplet: string): string | null {
  const parts = triplet.trim().split(/[\s,]+/);
  if (parts.length < 3) return null;
  const [h, s, l] = parts;
  if (!/^-?[\d.]+$/.test(h) || !/^[\d.]+%$/.test(s) || !/^[\d.]+%$/.test(l))
    return null;
  return `hsl(${h}, ${s}, ${l})`;
}

/** The same hue with its lightness moved, for series six to ten. */
export function shiftLightness(color: string, delta: number): string {
  const match = color.match(/^hsl\(([-\d.]+), ([\d.]+)%, ([\d.]+)%\)$/);
  if (!match) return color;
  const l = Math.max(18, Math.min(86, Number(match[3]) + delta));
  return `hsl(${match[1]}, ${match[2]}%, ${Number(l.toFixed(1))}%)`;
}

export function readChartTokens(): ChartTokens {
  if (typeof window === 'undefined' || !window.getComputedStyle) return LIGHT;
  const style = window.getComputedStyle(document.documentElement);
  const hsl = (name: string, fallback: string) =>
    hslOf(style.getPropertyValue(`--kailo-hsl-${name}`)) || fallback;
  const font = style.getPropertyValue('--kailo-font-sans').trim();
  return {
    foreground: hsl('foreground', LIGHT.foreground),
    muted: hsl('muted-foreground', LIGHT.muted),
    border: hsl('border', LIGHT.border),
    background: hsl('background', LIGHT.background),
    font: font || LIGHT.font,
    series: LIGHT.series.map((fallback, index) =>
      hsl(`chart-${index + 1}`, fallback),
    ),
  };
}

/** Ten series colours: chart-1…5, then the same hues lighter or darker. */
export function chartPalette(tokens: ChartTokens, dark: boolean): string[] {
  return [
    ...tokens.series,
    ...tokens.series.map((color) => shiftLightness(color, dark ? -18 : 16)),
  ];
}

export function isDarkTheme(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-kailo-theme') === 'dark'
  );
}

/**
 * The Vega-Lite config of a chart for the current Kailo presentation.
 * typeScale: 13/14, 1 or 15/14 (Kailo text size); sizes are the Kailo
 * caption (12) for labels and headline (15) for the title.
 */
export function kailoChartConfig(
  base: Config,
  options: { typeScale?: number; tokens?: ChartTokens; dark?: boolean } = {},
): Config {
  const tokens = options.tokens || readChartTokens();
  const scale =
    options.typeScale && Number.isFinite(options.typeScale)
      ? options.typeScale
      : 1;
  const size = (px: number) => Math.round(px * scale * 10) / 10;
  const palette = chartPalette(tokens, options.dark ?? isDarkTheme());
  return {
    ...base,
    background: 'transparent',
    font: tokens.font,
    view: { stroke: 'transparent' },
    title: {
      ...(base.title as object),
      color: tokens.foreground,
      font: tokens.font,
      fontSize: size(15),
      fontWeight: 600,
      anchor: 'start',
      offset: 12,
    },
    axis: {
      ...base.axis,
      gridColor: tokens.border,
      gridOpacity: 1,
      domainColor: tokens.border,
      tickColor: tokens.border,
      titleColor: tokens.muted,
      titleFont: tokens.font,
      titleFontSize: size(12),
      titleFontWeight: 500,
      labelColor: tokens.muted,
      labelFont: tokens.font,
      labelFontSize: size(12),
    },
    legend: {
      ...base.legend,
      labelColor: tokens.foreground,
      labelFont: tokens.font,
      labelFontSize: size(12),
      titleColor: tokens.muted,
      titleFont: tokens.font,
      titleFontSize: size(12),
      titleFontWeight: 500,
    },
    arc: { stroke: tokens.background, strokeWidth: 1 },
    line: { ...(base.line as object), color: palette[0], strokeWidth: 2 },
    bar: { ...(base.bar as object), color: palette[0] },
    point: { ...(base.point as object), color: palette[0] },
    area: { color: palette[0], opacity: 0.7 },
    range: {
      category: palette,
      ordinal: palette,
      symbol: palette,
      diverging: palette,
      heatmap: palette,
      ramp: palette,
    },
  };
}
