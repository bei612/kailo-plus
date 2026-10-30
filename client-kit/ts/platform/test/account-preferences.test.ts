// DD-164(7): theme, language and component preferences follow the account (V-SCN-278).
import type { AccountPreferences, AccountPreferencesUpdate } from "@client-kit/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_APPEARANCE_APPLY_EVENT, ACCOUNT_PREFERENCE_EDIT_EVENT, noteAccountPreferenceEdit } from "../src/account-preference-events";
import { AccountPreferenceSync, accountUpdate, applyAccountPreferences, localAccountSnapshot, mergeAccountEdits } from "../src/account-preferences";
import { COMPONENT_PREFERENCES_EVENT, COMPONENT_PREFERENCES_STORAGE_KEY } from "../src/component-preferences";
import { getLocale, platformLocaleStorageKey, setLocale } from "../src/i18n";
import { THEME_STORAGE_KEY } from "../src/theme/use-appearance";
import { BffError, TransportError } from "../src/transport";

type Prefs = AccountPreferences;
const prefs = (value: Partial<Prefs> & { version: number }): Prefs => ({ componentPreferences: [], ...value } as Prefs);

function fakeCore(initial: Prefs) {
  let state = initial;
  const writes: AccountPreferencesUpdate[] = [];
  let failNext: unknown = null;
  const api = {
    accountPreferences: vi.fn(async () => structuredClone(state)),
    updateAccountPreferences: vi.fn(async (body: AccountPreferencesUpdate) => {
      writes.push(body);
      if (failNext) { const error = failNext; failNext = null; throw error; }
      if (body.expectedVersion !== state.version) throw new BffError(409, "conflict");
      const { expectedVersion: _, componentPreferences, ...rest } = body as AccountPreferencesUpdate & Record<string, unknown>;
      const merged = new Map(state.componentPreferences.map((item) => [item.key, item.value]));
      for (const change of componentPreferences ?? []) { if (change.value === undefined) merged.delete(change.key); else merged.set(change.key, change.value); }
      state = { ...state, ...rest, componentPreferences: [...merged].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, value })),
        version: state.version + 1 } as Prefs;
      return structuredClone(state);
    }),
  };
  return { api, writes, get state() { return state; }, set state(next: Prefs) { state = next; }, failOnce(error: unknown) { failNext = error; } };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });

