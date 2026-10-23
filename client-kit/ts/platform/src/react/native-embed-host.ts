// DD-133 host half of the component presentation protocol. The component half
// is client-kit/embed/kailo-embed.js; both speak wire version 1 only.
import { useSyncExternalStore } from "react";
import { useLocale } from "./context";
import type { PlatformLocale } from "../i18n";
import type { ComponentPreferenceValues } from "../component-preferences";

export const EMBED_PROTOCOL_VERSION = 1;

export type EmbedTheme = "light" | "dark";

export interface EmbedPresentation {
  theme: EmbedTheme;
  locale: PlatformLocale;
}

/** Messages a component page may send to Kailo. Anything else is ignored. */
export type EmbedRequest = "ready" | "auth-required";

/** Launch values ride on the approved URL; the origin is never changed. */
export function nativeEmbedUrl(url: string, presentation: EmbedPresentation): string {
  const launch = new URL(url);
  launch.searchParams.set("kailo_theme", presentation.theme);
  launch.searchParams.set("kailo_locale", presentation.locale);
  return launch.toString();
}

export function embedRequest(data: unknown): EmbedRequest | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;
  if (message.source !== "kailo-embed" || message.version !== EMBED_PROTOCOL_VERSION) return null;
  return message.type === "ready" || message.type === "auth-required" ? message.type : null;
}

export function presentationMessage(presentation: EmbedPresentation) {
  return { source: "kailo-host", version: EMBED_PROTOCOL_VERSION, type: "presentation",
    theme: presentation.theme, locale: presentation.locale } as const;
}

/**
 * DD-138 (07 §4.8.2): the values of the page's declared Kailo settings items.
 * Same version 1; a runtime that predates it ignores the unknown type.
 */
export function preferencesMessage(values: ComponentPreferenceValues) {
  return { source: "kailo-host", version: EMBED_PROTOCOL_VERSION, type: "preferences", values: { ...values } } as const;
}

// The applied appearance is the root `.dark` class in both hosts
// (useAppearance writes it for every theme), so follow that one fact.
function rootTheme(): EmbedTheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function subscribeRootTheme(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

export function useEmbedPresentation(): EmbedPresentation {
  const theme = useSyncExternalStore(subscribeRootTheme, rootTheme, (): EmbedTheme => "light");
  const locale = useLocale();
  return { theme, locale };
}
