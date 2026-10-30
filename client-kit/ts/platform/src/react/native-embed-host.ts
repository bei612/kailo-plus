// DD-133 host half of the component presentation protocol. The component half
// is client-kit/embed/kailo-embed.js; both speak wire version 1 only.
import { useSyncExternalStore } from "react";
import { useLocale } from "./context";
import type { PlatformLocale } from "../i18n";
import type { ComponentPreferenceValues } from "../component-preferences";
import { parseFontSize, type FontSize } from "../fontSizePreference";

export const EMBED_PROTOCOL_VERSION = 1;

export type EmbedTheme = "light" | "dark";

/**
 * DD-167(3): Kailo's two type dials follow the component as well. `fontSize` is the
 * text-only preference (13 / 14 / 15 px body); `zoom` is the ⌘± scale of every rem
 * (0.75–1.5 in 0.1 steps). Both are display facts like the theme, never user data.
 */
export type EmbedFontSize = FontSize;
export const EMBED_ZOOM_MIN = 0.75;
export const EMBED_ZOOM_MAX = 1.5;

export interface EmbedPresentation {
  theme: EmbedTheme;
  locale: PlatformLocale;
  /** Omitted means "default" (a caller that predates DD-167). */
  fontSize?: EmbedFontSize;
  /** Omitted means 1. */
  zoom?: number;
}

/** A zoom factor on the wire: finite, inside the bounds, one decimal; anything else is 1. */
export function embedZoom(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  const rounded = Math.round(value * 100) / 100;
  return rounded >= EMBED_ZOOM_MIN && rounded <= EMBED_ZOOM_MAX ? rounded : 1;
}

/** Messages a component page may send to Kailo. Anything else is ignored. */
export type EmbedRequest = "ready" | "auth-required";

// ── DD-157 (07 §4.8.7): page shell messages, same wire version 1 ─────────────
// Bounds and vocabularies mirror client-kit/embed/kailo-embed.js; the host
// re-validates every message and drops an invalid one whole.

export const EMBED_FEATURES = ["page", "toast", "confirm", "shortcuts", "prompt"] as const;
export type EmbedFeature = (typeof EMBED_FEATURES)[number];
export const EMBED_ACTION_ICONS = ["upload", "plus", "folder-plus", "share", "download", "rocket", "refresh", "settings",
  "message-square-plus", "play", "trash", "pencil", "filter", "search", "more"] as const;
export type EmbedActionIcon = (typeof EMBED_ACTION_ICONS)[number];
export type EmbedShortcut = "search" | "settings" | "back" | "forward";

export interface EmbedPageItem { id: string; label: string }
export interface EmbedFilePick { accept?: string; multiple?: boolean; directory?: boolean }
export interface EmbedPageAction { id: string; label: string; variant: "primary" | "secondary" | "menu"; icon?: EmbedActionIcon; files?: EmbedFilePick; disabled?: boolean; busy?: boolean }
export interface EmbedPage { title: string; breadcrumbs: EmbedPageItem[]; tabs: EmbedPageItem[]; activeTab?: string; actions: EmbedPageAction[] }
export interface EmbedToast { tone: "success" | "info" | "warning" | "error"; title: string; description?: string }
/** One unchecked choice inside the confirmation (acceptance batch 5: Cells "delete permanently"). */
export interface EmbedConfirmOption { label: string; warning?: string }
export interface EmbedConfirm { id: string; tone: "default" | "danger"; title: string; description?: string; confirmLabel?: string; cancelLabel?: string; option?: EmbedConfirmOption }
/**
 * DD-167(5): one short text the component needs from the user (a new folder's name), asked in
 * Kailo's dialog so the overlay covers the whole window. `value` is the initial text; the answer
 * goes back to this frame only and is never stored, logged or sent anywhere by Kailo.
 */
export interface EmbedPrompt { id: string; title: string; description?: string; label: string; placeholder?: string; value?: string; confirmLabel?: string; cancelLabel?: string; maxLength: number }
export const EMBED_PROMPT_MAX = 255;

export type EmbedMessage =
  | { type: "ready"; features: EmbedFeature[] }
  | { type: "auth-required" }
  | { type: "page"; page: EmbedPage | null }
  | { type: "toast"; toast: EmbedToast }
  | { type: "confirm"; confirm: EmbedConfirm }
  | { type: "prompt"; prompt: EmbedPrompt }
  | { type: "shortcut"; shortcut: EmbedShortcut };

