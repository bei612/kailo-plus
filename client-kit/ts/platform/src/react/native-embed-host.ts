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

// ── DD-152 (07 §4.8.7): page shell messages, same wire version 1 ─────────────
// Bounds and vocabularies mirror client-kit/embed/kailo-embed.js; the host
// re-validates every message and drops an invalid one whole.

export const EMBED_FEATURES = ["page", "toast", "confirm", "shortcuts"] as const;
export type EmbedFeature = (typeof EMBED_FEATURES)[number];
export const EMBED_ACTION_ICONS = ["upload", "plus", "folder-plus", "share", "download", "rocket", "refresh", "settings",
  "message-square-plus", "play", "trash", "pencil", "filter", "search", "more"] as const;
export type EmbedActionIcon = (typeof EMBED_ACTION_ICONS)[number];
export type EmbedShortcut = "search" | "settings" | "back" | "forward";

export interface EmbedPageItem { id: string; label: string }
export interface EmbedPageAction { id: string; label: string; variant: "primary" | "secondary" | "menu"; icon?: EmbedActionIcon; disabled?: boolean; busy?: boolean }
export interface EmbedPage { title: string; breadcrumbs: EmbedPageItem[]; tabs: EmbedPageItem[]; activeTab?: string; actions: EmbedPageAction[] }
export interface EmbedToast { tone: "success" | "info" | "warning" | "error"; title: string; description?: string }
export interface EmbedConfirm { id: string; tone: "default" | "danger"; title: string; description?: string; confirmLabel?: string; cancelLabel?: string }

export type EmbedMessage =
  | { type: "ready"; features: EmbedFeature[] }
  | { type: "auth-required" }
  | { type: "page"; page: EmbedPage | null }
  | { type: "toast"; toast: EmbedToast }
  | { type: "confirm"; confirm: EmbedConfirm }
  | { type: "shortcut"; shortcut: EmbedShortcut };

const CONTROL = /[\u0000-\u001f\u007f]/;

function displayText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text && text.length <= max && !CONTROL.test(text) ? text : null;
}

function optionalText(value: unknown, max: number): string | undefined | null {
  return value === undefined ? undefined : displayText(value, max);
}

function opaqueId(value: unknown): string | null {
  return typeof value === "string" && value.length >= 1 && value.length <= 256 && !CONTROL.test(value) ? value : null;
}

function pageItems(value: unknown, max: number, label: number): EmbedPageItem[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  const out: EmbedPageItem[] = [];
  for (const item of value as Record<string, unknown>[]) {
    const id = opaqueId(item?.id);
    const text = displayText(item?.label, label);
    if (!id || !text) return null;
    out.push({ id, label: text });
  }
  return out;
}

const member = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : null;

export function parseEmbedPage(value: unknown): EmbedPage | null {
  if (typeof value !== "object" || value === null) return null;
  const page = value as Record<string, unknown>;
  const title = displayText(page.title, 120);
  const breadcrumbs = pageItems(page.breadcrumbs, 8, 80);
  const tabs = pageItems(page.tabs, 8, 40);
  if (!title || !breadcrumbs || !tabs) return null;
  const activeTab = page.activeTab === undefined ? undefined : opaqueId(page.activeTab);
  if (activeTab === null || (activeTab !== undefined && !tabs.some((tab) => tab.id === activeTab))) return null;
  const list = page.actions === undefined ? [] : page.actions;
  if (!Array.isArray(list) || list.length > 8) return null;
  const actions: EmbedPageAction[] = [];
  for (const raw of list as Record<string, unknown>[]) {
    const id = opaqueId(raw?.id);
    const label = displayText(raw?.label, 40);
    const variant = member(raw?.variant ?? "secondary", ["primary", "secondary", "menu"] as const);
    const icon = raw?.icon === undefined ? undefined : member(raw.icon, EMBED_ACTION_ICONS);
    if (!id || !label || !variant || icon === null || actions.some((action) => action.id === id)) return null;
    actions.push({ id, label, variant, ...(icon ? { icon } : {}), ...(raw.disabled === true ? { disabled: true } : {}), ...(raw.busy === true ? { busy: true } : {}) });
  }
  if (actions.filter((action) => action.variant === "primary").length > 1) return null;
  return { title, breadcrumbs, tabs, ...(activeTab ? { activeTab } : {}), actions };
}

