// Original Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/settings/ui/AppearanceSettingsControls.tsx link-preview section.
import * as React from "react";
import { Eye } from "lucide-react";
import { translate, type PlatformLocale } from "../../i18n";
import { useUiLocale } from "../context";
import { SegmentedControl } from "../segmented-control";
import { SettingsOptionRow } from "../settings-option-group";
import { setLinkPreviewStyle, useLinkPreviewStyle, type LinkPreviewStyle } from "./linkPreviewStylePreference";
import { LinkPreviewAttachmentPresentation } from "./link-preview-presentation";
import type { ResolvedLinkPreview } from "./types";
import type { LinkPreviewImageLightboxProps } from "./rich-link-preview-attachment";
const linkPreviewStyleOptions = (locale: PlatformLocale): {
  value: LinkPreviewStyle;
  label: string;
  description: string;
}[] => [
  {
    value: "compact",
    label: translate(locale, "platform.appearance.compact"),
    description: translate(locale, "platform.appearance.compactDescription"),
  },
  {
    value: "rich",
    label: translate(locale, "platform.appearance.rich"),
    description: translate(locale, "platform.appearance.richDescription"),
  },
];

/**
 * Static sample used by the settings preview card. The thumbnail is an inline
 * SVG data URL so the preview needs no network fetch or native image pipeline.
 */
const linkPreviewSampleBase = (locale: PlatformLocale): Omit<ResolvedLinkPreview, "imageDataUrl"> => ({
  kind: "generic-link",
  href: "https://example.com/product-updates",
  provider: "example.com",
  title: translate(locale, "platform.appearance.sampleTitle"),
  typeLabel: "link",
  description: translate(locale, "platform.appearance.sampleDescription"),
  imageState: "image",
  imageDomain: "example.com",
});

/**
 * Build the sample thumbnail as an SVG data URL from the Buzz gradient
 * tokens. Data-URL images cannot resolve CSS variables, so the token values
 * are read from the live stylesheet and baked in per render — if the Buzz
 * gradient ever changes in `theme.css`, this preview follows automatically.
 */
function buzzGradientSampleImage(isDark: boolean): string {
  const styles = globalThis.document
    ? getComputedStyle(document.documentElement)
    : null;
  const readToken = (token: string, fallback: string): string =>
    styles?.getPropertyValue(token).trim() || fallback;
  const top = isDark
    ? readToken("--buzz-gradient-dark-top", "#4a4616")
    : readToken("--buzz-gradient-light-top", "#e6e6b6");
  const bottom = isDark
    ? readToken("--buzz-gradient-dark-bottom", "#0a1423")
    : readToken("--buzz-gradient-light-bottom", "#c4d0da");
  const shapeToken = isDark ? "--foreground" : "--background";
  const shapeFallback = isDark ? "0 0% 98%" : "0 0% 100%";
  const shape = `hsl(${readToken(shapeToken, shapeFallback)})`;
  const shapeOpacities = isDark ? [0.5, 0.38, 0.28] : [0.82, 0.68, 0.52];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 382 200"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="382" height="200" fill="url(#g)"/><rect x="76" y="64" width="72" height="72" rx="22" fill="${shape}" opacity="${shapeOpacities[0]}"/><rect x="168" y="76" width="96" height="18" rx="9" fill="${shape}" opacity="${shapeOpacities[1]}"/><rect x="168" y="106" width="138" height="18" rx="9" fill="${shape}" opacity="${shapeOpacities[2]}"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Lightbox stand-in for the settings sample — renders the image inert. */
function SampleImageLightbox({
  children,
  className,
}: LinkPreviewImageLightboxProps) {
  return <div className={className}>{children}</div>;
}

function LinkPreviewSample({ style, isDark }: { style: LinkPreviewStyle; isDark: boolean }) {
  const locale = useUiLocale();
  const preview = React.useMemo<ResolvedLinkPreview>(
    () => ({
      ...linkPreviewSampleBase(locale),
      imageDataUrl: buzzGradientSampleImage(isDark),
    }),
    [isDark, locale],
  );
  return (
    <div className="px-4 py-3" data-testid="link-preview-sample">
      <div
        aria-hidden="true"
        className="relative overflow-hidden rounded-xl border border-border/65 bg-transparent"
        data-testid="link-preview-sample-surface"
        inert
      >
        <span className="absolute right-3.5 top-3 inline-flex items-center gap-1 text-2xs font-medium text-muted-foreground/55">
          <Eye aria-hidden="true" className="size-3" />
          {translate(locale, "platform.settings.preview")}
        </span>
        <div className="p-4 pr-24">
          <LinkPreviewAttachmentPresentation
            ImageLightbox={SampleImageLightbox}
            preview={preview}
            showExpandControl={false}
            style={style}
          />
        </div>
      </div>
    </div>
  );
}

export function LinkPreviewStyleSetting({ isDark }: { isDark: boolean }) {
  const locale = useUiLocale();
  const LINK_PREVIEW_STYLE_OPTIONS = linkPreviewStyleOptions(locale);
  const style = useLinkPreviewStyle();
  const [previewStyle, setPreviewStyle] =
    React.useState<LinkPreviewStyle | null>(null);
  const displayedStyle = previewStyle ?? style;
  const activeOption =
    LINK_PREVIEW_STYLE_OPTIONS.find(
      (option) => option.value === displayedStyle,
    ) ?? LINK_PREVIEW_STYLE_OPTIONS[0]!;

  return (
    <div data-testid="link-preview-style-group">
      <SettingsOptionRow>
        <div className="min-w-0">
          <p className="text-sm font-medium">{translate(locale, "platform.appearance.linkPreviews")}</p>
          <p
            className="text-sm font-normal text-muted-foreground/70"
            data-settings-subcopy
          >
            {activeOption.description}
          </p>
        </div>
        <SegmentedControl
          size="compact"
          legend={translate(locale, "platform.appearance.linkPreviews")}
          onPreviewChange={setPreviewStyle}
          onValueChange={setLinkPreviewStyle}
          optionTestIdPrefix="link-preview-style"
          options={LINK_PREVIEW_STYLE_OPTIONS}
          testId="link-preview-style-control"
          value={style}
        />
      </SettingsOptionRow>
      <LinkPreviewSample style={displayedStyle} isDark={isDark} />
    </div>
  );
}
