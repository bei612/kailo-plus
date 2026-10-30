// DD-164(7) (design 07 §4.8.2): theme, language and component preferences are
// account preferences. Core's AccountPreferences (one per HumanIdentity, every
// Tenant and device) is the authority; this device's stores are its cache and
// first-paint value. The sync reads Core after sign-in and whenever the window
// regains focus, applies what Core says, and writes the user's own edits to Core
// with compare-and-swap. A conflict re-reads Core and replays only that edit.
// Core being unreachable never blocks the interface: the cache stays in force
// and pending edits are written on the next successful read.
import type { AccountPreferences, AccountPreferencesUpdate } from "@client-kit/contracts";
import {
  ACCOUNT_PREFERENCE_EDIT_EVENT, asAccountPreferenceApply,
  type AccountPreferenceEdit, type AccountPreferenceLocale,
} from "./account-preference-events";
import {
  COMPONENT_PREFERENCES_EVENT, COMPONENT_PREFERENCES_STORAGE_KEY, readStoredPreferences, type ComponentPreferenceValues,
} from "./component-preferences";
import { getLocale, platformLocaleStorageKey, setLocale } from "./i18n";
import { applyAccountAppearance, isAccountAccent, readStoredAppearance } from "./theme/use-appearance";
import { BffError } from "./transport";

export interface AccountPreferenceApi {
  accountPreferences(): Promise<AccountPreferences>;
  updateAccountPreferences(body: AccountPreferencesUpdate): Promise<AccountPreferences>;
}

const KEY = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,3}$/;
const OPTION = /^[A-Za-z0-9._-]{1,32}$/;
const THEME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_COMPONENT_KEYS = 64;
const MAX_CONFLICT_REPLAYS = 3;

function localeOf(value: unknown): AccountPreferenceLocale | undefined {
  return value === "zh-CN" || value === "en" ? value : undefined;
}

/** b wins over a; component values are merged by key. */
export function mergeAccountEdits(a: AccountPreferenceEdit | null, b: AccountPreferenceEdit | null): AccountPreferenceEdit | null {
  if (!a) return b ? { ...b, ...(b.componentPreferences ? { componentPreferences: { ...b.componentPreferences } } : {}) } : null;
  if (!b) return mergeAccountEdits(b, a);
  const merged: AccountPreferenceEdit = { ...a, ...b };
  if (a.componentPreferences || b.componentPreferences)
    merged.componentPreferences = { ...(a.componentPreferences ?? {}), ...(b.componentPreferences ?? {}) };
  return merged;
}

/** Only well-formed values travel to Core (it validates the same forms). */
export function accountUpdate(expectedVersion: number, edit: AccountPreferenceEdit): AccountPreferencesUpdate {
  const update: Record<string, unknown> = { expectedVersion };
  if (edit.theme !== undefined && THEME.test(edit.theme)) update.theme = edit.theme;
  if (edit.accent !== undefined && isAccountAccent(edit.accent)) update.accent = edit.accent;
  if (edit.followSystem !== undefined) update.followSystem = edit.followSystem;
  if (edit.locale !== undefined) update.locale = edit.locale;
  if (edit.componentPreferences) {
    const values: Record<string, boolean | string | null> = {};
    for (const [key, value] of Object.entries(edit.componentPreferences)) {
      if (KEY.test(key) && key.length <= 64 && (value === null || typeof value === "boolean" || (typeof value === "string" && OPTION.test(value))))
        values[key] = value;
    }
    if (Object.keys(values).length) update.componentPreferences = values;
  }
  return update as unknown as AccountPreferencesUpdate;
}

function storage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

/** What this device already holds, used to seed an account that Core has never stored. */
export function localAccountSnapshot(): AccountPreferenceEdit | null {
  const store = storage();
  const appearance = readStoredAppearance();
  let locale: AccountPreferenceLocale | undefined;
  try { locale = localeOf(store?.getItem(platformLocaleStorageKey)); } catch { locale = undefined; }
  const components = readStoredPreferences(store);
  const snapshot: AccountPreferenceEdit = {
    ...appearance,
    ...(locale ? { locale } : {}),
    ...(Object.keys(components).length ? { componentPreferences: components } : {}),
  };
  return Object.keys(snapshot).length ? snapshot : null;
}

function componentValues(value: AccountPreferences["componentPreferences"] | undefined): ComponentPreferenceValues {
  const values: ComponentPreferenceValues = {};
  for (const [key, item] of Object.entries((value ?? {}) as Record<string, unknown>).slice(0, MAX_COMPONENT_KEYS)) {
    if (KEY.test(key) && (typeof item === "boolean" || (typeof item === "string" && OPTION.test(item)))) values[key] = item;
  }
  return values;
}