function parseToast(value: unknown): EmbedToast | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const tone = member(raw.tone ?? "info", ["success", "info", "warning", "error"] as const);
  const title = displayText(raw.title, 120);
  const description = optionalText(raw.description, 280);
  if (!tone || !title || description === null) return null;
  return { tone, title, ...(description ? { description } : {}) };
}

function parseConfirm(value: unknown): EmbedConfirm | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(raw.id) ? raw.id : null;
  const tone = member(raw.tone ?? "default", ["default", "danger"] as const);
  const title = displayText(raw.title, 120);
  const description = optionalText(raw.description, 400);
  const confirmLabel = optionalText(raw.confirmLabel, 24);
  const cancelLabel = optionalText(raw.cancelLabel, 24);
  if (!id || !tone || !title || description === null || confirmLabel === null || cancelLabel === null) return null;
  return { id, tone, title, ...(description ? { description } : {}), ...(confirmLabel ? { confirmLabel } : {}), ...(cancelLabel ? { cancelLabel } : {}) };
}

/** Every component → Kailo message of wire v1 (DD-133, DD-152); null for anything else. */
export function embedMessage(data: unknown): EmbedMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;
  if (message.source !== "kailo-embed" || message.version !== EMBED_PROTOCOL_VERSION) return null;
  switch (message.type) {
    case "ready": {
      const features = Array.isArray(message.features)
        ? EMBED_FEATURES.filter((feature) => (message.features as unknown[]).includes(feature)) : [];
      return { type: "ready", features };
    }
    case "auth-required": return { type: "auth-required" };
    case "page": {
      if (message.page === null) return { type: "page", page: null };
      const page = parseEmbedPage(message.page);
      return page ? { type: "page", page } : null;
    }
    case "toast": { const toast = parseToast(message.toast); return toast ? { type: "toast", toast } : null; }
    case "confirm": { const confirm = parseConfirm(message.confirm); return confirm ? { type: "confirm", confirm } : null; }
    case "shortcut": {
      const shortcut = member(message.shortcut, ["search", "settings", "back", "forward"] as const);
      return shortcut ? { type: "shortcut", shortcut } : null;
    }
    default: return null;
  }
}

export function navigateMessage(kind: "tab" | "breadcrumb", id: string) {
  return { source: "kailo-host", version: EMBED_PROTOCOL_VERSION, type: "navigate", target: { kind, id } } as const;
}

export function actionMessage(id: string) {
  return { source: "kailo-host", version: EMBED_PROTOCOL_VERSION, type: "action", id } as const;
}

export function confirmResultMessage(id: string, confirmed: boolean) {
  return { source: "kailo-host", version: EMBED_PROTOCOL_VERSION, type: "confirm-result", id, confirmed } as const;
}

/**
 * A Kailo global chord pressed inside the frame, replayed on the host window so the
 * host's own shortcut handlers (search, settings, history) run exactly as for a key
 * pressed in Kailo itself (DD-152, 07 §4.8.7).
 */
export function replayShortcut(shortcut: EmbedShortcut, mac: boolean, target: Window = window): void {
  const primary = mac ? { metaKey: true } : { ctrlKey: true };
  const init: KeyboardEventInit = shortcut === "search" ? { key: "k", code: "KeyK", ...primary }
    : shortcut === "settings" ? { key: ",", code: "Comma", ...primary }
    : mac ? { key: shortcut === "back" ? "[" : "]", code: shortcut === "back" ? "BracketLeft" : "BracketRight", metaKey: true }
    : { key: shortcut === "back" ? "ArrowLeft" : "ArrowRight", code: shortcut === "back" ? "ArrowLeft" : "ArrowRight", altKey: true };
  target.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }));
}

/** Launch values ride on the approved URL; the origin is never changed. */
export function nativeEmbedUrl(url: string, presentation: EmbedPresentation): string {
  const launch = new URL(url);
  launch.searchParams.set("kailo_theme", presentation.theme);
  launch.searchParams.set("kailo_locale", presentation.locale);
  return launch.toString();
}

export function embedRequest(data: unknown): EmbedRequest | null {
  const message = embedMessage(data);
  return message?.type === "ready" || message?.type === "auth-required" ? message.type : null;
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
