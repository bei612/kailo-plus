// DD-138 (design 07 §4.8.2): component preferences inside Kailo settings.
// The items appear in the Kailo category their release declares, mixed with
// Kailo's own items; no component name, section or "connected services" list.
import { useCallback, useSyncExternalStore } from "react";
import { ApplicationBindingState, type ApplicationBindingPage, type ComponentPreferenceDeclaration } from "@client-kit/contracts";
import { translate } from "../i18n";
import {
  COMPONENT_PREFERENCES_EVENT, COMPONENT_PREFERENCES_STORAGE_KEY, declarationsIn, localizedText, mergeDeclarations,
  readStoredPreferences, resolveValue, writeStoredPreference,
  type ComponentPreferenceCategoryName, type ComponentPreferenceValue, type ComponentPreferenceValues,
} from "../component-preferences";
import { useOptionalBffClient, useUiLocale } from "./context";
import { useLoad, type Loaded } from "./use-load";
import { SegmentedControl } from "./segmented-control";
import { SettingsOptionGroup, SettingsOptionRow } from "./settings-option-group";
import { SettingsSectionHeader } from "./settings-surface";
import { Switch } from "./switch";

function storage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

let cache: { raw: string | null; values: ComponentPreferenceValues } = { raw: null, values: {} };
function snapshot(): ComponentPreferenceValues {
  let raw: string | null = null;
  try { raw = storage()?.getItem(COMPONENT_PREFERENCES_STORAGE_KEY) ?? null; } catch { raw = null; }
  if (raw !== cache.raw) cache = { raw, values: readStoredPreferences(storage()) };
  return cache.values;
}
function subscribe(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === COMPONENT_PREFERENCES_STORAGE_KEY) onChange(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener(COMPONENT_PREFERENCES_EVENT, onChange);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(COMPONENT_PREFERENCES_EVENT, onChange); };
}
const EMPTY: ComponentPreferenceValues = {};

/** Device-stored values (REQ-08 rule), shared by every tab of this Kailo origin. */
export function useStoredComponentPreferences(): ComponentPreferenceValues {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

export function setComponentPreference(declaration: ComponentPreferenceDeclaration, value: ComponentPreferenceValue): boolean {
  const next = writeStoredPreference(storage(), declaration, value);
  if (!next) return false;
  window.dispatchEvent(new Event(COMPONENT_PREFERENCES_EVENT));
  return true;
}

const MAX_PAGES = 20;

/**
 * Declarations of every ACTIVE native page binding the member can discover at
 * Tenant scope (and the given Workspace), merged by key. A failed read is a
 * failure, not "no items"; without a platform session there is nothing to read.
 */
export function useContributedPreferences(workspaceId?: string): [Loaded<ComponentPreferenceDeclaration[]>, () => void] {
  const client = useOptionalBffClient();
  return useLoad(`component-preferences:${client ? "session" : "none"}:${workspaceId ?? ""}`, async () => {
    if (!client) return [];
    const lists: ComponentPreferenceDeclaration[][] = [];
    for (const scope of workspaceId ? [undefined, workspaceId] : [undefined]) {
      let offset: number | undefined = 0;
      for (let page = 0; offset !== undefined && page < MAX_PAGES; page += 1) {
        const read: ApplicationBindingPage = await client.applicationBindings(scope, offset ?? 0);
        for (const binding of read.bindings) {
          if (binding.state === ApplicationBindingState.Active && binding.hasNativePage === true && binding.preferences?.length)
            lists.push(binding.preferences);
        }
        offset = read.nextOffset;
      }
    }
    return mergeDeclarations(lists);
  });
}

/** The categories that have contributed items (DOCUMENTS and ANSWERS exist only then). */
export function contributedCategories(state: Loaded<ComponentPreferenceDeclaration[]>): Set<ComponentPreferenceCategoryName> {
  const categories = new Set<ComponentPreferenceCategoryName>();
  if (state.status === "ok") for (const declaration of state.data) categories.add(String(declaration.settingsCategory) as ComponentPreferenceCategoryName);
  return categories;
}

function PreferenceRow({ declaration }: { declaration: ComponentPreferenceDeclaration }) {
  const locale = useUiLocale();
  const stored = useStoredComponentPreferences();
  const value = resolveValue(declaration, stored[declaration.key]);
  const id = `preference-${declaration.key.replace(/\./g, "-")}`;
  const label = localizedText(declaration.label, locale);
  const description = localizedText(declaration.description, locale);
  const change = useCallback((next: ComponentPreferenceValue) => { setComponentPreference(declaration, next); }, [declaration]);
  return <SettingsOptionRow data-testid={id}>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium" id={`${id}-label`}>{label}</p>
      {description ? <p className="text-xs text-muted-foreground/70" data-settings-subcopy>{description}</p> : null}
    </div>
    {typeof value === "boolean"
      ? <Switch aria-labelledby={`${id}-label`} checked={value} data-testid={`${id}-switch`} onCheckedChange={change} />
      : <SegmentedControl size={declaration.options.length > 3 ? "wide" : "default"} legend={label} onValueChange={change}
          optionTestIdPrefix={id} testId={`${id}-control`} value={value}
          options={declaration.options.map((option) => ({ value: option.value, label: localizedText(option.label, locale) }))} />}
  </SettingsOptionRow>;
}

/** Contributed items of one Kailo category, rendered as Kailo's own rows. */
export function ContributedPreferenceItems({ declarations, category }: {
  declarations: ReadonlyArray<ComponentPreferenceDeclaration>; category: ComponentPreferenceCategoryName;
}) {
  const items = declarationsIn(declarations, category);
  if (items.length === 0) return null;
  return <SettingsOptionGroup data-testid={`settings-contributed-${category.toLowerCase()}`}>
    {items.map((declaration) => <PreferenceRow key={declaration.key} declaration={declaration} />)}
  </SettingsOptionGroup>;
}

/** A Kailo settings section whose items all come from declarations (documents, answers). */
export function ContributedPreferenceSection({ declarations, category, titleKey, descriptionKey }: {
  declarations: ReadonlyArray<ComponentPreferenceDeclaration>; category: ComponentPreferenceCategoryName;
  titleKey: "platform.settings.documents" | "platform.settings.answers";
  descriptionKey: "platform.settings.documentsDescription" | "platform.settings.answersDescription";
}) {
  const locale = useUiLocale();
  return <section className="min-w-0" data-testid={`settings-${category.toLowerCase()}`}>
    <SettingsSectionHeader title={translate(locale, titleKey)} description={translate(locale, descriptionKey)} />
    {declarationsIn(declarations, category).length
      ? <ContributedPreferenceItems declarations={declarations} category={category} />
      : <p className="text-sm text-muted-foreground" role="status">{translate(locale, "platform.settings.noItems")}</p>}
  </section>;
}