describe("account preference values", () => {
  it("merges edits key by key and sends only well-formed values", () => {
    expect(mergeAccountEdits({ theme: "buzz", componentPreferences: { "a.b": true } }, { locale: "en", componentPreferences: { "c.d": "x" } }))
      .toEqual({ theme: "buzz", locale: "en", componentPreferences: { "a.b": true, "c.d": "x" } });
    expect(accountUpdate(3, { theme: "Bad Theme", accent: "#12ab34", followSystem: false,
      componentPreferences: { "bad": true, "x.y": false, "a.b": null, "c.d": "no spaces", "e.f": "pt" } }))
      .toEqual({ expectedVersion: 3, accent: "#12ab34", followSystem: false,
        componentPreferences: [{ key: "a.b" }, { key: "e.f", value: "pt" }, { key: "x.y", value: "false" }] });
  });

  it("applies Core values to every local store without reporting them as edits", () => {
    const edits: Event[] = [];
    const adopted: Event[] = [];
    const components: Event[] = [];
    window.addEventListener(ACCOUNT_PREFERENCE_EDIT_EVENT, (event) => edits.push(event));
    window.addEventListener(ACCOUNT_APPEARANCE_APPLY_EVENT, (event) => adopted.push(event));
    window.addEventListener(COMPONENT_PREFERENCES_EVENT, (event) => components.push(event));
    applyAccountPreferences(prefs({ version: 4, theme: "buzz-dark", followSystem: false, locale: "en" as Prefs["locale"],
      componentPreferences: [{ key: "documents.spellcheck", value: "false" }, { key: "bad", value: "true" }, { key: "documents.unit", value: "pt" }] }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("buzz-dark");
    expect(getLocale()).toBe("en");
    expect(JSON.parse(window.localStorage.getItem(COMPONENT_PREFERENCES_STORAGE_KEY)!)).toEqual({ "documents.spellcheck": false, "documents.unit": "pt" });
    expect(adopted).toHaveLength(1);
    expect(components).toHaveLength(1);
    expect(edits).toHaveLength(0);
    // A user edit is reported.
    setLocale("zh-CN");
    expect(edits).toHaveLength(1);
    expect((edits[0] as CustomEvent).detail).toEqual({ locale: "zh-CN" });
  });

  it("ignores theme names this build cannot render", () => {
    applyAccountPreferences(prefs({ version: 1, theme: "not-a-theme" }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("snapshots only what this device has set", () => {
    expect(localAccountSnapshot()).toBeNull();
    window.localStorage.setItem(platformLocaleStorageKey, "en");
    window.localStorage.setItem(THEME_STORAGE_KEY, "buzz");
    expect(localAccountSnapshot()).toEqual({ theme: "buzz", locale: "en" });
  });
});

describe("AccountPreferenceSync", () => {
  it("seeds an account Core has never stored from this device, then follows Core", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "buzz-dark");
    window.localStorage.setItem(platformLocaleStorageKey, "en");
    const core = fakeCore(prefs({ version: 0 }));
    const sync = new AccountPreferenceSync(core.api);
    const stop = sync.start();
    await sync.idle();
    expect(core.writes).toEqual([{ expectedVersion: 0, theme: "buzz-dark", locale: "en" }]);
    expect(core.state.version).toBe(1);
    // Another device changed the language; focus re-reads and applies it.
    core.state = { ...core.state, locale: "zh-CN" as Prefs["locale"], version: 2 };
    window.dispatchEvent(new Event("focus"));
    await sync.idle();
    expect(getLocale()).toBe("zh-CN");
    expect(core.writes).toHaveLength(1);
    stop();
  });

  it("writes a local edit with compare-and-swap and replays it after a conflict", async () => {
    const core = fakeCore(prefs({ version: 5, theme: "buzz", locale: "zh-CN" as Prefs["locale"] }));
    const sync = new AccountPreferenceSync(core.api);
    const stop = sync.start();
    await sync.idle();
    expect(core.writes).toHaveLength(0);
    // Another device wrote first: version 6 with English.
    core.state = { ...core.state, locale: "en" as Prefs["locale"], version: 6 };
    noteAccountPreferenceEdit({ theme: "buzz-dark" });
    await sync.idle();
    expect(core.writes.map((write) => write.expectedVersion)).toEqual([5, 6]);
    expect(core.state).toMatchObject({ theme: "buzz-dark", locale: "en", version: 7 });
    expect(getLocale()).toBe("en"); // Core's other key was adopted, the edit was not lost
    stop();
  });

  it("keeps the device value while Core is unreachable and writes it after the next read", async () => {
    const core = fakeCore(prefs({ version: 2 }));
    const sync = new AccountPreferenceSync(core.api);
    const stop = sync.start();
    await sync.idle();
    core.failOnce(new TransportError("offline"));
    noteAccountPreferenceEdit({ componentPreferences: { "documents.spellcheck": false } });
    await sync.idle();
    expect(core.state.version).toBe(2);
    window.dispatchEvent(new Event("focus"));
    await sync.idle();
    expect(core.state.componentPreferences).toEqual([{ key: "documents.spellcheck", value: "false" }]);
    expect(core.state.version).toBe(3);
    stop();
  });

  it("does not block when Core cannot be read", async () => {
    const api = { accountPreferences: vi.fn(async () => { throw new TransportError("offline"); }), updateAccountPreferences: vi.fn() };
    const sync = new AccountPreferenceSync(api);
    const stop = sync.start();
    await sync.idle();
    expect(api.updateAccountPreferences).not.toHaveBeenCalled();
    stop();
  });
});
