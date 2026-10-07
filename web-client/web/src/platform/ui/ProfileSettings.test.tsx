// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WebProfileUpdateRequest } from "@client-kit/contracts";
import { SettingsPane } from "./SettingsPane";
import { setLocale } from "@client-kit/platform/i18n";
import { PlatformProvider } from "@client-kit/platform/react/context";
import { createBffClient } from "@client-kit/platform/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("@client-kit/platform/react/context", async (original) => ({ ...await original<typeof import("@client-kit/platform/react/context")>(), useBffClient: () => ({ invitations: async()=>[], profile: state.read, updateProfile: state.write }) }));
vi.mock("@/shared/i18n", () => ({ getLocale: () => "en" }));
vi.mock("@/shared/theme/ThemeProvider", () => ({ useTheme: () => ({ themeName: "buzz", selectedThemeName: "buzz", isLoading: false, isDark: false, followSystem: true, accentColor: "neutral", hasPair: true, setTheme: vi.fn(), setAccentColor: vi.fn(), setFollowSystem: vi.fn(), applyAppearance: vi.fn(), prominentActiveTab: false, setProminentActiveTab: vi.fn() }) }));
vi.mock("@/platform/bff-client", () => ({ bff: {}, fetchUserState: vi.fn(), setWorkspacePreference: vi.fn(), uploadProfileAvatar: vi.fn() }));

const profile = { pubkey: "a".repeat(64), eventId: "1".repeat(64), displayName: "Before", about: "Original", avatarUrl: null, nip05Handle: null, avatarMediaPaths: {} };
let root: Root;
let host: HTMLDivElement;
async function click(selector: string) {
  const target = host.querySelector<HTMLButtonElement>(selector);
  expect(target).not.toBeNull();
  await act(async () => target!.click());
}
async function startSave() {
  const client=createBffClient({send:async()=>({status:200,body:[]})});
  await act(async () => root.render(<PlatformProvider client={client} locale="en"><SettingsPane /></PlatformProvider>));
  await click('[data-testid="settings-nav-profile"]');
  await click('[data-testid="profile-metadata-edit"]');
  const input = host.querySelector<HTMLInputElement>("#profile-display-name")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "After");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click('[data-testid="profile-metadata-edit"]');
}
beforeEach(() => {
  setLocale("en");
  // jsdom omits these native browser APIs; keep the real avatar components.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true }));
  state.read.mockReset().mockResolvedValue(profile);
  state.write.mockReset().mockResolvedValue({ eventId: "2".repeat(64) });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("the real Web settings branch requires the exact signed event readback after its PUT", async () => {
  state.read.mockResolvedValueOnce(profile).mockResolvedValue({ ...profile, eventId: "2".repeat(64), displayName: "Canonical" });
  await startSave();
  expect(state.write).toHaveBeenCalledTimes(1);
  expect(state.write.mock.calls[0]![0]).toMatchObject({ expectedPubkey: profile.pubkey, displayName: "After" });
  expect(host.textContent).toContain("Canonical");
  expect(host.textContent).toContain("Saved and read back");
});

it("opens the original avatar controls independently and keeps the actual mode tabs in the profile header", async () => {
  const client = createBffClient({ send: async () => ({ status: 200, body: [] }) });
  await act(async () => root.render(<PlatformProvider client={client} locale="en"><SettingsPane /></PlatformProvider>));
  await click('[data-testid="settings-nav-profile"]');
  await click('[data-testid="profile-avatar-edit"]');
  await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
  expect(host.querySelector("#profile-display-name")).toBeNull();
  expect(host.querySelector('[data-testid="profile-avatar-mode-tabs-slot"]')?.textContent).toContain("Emoji");
  expect(host.querySelector('[data-testid="profile-avatar-editor-shell"]')).not.toBeNull();
  expect(state.write).not.toHaveBeenCalled();
});

it.each(["different event", "different signer", "read error"])("does not turn an accepted PUT plus %s into saved", async (failure) => {
  state.read.mockResolvedValueOnce(profile);
  if (failure === "read error") state.read.mockRejectedValue(new Error("private response detail"));
  else state.read.mockResolvedValue({ ...profile, eventId: failure === "different event" ? profile.eventId : "2".repeat(64), pubkey: failure === "different signer" ? "b".repeat(64) : profile.pubkey });
  await startSave();
  const intent = state.write.mock.calls[0]![0] as WebProfileUpdateRequest;
  expect(host.textContent).toContain("The save result is unknown");
  expect(host.textContent).not.toContain("Saved and read back");
  expect(host.textContent).not.toContain("private response detail");
  expect(host.querySelector<HTMLInputElement>("#profile-display-name")!.disabled).toBe(true);
  const check = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Check save result")!;
  await act(async () => check.click());
  expect(state.write.mock.calls[1]![0]).toBe(intent);
});