const CONTROL = /[\u0000-\u001f\u007f]/;

function displayText(value: unknown, max: number): string | null {
  if (typeof value !== "string" || CONTROL.test(value)) return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text && text.length <= max ? text : null;
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
    let files: EmbedFilePick | undefined;
    if (raw.files !== undefined) {
      // DD-157: a file-choosing action; Kailo opens its picker inside the user's click.
      const pick = raw.files as Record<string, unknown> | null;
      if (typeof pick !== "object" || pick === null) return null;
      if (pick.accept !== undefined && !(typeof pick.accept === "string" && /^[A-Za-z0-9.+\-/*, ]{1,200}$/.test(pick.accept))) return null;
      files = { ...(pick.accept ? { accept: pick.accept as string } : {}), ...(pick.multiple === true ? { multiple: true } : {}),
        ...(pick.directory === true ? { directory: true } : {}) };
    }
    actions.push({ id, label, variant, ...(icon ? { icon } : {}), ...(files ? { files } : {}),
      ...(raw.disabled === true ? { disabled: true } : {}), ...(raw.busy === true ? { busy: true } : {}) });
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
  let option: EmbedConfirmOption | undefined;
  if (raw.option !== undefined) {
    if (typeof raw.option !== "object" || raw.option === null) return null;
    const choice = raw.option as Record<string, unknown>;
    const label = displayText(choice.label, 80);
    const warning = optionalText(choice.warning, 200);
    if (!label || warning === null) return null;
    option = { label, ...(warning ? { warning } : {}) };
  }
  return { id, tone, title, ...(description ? { description } : {}), ...(confirmLabel ? { confirmLabel } : {}), ...(cancelLabel ? { cancelLabel } : {}),
    ...(option ? { option } : {}) };
}

function parsePrompt(value: unknown): EmbedPrompt | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(raw.id) ? raw.id : null;
  const title = displayText(raw.title, 120);
  const label = displayText(raw.label, 80);
  const description = optionalText(raw.description, 400);
  const placeholder = optionalText(raw.placeholder, 80);
  const confirmLabel = optionalText(raw.confirmLabel, 24);
  const cancelLabel = optionalText(raw.cancelLabel, 24);
  const maxLength = raw.maxLength === undefined ? EMBED_PROMPT_MAX
    : typeof raw.maxLength === "number" && Number.isInteger(raw.maxLength) && raw.maxLength >= 1 && raw.maxLength <= EMBED_PROMPT_MAX ? raw.maxLength : null;
  // The initial text may be empty; it is display text like the rest and never longer than the answer may be.
  const initial = raw.value === undefined || raw.value === "" ? undefined
    : typeof raw.value === "string" && !CONTROL.test(raw.value) && maxLength !== null && raw.value.length <= maxLength ? raw.value : null;
  if (!id || !title || !label || description === null || placeholder === null || confirmLabel === null || cancelLabel === null
    || maxLength === null || initial === null) return null;
  return { id, title, label, maxLength, ...(description ? { description } : {}), ...(placeholder ? { placeholder } : {}),
    ...(initial !== undefined ? { value: initial } : {}), ...(confirmLabel ? { confirmLabel } : {}), ...(cancelLabel ? { cancelLabel } : {}) };
}

/** Every component → Kailo message of wire v1 (DD-133, DD-157); null for anything else. */
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
    case "prompt": { const prompt = parsePrompt(message.prompt); return prompt ? { type: "prompt", prompt } : null; }
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

/** At most this many files travel with one action (07 §4.8.7). */
export const EMBED_MAX_FILES = 1000;

export function actionMessage(id: string, selection?: { files: File[]; paths: string[] }) {
  return selection
    ? { source: "kailo-host", version: EMBED_PROTOCOL_VERSION, type: "action", id, files: selection.files, paths: selection.paths } as const
    : { source: "kailo-host", version: EMBED_PROTOCOL_VERSION, type: "action", id } as const;
}

/**
 * DD-157: open Kailo's file picker for a header action inside the user's click (the frame
 * never receives the host's user activation). Resolves with the chosen files and their
 * relative paths; nothing is read, stored or uploaded by Kailo.
 */
export function pickFiles(pick: EmbedFilePick, onPicked: (selection: { files: File[]; paths: string[] }) => void, onTooMany: () => void): void {
  const input = document.createElement("input");
  input.type = "file";
  if (pick.accept) input.accept = pick.accept;
  input.multiple = pick.multiple === true || pick.directory === true;
  if (pick.directory) input.setAttribute("webkitdirectory", "");
  input.addEventListener("change", () => {
    const files = [...(input.files ?? [])];
    if (!files.length) return;
    if (files.length > EMBED_MAX_FILES) { onTooMany(); return; }
    onPicked({ files, paths: files.map((file) => file.webkitRelativePath || file.name) });
  }, { once: true });
  input.click();
}

/** `option` is sent only for a confirmation that carried a choice; it is never true on a cancel. */
export function confirmResultMessage(id: string, confirmed: boolean, option?: boolean) {
  return option === undefined
    ? { source: "kailo-host", version: EMBED_PROTOCOL_VERSION, type: "confirm-result", id, confirmed } as const
    : { source: "kailo-host", version: EMBED_PROTOCOL_VERSION, type: "confirm-result", id, confirmed, option: confirmed && option } as const;
}

/**
 * DD-167(5): the answer to a prompt. `value` only on a confirmation, trimmed, 1..maxLength
 * characters without control characters (the dialog enforces it before it can be confirmed).
 */
export function promptResultMessage(id: string, value: string | null) {
  return value === null
    ? { source: "kailo-host", version: EMBED_PROTOCOL_VERSION, type: "prompt-result", id, confirmed: false } as const
    : { source: "kailo-host", version: EMBED_PROTOCOL_VERSION, type: "prompt-result", id, confirmed: true, value } as const;
}

/** A prompt answer Kailo may return: trimmed, non-empty, within the bound, no control characters. */
export function promptAnswer(prompt: EmbedPrompt, text: string): string | null {
  const value = text.trim();
  return value && value.length <= prompt.maxLength && !CONTROL.test(value) ? value : null;
}

/**
 * A Kailo global chord pressed inside the frame, replayed on the host window so the
 * host's own shortcut handlers (search, settings, history) run exactly as for a key
 * pressed in Kailo itself (DD-157, 07 §4.8.7).
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
  // DD-167(3): only a non-default dial rides on the URL; a Kailo launch without it means "default".
  const fontSize = presentation.fontSize ?? "default";
  const zoom = embedZoom(presentation.zoom ?? 1);
  if (fontSize !== "default") launch.searchParams.set("kailo_font_size", fontSize);
  if (zoom !== 1) launch.searchParams.set("kailo_zoom", String(zoom));
  return launch.toString();
}

export function embedRequest(data: unknown): EmbedRequest | null {
  const message = embedMessage(data);
  return message?.type === "ready" || message?.type === "auth-required" ? message.type : null;
}

export function presentationMessage(presentation: EmbedPresentation) {
  return { source: "kailo-host", version: EMBED_PROTOCOL_VERSION, type: "presentation",
    theme: presentation.theme, locale: presentation.locale, fontSize: presentation.fontSize ?? "default", zoom: embedZoom(presentation.zoom ?? 1),
    features: [...EMBED_FEATURES, "files", "confirm-option"] } as const;
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

// DD-167(3): both hosts apply the type dials to their own root — `data-font-size`
// (fontSizePreference) and the inline root font-size of ⌘± zoom (use-text-scale-shortcuts).
// The applied values are the one fact the frame follows, exactly like the `.dark` class.
function rootFontSize(): EmbedFontSize {
  return parseFontSize(document.documentElement.getAttribute("data-font-size"));
}

function rootZoom(): number {
  const inline = document.documentElement.style.fontSize;
  const px = inline.endsWith("px") ? Number.parseFloat(inline) : Number.NaN;
  return Number.isFinite(px) ? embedZoom(Math.round((px / 16) * 10) / 10) : 1;
}

function subscribeRootType(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-font-size", "style"] });
  return () => observer.disconnect();
}

export function useEmbedPresentation(): EmbedPresentation {
  const theme = useSyncExternalStore(subscribeRootTheme, rootTheme, (): EmbedTheme => "light");
  const fontSize = useSyncExternalStore(subscribeRootType, rootFontSize, (): EmbedFontSize => "default");
  const zoom = useSyncExternalStore(subscribeRootType, rootZoom, () => 1);
  const locale = useLocale();
  return { theme, locale, fontSize, zoom };
}