/**
 * Write Core's values into this device's stores without reporting them as edits.
 * Keys the user is still editing (`except`) keep their local value.
 */
export function applyAccountPreferences(preferences: AccountPreferences, except: AccountPreferenceEdit | null = null): void {
  const raw = preferences as unknown as Record<string, unknown>;
  applyAccountAppearance({
    ...(typeof raw.theme === "string" && except?.theme === undefined ? { theme: raw.theme } : {}),
    ...(typeof raw.accent === "string" && except?.accent === undefined ? { accent: raw.accent } : {}),
    ...(typeof raw.followSystem === "boolean" && except?.followSystem === undefined ? { followSystem: raw.followSystem } : {}),
  });
  const locale = localeOf(raw.locale);
  if (locale && except?.locale === undefined && locale !== getLocale()) asAccountPreferenceApply(() => setLocale(locale));
  const store = storage();
  if (!store) return;
  const pending = except?.componentPreferences ?? {};
  const current = readStoredPreferences(store);
  const next: ComponentPreferenceValues = { ...componentValues(preferences.componentPreferences) };
  for (const [key, value] of Object.entries(pending)) {
    if (value === null) delete next[key];
    else if (current[key] !== undefined) next[key] = current[key]!;
  }
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  asAccountPreferenceApply(() => {
    try { store.setItem(COMPONENT_PREFERENCES_STORAGE_KEY, JSON.stringify(next)); } catch { return; }
    window.dispatchEvent(new Event(COMPONENT_PREFERENCES_EVENT));
  });
}

/** One sync per signed-in platform scope; `start()` returns its stop function. */
export class AccountPreferenceSync {
  private version: number | null = null;
  private pending: AccountPreferenceEdit | null = null;
  private wantRead = true;
  private running: Promise<void> | null = null;
  private stopped = false;

  constructor(private readonly api: AccountPreferenceApi, private readonly target: Window = window) {}

  start(): () => void {
    const onEdit = (event: Event) => this.edit((event as CustomEvent<AccountPreferenceEdit>).detail);
    const onFocus = () => this.refresh();
    const onVisible = () => { if (this.target.document.visibilityState === "visible") this.refresh(); };
    this.target.addEventListener(ACCOUNT_PREFERENCE_EDIT_EVENT, onEdit);
    this.target.addEventListener("focus", onFocus);
    this.target.document.addEventListener("visibilitychange", onVisible);
    this.refresh();
    return () => {
      this.stopped = true;
      this.target.removeEventListener(ACCOUNT_PREFERENCE_EDIT_EVENT, onEdit);
      this.target.removeEventListener("focus", onFocus);
      this.target.document.removeEventListener("visibilitychange", onVisible);
    };
  }

  /** A user's own edit; the local store already holds it. */
  edit(edit: AccountPreferenceEdit | undefined): void {
    if (!edit || this.stopped) return;
    this.pending = mergeAccountEdits(this.pending, edit);
    void this.run();
  }

  refresh(): void {
    if (this.stopped) return;
    this.wantRead = true;
    void this.run();
  }

  /** Settles when the current round of reads and writes has finished (tests, sign-out). */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  private run(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.loop().finally(() => { this.running = null; });
    return this.running;
  }

  private async loop(): Promise<void> {
    let conflicts = 0;
    while (!this.stopped && (this.wantRead || this.version === null || this.pending)) {
      if (this.wantRead || this.version === null) {
        this.wantRead = false;
        let current: AccountPreferences;
        try { current = await this.api.accountPreferences(); } catch { return; } // keep the cache; retry on the next focus
        if (this.stopped) return;
        const first = this.version === null;
        if (first && current.version === 0) this.pending = mergeAccountEdits(localAccountSnapshot(), this.pending);
        else applyAccountPreferences(current, this.pending);
        this.version = current.version;
        continue;
      }
      const edit = this.pending!;
      this.pending = null;
      try {
        const written = await this.api.updateAccountPreferences(accountUpdate(this.version, edit));
        if (typeof written?.version === "number") this.version = written.version;
      } catch (failure) {
        // Refused for good (malformed for Core): the device keeps it, Core is not asked again.
        if (failure instanceof BffError && failure.status >= 400 && failure.status < 500 && failure.status !== 409 && failure.status !== 429) continue;
        this.pending = mergeAccountEdits(edit, this.pending);
        if (failure instanceof BffError && failure.status === 409 && ++conflicts <= MAX_CONFLICT_REPLAYS) {
          this.wantRead = true; // take Core's current value, then replay this edit on top of it
          continue;
        }
        // Unreachable or refused: the device keeps its value; the edit is written after the next successful read.
        this.wantRead = true;
        return;
      }
    }
  }
}
