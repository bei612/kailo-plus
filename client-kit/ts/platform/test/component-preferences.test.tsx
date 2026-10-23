// DD-138 (07 §4.8.2): component preferences are ordinary Kailo settings items
// (V-SCN-223, V-SCN-225).
import type { ComponentPreferenceDeclaration } from "@client-kit/contracts";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import {
  COMPONENT_PREFERENCES_STORAGE_KEY, mergeDeclarations, preferenceValues, readStoredPreferences, resolveValue,
  validDeclaration, writeStoredPreference,
} from "../src/component-preferences";
import { PlatformProvider } from "../src/react/context";
import { SettingsPage } from "../src/react/settings";
import { SidebarProvider } from "../src/react/sidebar/sidebar";
import { render, settle } from "./render";

const text = (zh: string, en: string) => ({ ZH_CN: zh, EN: en });
const unit = { key: "documents.measurementUnit", settingsCategory: "DOCUMENTS", valueType: "ENUM",
  options: [{ value: "cm", label: text("厘米", "Centimeters") }, { value: "pt", label: text("点", "Points") },
    { value: "inch", label: text("英寸", "Inches") }],
  defaultValue: "cm", label: text("度量单位", "Measurement unit"),
  description: text("编辑器单位", "Editor unit") } as unknown as ComponentPreferenceDeclaration;
const spell = { key: "documents.spellcheck", settingsCategory: "DOCUMENTS", valueType: "BOOLEAN", options: [],
  defaultValue: "true", label: text("拼写检查", "Spell checking") } as unknown as ComponentPreferenceDeclaration;
const theme = { key: "appearance.compactLists", settingsCategory: "APPEARANCE", valueType: "BOOLEAN", options: [],
  defaultValue: "false", label: text("紧凑列表", "Compact lists") } as unknown as ComponentPreferenceDeclaration;

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true }));
});
afterEach(() => { window.localStorage.clear(); vi.unstubAllGlobals(); });

describe("component preference declarations", () => {
  it("accepts only booleans and closed options under Kailo categories", () => {
    expect(validDeclaration(unit)).toBe(true);
    expect(validDeclaration(spell)).toBe(true);
    for (const bad of [{ ...spell, key: "spellcheck" }, { ...spell, key: "Cells.spellcheck" }, { ...spell, settingsCategory: "CELLS" },
      { ...spell, defaultValue: "yes" }, { ...unit, defaultValue: "mm" }, { ...unit, options: unit.options.slice(0, 1) },
      { ...spell, valueType: "TEXT" }])
      expect(validDeclaration(bad as ComponentPreferenceDeclaration)).toBe(false);
  });

  it("shows one control per key and drops a key two releases declare differently", () => {
    const relabelled = { ...spell, label: text("拼写", "Spelling") };
    const conflicting = { ...unit, defaultValue: "pt" } as ComponentPreferenceDeclaration;
    expect(mergeDeclarations([[unit, spell], [relabelled]]).map((item) => item.key)).toEqual(["documents.measurementUnit", "documents.spellcheck"]);
    expect(mergeDeclarations([[unit, spell], [conflicting]]).map((item) => item.key)).toEqual(["documents.spellcheck"]);
  });

  it("resolves stored values against the declaration and falls back to the default", () => {
    expect(resolveValue(unit, "pt")).toBe("pt");
    expect(resolveValue(unit, "mm")).toBe("cm");
    expect(resolveValue(spell, false)).toBe(false);
    expect(resolveValue(spell, "false")).toBe(true);
    expect(preferenceValues([unit, spell], { "documents.measurementUnit": "inch", "unrelated.key": true }))
      .toEqual({ "documents.measurementUnit": "inch", "documents.spellcheck": true });
  });

  it("stores device values on the Kailo origin and refuses values outside the declaration", () => {
    expect(writeStoredPreference(window.localStorage, unit, "pt")).toEqual({ "documents.measurementUnit": "pt" });
    expect(writeStoredPreference(window.localStorage, unit, "mm")).toBeNull();
    expect(writeStoredPreference(window.localStorage, spell, "true")).toBeNull();
    expect(readStoredPreferences(window.localStorage)).toEqual({ "documents.measurementUnit": "pt" });
    window.localStorage.setItem(COMPONENT_PREFERENCES_STORAGE_KEY, "{not json");
    expect(readStoredPreferences(window.localStorage)).toEqual({});
  });
});

describe("Kailo settings with contributed items", () => {
  const binding = (id: string, preferences: ComponentPreferenceDeclaration[], extra: object = {}) => ({
    bindingId: id, tenantId: "20000000-0000-4000-8000-000000000001", componentReleaseId: "30000000-0000-4000-8000-000000000001",
    componentTypeKey: "cells", state: "ACTIVE", version: 1, activeProjectionGeneration: 1, capabilityCategories: [],
    canDisable: false, hasNativePage: true, nativePageCategory: "file_storage", preferences, ...extra });

  async function settings(section: "documents" | "appearance" | "profile", bindings: object[]) {
    const client = createBffClient({ send: async () => ({ status: 200, body: { bindings, canCreate: false } }) });
    const host = await render(<PlatformProvider client={client} locale="zh-CN"><SidebarProvider>
      <SettingsPage locale="zh-CN" section={section} onSelect={() => {}}><div /></SettingsPage>
    </SidebarProvider></PlatformProvider>);
    await settle();
    return host;
  }

  it("adds the Documents category with the items, without any component name or section", async () => {
    const host = await settings("documents", [binding("10000000-0000-4000-8000-000000000001", [unit, spell])]);
    expect(host.querySelector('[data-testid="settings-nav-documents"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="settings-nav-answers"]')).toBeNull();
    expect(host.textContent).toContain("文档与文件");
    expect(host.textContent).toContain("度量单位");
    expect(host.textContent).toContain("拼写检查");
    for (const name of ["cells", "Cells", "云盘", "外部服务", "已连接"]) expect(host.textContent).not.toContain(name);
    const switchControl = host.querySelector<HTMLButtonElement>('[data-testid="preference-documents-spellcheck-switch"]')!;
    expect(switchControl.getAttribute("aria-checked")).toBe("true");
    await act(async () => switchControl.click());
    await settle();
    expect(JSON.parse(window.localStorage.getItem(COMPONENT_PREFERENCES_STORAGE_KEY)!)).toEqual({ "documents.spellcheck": false });
    expect(host.querySelector('[data-testid="preference-documents-spellcheck-switch"]')!.getAttribute("aria-checked")).toBe("false");
  });

  it("mixes an Appearance item into Kailo's own Appearance category and adds no extra section", async () => {
    const host = await settings("appearance", [binding("10000000-0000-4000-8000-000000000001", [theme])]);
    expect(host.querySelector('[data-testid="settings-contributed-appearance"]')?.textContent).toContain("紧凑列表");
    expect(host.querySelector('[data-testid="settings-nav-documents"]')).toBeNull();
  });

  it("lists nothing contributed from inactive bindings or pages without declarations", async () => {
    const host = await settings("profile", [binding("10000000-0000-4000-8000-000000000001", [unit], { state: "DISABLED" }),
      binding("10000000-0000-4000-8000-000000000002", [])]);
    expect(host.querySelector('[data-testid="settings-nav-documents"]')).toBeNull();
  });
});
