// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlatformSessionAccessMode, type PlatformSessionView, type WebProfileUpdateRequest } from "@client-kit/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WebSidebarProfileCard } from "./SidebarProfileCard";
import { SettingsPane } from "./SettingsPane";
import { setLocale } from "@client-kit/platform/i18n";
import { PlatformProvider } from "@client-kit/platform/react/context";
import { createBffClient } from "@client-kit/platform/client";
import { SidebarProvider } from "@client-kit/platform/react/sidebar/sidebar";
import { TransportError } from "@client-kit/platform/transport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), upload: vi.fn() }));
vi.mock("@client-kit/platform/react/context", async (original) => ({ ...await original<typeof import("@client-kit/platform/react/context")>(), useBffClient: () => ({ invitations: async()=>[], profile: state.read, updateProfile: state.write }) }));
vi.mock("@/shared/i18n", () => ({ getLocale: () => "en" }));
vi.mock("@/shared/theme/ThemeProvider", () => ({ useTheme: () => ({ themeName: "buzz", selectedThemeName: "buzz", isLoading: false, isDark: false, followSystem: true, accentColor: "neutral", hasPair: true, setTheme: vi.fn(), setAccentColor: vi.fn(), setFollowSystem: vi.fn(), applyAppearance: vi.fn(), prominentActiveTab: false, setProminentActiveTab: vi.fn() }) }));
vi.mock("@/platform/bff-client", () => ({ bff: { profile: (...args: unknown[]) => state.read(...args) }, fetchUserState: vi.fn(), setWorkspacePreference: vi.fn(), uploadProfileAvatar: state.upload }));

const profile = { pubkey: "a".repeat(64), eventId: "1".repeat(64), displayName: "Before", about: "Original", avatarUrl: null, nip05Handle: null, avatarMediaPaths: {} };
let root: Root;
let host: HTMLDivElement;
const client = createBffClient({ send: async () => ({ status: 200, body: [] }) });
async function openProfile(session = "original") {
  await act(async () => root.render(<PlatformProvider client={client} locale="en"><SidebarProvider><SettingsPane key={session} /></SidebarProvider></PlatformProvider>));
  await click('[data-testid="settings-nav-profile"]');
}
async function click(selector: string) {
  const target = host.querySelector<HTMLButtonElement>(selector);
  expect(target).not.toBeNull();
  await act(async () => target!.click());
}
async function startSave() {
  await openProfile();
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
  state.upload.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("does not admit a late upload into the original global avatar presentation after the session pane changed", async () => {
  let complete!: (descriptor: { url: string; sha256: string; type: string }) => void;
  state.upload.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
  const create = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const revoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const createPreview = vi.fn(() => "blob:local-avatar");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createPreview });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  try {
    await openProfile();
    await click('[data-testid="profile-avatar-edit"]');
    await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input).not.toBeNull();
    const file = new File([new Uint8Array([137, 80, 78, 71])], "avatar.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([137, 80, 78, 71]).buffer });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(state.upload).toHaveBeenCalledExactlyOnceWith([137, 80, 78, 71], profile.pubkey);
    state.read.mockResolvedValue({ ...profile, pubkey: "b".repeat(64), displayName: "Next session" });
    await openProfile("next-session");
    const previews = createPreview.mock.calls.length;
    const url = "https://community.example/media/old-session.png";
    await act(async () => { complete({ url, sha256: "c".repeat(64), type: "image/png" }); });
    // The original global presentation store creates its Blob URL on entry.
    // A stale host must reject before the original editor's success callback.
    expect(createPreview).toHaveBeenCalledTimes(previews);
    expect(host.textContent).toContain("Next session");
    expect(state.write).not.toHaveBeenCalled();
  } finally {
    if (create) Object.defineProperty(URL, "createObjectURL", create); else Reflect.deleteProperty(URL, "createObjectURL");
    if (revoke) Object.defineProperty(URL, "revokeObjectURL", revoke); else Reflect.deleteProperty(URL, "revokeObjectURL");
  }
});

it("does not start old save readback with the next session cookie after the profile host unmounted", async () => {
  let complete!: (receipt: { eventId: string }) => void;
  state.write.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
  await startSave();
  expect(state.write).toHaveBeenCalledTimes(1);
  state.read.mockResolvedValue({ ...profile, pubkey: "b".repeat(64), displayName: "Next session" });
  await openProfile("next-session");
  const reads = state.read.mock.calls.length;
  await act(async () => { complete({ eventId: "2".repeat(64) }); });
  expect(state.read).toHaveBeenCalledTimes(reads);
  expect(host.textContent).toContain("Next session");
  expect(host.textContent).not.toContain("Saved and read back");
});

it("retains the actual pending profile request through section switches, then observes the same UNKNOWN intent", async () => {
  let reject!: (error: Error) => void;
  state.write.mockReturnValueOnce(new Promise((_resolve, rejectSave) => { reject = rejectSave; }));
  await startSave();
  const request = state.write.mock.calls[0]![0];
  const editor = host.querySelector<HTMLInputElement>("#profile-display-name")!;
  expect(editor.disabled).toBe(true);
  await click('[data-testid="settings-nav-appearance"]');
  expect(editor.closest("[hidden]")).not.toBeNull();
  await act(async () => reject(new TransportError("publication response lost")));
  await click('[data-testid="settings-nav-profile"]');
  expect(host.querySelector("#profile-display-name")).toBe(editor);
  expect(editor.value).toBe("After");
  expect(editor.disabled).toBe(true);
  expect(host.textContent).toContain("The save result is unknown");
  expect(state.write).toHaveBeenCalledTimes(1);
  state.read.mockResolvedValue({ ...profile, eventId: "2".repeat(64), displayName: "Canonical After" });
  const observe = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Check save result")!;
  await act(async () => observe.click());
  expect(state.write).toHaveBeenCalledTimes(2);
  expect(state.write.mock.calls[1]![0]).toBe(request);
  expect(host.textContent).toContain("Saved and read back");
  expect(host.textContent).toContain("Canonical After");
});

