// DD-138 (design 07 §4.8.2): component preferences are ordinary Kailo settings
// items. A KAILO_EMBED release declares them; Kailo settings render them by
// Kailo category (never by component); the value is a device preference stored
// on the Kailo origin like theme and language (REQ-08) and reaches the
// declaring component page only through the wire v1 `preferences` message.
// Pure functions only, shared by the settings page and the native page host.
import type { ComponentPreferenceDeclaration } from "@client-kit/contracts";
import type { PlatformLocale } from "./i18n";

export type ComponentPreferenceValue = boolean | string;
export type ComponentPreferenceValues = Record<string, ComponentPreferenceValue>;
/** Kailo settings categories a component may contribute to (07 §4.8.2). */
export type ComponentPreferenceCategoryName = "APPEARANCE" | "NOTIFICATIONS" | "DOCUMENTS" | "ANSWERS";

export const COMPONENT_PREFERENCES_STORAGE_KEY = "kailo-component-preferences.v1";
/** Same-tab change notification; other tabs observe the `storage` event. */
export const COMPONENT_PREFERENCES_EVENT = "kailo:component-preferences";

const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,3}$/;
const OPTION = /^[A-Za-z0-9._-]{1,32}$/;
const MAX_ITEMS = 16;

function isBoolean(declaration: ComponentPreferenceDeclaration): boolean {
  return String(declaration.valueType) === "BOOLEAN";
}

/** Defensive shape check of a projected declaration (Core already validated it at registration). */
export function validDeclaration(declaration: ComponentPreferenceDeclaration): boolean {
  if (!declaration || typeof declaration.key !== "string" || declaration.key.length > 64 || !KEY.test(declaration.key)) return false;
  if (!["APPEARANCE", "NOTIFICATIONS", "DOCUMENTS", "ANSWERS"].includes(String(declaration.settingsCategory))) return false;
  if (!declaration.label || typeof declaration.label.ZH_CN !== "string" || typeof declaration.label.EN !== "string") return false;
  const options = Array.isArray(declaration.options) ? declaration.options : null;
  if (!options) return false;
  if (isBoolean(declaration)) return options.length === 0 && (declaration.defaultValue === "true" || declaration.defaultValue === "false");
  if (String(declaration.valueType) !== "ENUM" || options.length < 2 || options.length > 12) return false;
  const values = options.map((option) => option?.value);
  return values.every((value) => typeof value === "string" && OPTION.test(value))
    && new Set(values).size === values.length && values.includes(declaration.defaultValue);
}

/** Only the parts that decide the value; labels may be worded differently. */
function signature(declaration: ComponentPreferenceDeclaration): string {
  return JSON.stringify([String(declaration.settingsCategory), String(declaration.valueType),
    declaration.options.map((option) => option.value), declaration.defaultValue]);
}

/**
 * Merge the declarations of every visible binding: one control per key. A key
 * declared identically by several releases appears once and shares one value;
 * a key declared differently is not shown at all (each component keeps its own
 * default). Order follows first appearance, so the page is stable.
 */
export function mergeDeclarations(lists: ReadonlyArray<ReadonlyArray<ComponentPreferenceDeclaration> | undefined>): ComponentPreferenceDeclaration[] {
  const first = new Map<string, ComponentPreferenceDeclaration>();
  const conflicting = new Set<string>();
  for (const list of lists) {
    for (const declaration of list ?? []) {
      if (!validDeclaration(declaration)) continue;
      const seen = first.get(declaration.key);
      if (!seen) first.set(declaration.key, declaration);
      else if (signature(seen) !== signature(declaration)) conflicting.add(declaration.key);
    }
  }
  return [...first.values()].filter((declaration) => !conflicting.has(declaration.key));
}

export function declarationsIn(declarations: ReadonlyArray<ComponentPreferenceDeclaration>, category: ComponentPreferenceCategoryName): ComponentPreferenceDeclaration[] {
  return declarations.filter((declaration) => String(declaration.settingsCategory) === category);
}

/** The stored value when it is valid for this declaration, otherwise the declared default. */
export function resolveValue(declaration: ComponentPreferenceDeclaration, stored: unknown): ComponentPreferenceValue {
  if (isBoolean(declaration)) return typeof stored === "boolean" ? stored : declaration.defaultValue === "true";
  return typeof stored === "string" && declaration.options.some((option) => option.value === stored) ? stored : declaration.defaultValue;
}

/** Every declared key of one page with its effective value: the `values` of the wire message. */
export function preferenceValues(declarations: ReadonlyArray<ComponentPreferenceDeclaration> | undefined, stored: ComponentPreferenceValues): ComponentPreferenceValues {
  const values: ComponentPreferenceValues = {};
  for (const declaration of (declarations ?? []).slice(0, MAX_ITEMS)) {
    if (validDeclaration(declaration)) values[declaration.key] = resolveValue(declaration, stored[declaration.key]);
  }
  return values;
}

export function localizedText(text: { ZH_CN: string; EN: string } | undefined, locale: PlatformLocale): string {
  if (!text) return "";
  return locale === "zh-CN" ? text.ZH_CN : text.EN;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readStoredPreferences(storage: StorageLike | null | undefined): ComponentPreferenceValues {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(COMPONENT_PREFERENCES_STORAGE_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const values: ComponentPreferenceValues = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (KEY.test(key) && (typeof value === "boolean" || (typeof value === "string" && OPTION.test(value)))) values[key] = value;
    }
    return values;
  } catch {
    return {};
  }
}

/** Store one value after checking it against its declaration; returns the new map, or null when refused. */
export function writeStoredPreference(storage: StorageLike | null | undefined, declaration: ComponentPreferenceDeclaration, value: ComponentPreferenceValue): ComponentPreferenceValues | null {
  if (!storage || !validDeclaration(declaration) || resolveValue(declaration, value) !== value) return null;
  const next = { ...readStoredPreferences(storage), [declaration.key]: value };
  try {
    storage.setItem(COMPONENT_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return null;
  }
  return next;
}