it("preserves the real uploaded-avatar UNKNOWN request across navigation without a second upload", async () => {
  const avatarUrl = "https://community.example/media/avatar.png";
  state.upload.mockResolvedValue({ url: avatarUrl, sha256: "c".repeat(64), type: "image/png" });
  state.write.mockRejectedValueOnce(new TransportError("publication response lost"));
  const create = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const revoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:local-avatar" });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  try {
    await openProfile();
    await click('[data-testid="profile-avatar-edit"]');
    await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([new Uint8Array([137, 80, 78, 71])], "avatar.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([137, 80, 78, 71]).buffer });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await click('[data-testid="profile-avatar-done"]');
    expect(state.write).toHaveBeenCalledTimes(1);
    const request = state.write.mock.calls[0]![0];
    expect(request).toMatchObject({ expectedPubkey: profile.pubkey, avatarUrl });
    expect(host.textContent).toContain("The save result is unknown");
    await click('[data-testid="settings-nav-shortcuts"]');
    await click('[data-testid="settings-nav-profile"]');
    expect(host.textContent).toContain("The save result is unknown");
    expect(state.write).toHaveBeenCalledTimes(1);
    state.read.mockResolvedValue({ ...profile, avatarUrl, eventId: "2".repeat(64) });
    const observe = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Check save result")!;
    await act(async () => observe.click());
    expect(state.write.mock.calls[1]![0]).toBe(request);
    expect(state.upload).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Saved and read back");
  } finally {
    if (create) Object.defineProperty(URL, "createObjectURL", create); else Reflect.deleteProperty(URL, "createObjectURL");
    if (revoke) Object.defineProperty(URL, "revokeObjectURL", revoke); else Reflect.deleteProperty(URL, "revokeObjectURL");
  }
});

it("does not transfer or automatically repeat an UNKNOWN request after the authenticated profile scope changes", async () => {
  state.write.mockRejectedValueOnce(new TransportError("publication response lost"));
  await startSave();
  expect(host.textContent).toContain("The save result is unknown");
  await click('[data-testid="settings-nav-appearance"]');
  state.read.mockResolvedValue({ ...profile, pubkey: "b".repeat(64), displayName: "Next session" });
  await openProfile("next-session");
  expect(host.textContent).toContain("Next session");
  expect(host.textContent).not.toContain("The save result is unknown");
  expect(host.textContent).not.toContain("Saved and read back");
  expect(state.write).toHaveBeenCalledTimes(1);
});

it("the real Web settings branch requires the exact signed event readback after its PUT", async () => {
  state.read.mockResolvedValueOnce(profile).mockResolvedValue({ ...profile, eventId: "2".repeat(64), displayName: "Canonical" });
  await startSave();
  expect(state.write).toHaveBeenCalledTimes(1);
  expect(state.write.mock.calls[0]![0]).toMatchObject({ expectedPubkey: profile.pubkey, displayName: "After" });
  expect(host.textContent).toContain("Canonical");
  expect(host.textContent).toContain("Saved and read back");
});

it("opens the original avatar controls independently and keeps the actual mode tabs in the profile header", async () => {
  await openProfile();
  await click('[data-testid="profile-avatar-edit"]');
  await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
  expect(host.querySelector("#profile-display-name")).toBeNull();
  expect(host.querySelector('[data-testid="profile-avatar-mode-tabs-slot"]')?.textContent).toContain("Emoji");
  expect(host.querySelector('[data-testid="profile-avatar-editor-shell"]')).not.toBeNull();
  expect(state.write).not.toHaveBeenCalled();
});

it.each(["", "   ", "  Profile name  "])("uses the original display-name fallback for profile name %j", async (displayName) => {
  state.read.mockResolvedValue({ ...profile, displayName });
  const session: PlatformSessionView = {
    accessMode: PlatformSessionAccessMode.Full, displayName: "Signed-in human",
    humanIdentityId: "human", platformSessionId: "session", tenantId: "tenant",
    tenantMembershipId: "membership", tenantPrincipalId: "principal",
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  try {
    await act(async () => root.render(<QueryClientProvider client={queryClient}><PlatformProvider client={client} locale="en">
      <WebSidebarProfileCard session={session} settingsOpen={false} onOpenSettings={vi.fn()} onSignOut={vi.fn()} />
    </PlatformProvider></QueryClientProvider>));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const expected = displayName.trim() || session.displayName;
    expect(host.querySelector('[data-testid="sidebar-profile-name"]')?.textContent).toBe(expected);
    expect(host.querySelector('[data-testid="sidebar-profile-avatar-button"]')?.getAttribute("aria-label")).toContain(expected);
    expect(state.write).not.toHaveBeenCalled();
  } finally {
    queryClient.clear();
  }
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
