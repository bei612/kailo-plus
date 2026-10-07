// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsView } from "../../src/features/settings/ui/SettingsView";
import { PlatformProvider } from "@client-kit/platform/react/context";
import { SidebarProvider } from "@client-kit/platform/react/sidebar/sidebar";
import { createBffClient } from "@client-kit/platform/client";
import { TransportError } from "@client-kit/platform/transport";
import { setLocale } from "@client-kit/platform/i18n";
import type { SettingsPanelProps, SettingsSection } from "../../src/features/settings/ui/SettingsPanels";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const state = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "test" }));
vi.mock("@/features/profile/hooks", () => ({ useProfileQuery: () => ({ data: state.read(), isPending: false, isError: false }), useUpdateProfileMutation: () => ({ mutateAsync: state.save }) }));
vi.mock("@/features/platform/activeCommunity", () => ({ useActiveCommunity: () => ({ relayUrl: "wss://community.example" }) }));
vi.mock("@/shared/theme/ThemeProvider", () => ({ useTheme: () => ({ isDark: false }) }));
vi.mock("@/shared/api/tauriProfiles", () => ({ uploadProfileAvatar: vi.fn() }));
vi.mock("@/shared/lib/mediaUrl", () => ({ rewriteRelayUrl: (url: string) => url }));
vi.mock("@/shared/lib/haptics", () => ({ performDefaultHaptic: vi.fn() }));
vi.mock("@/shared/lib/clipboard", () => ({ writeTextToClipboard: vi.fn() }));
vi.mock("../../src/features/settings/ui/CustomEmojiSettingsCard", () => ({ CustomEmojiSettingsCard: () => null }));
vi.mock("../../src/features/settings/ui/SettingsPanels", () => ({ renderSettingsSection: () => null }));

const profile = { pubkey: "a".repeat(64), eventId: "1".repeat(64), displayName: "Before", about: "Original", avatarUrl: null, nip05Handle: null, avatarMediaPaths: {} };
const client = createBffClient({ send: async () => ({ status: 200, body: [] }) });
const panelProps: SettingsPanelProps = {
  isUpdatingDesktopNotifications: false, notificationErrorMessage: null, notificationPermission: "granted",
  notificationSettings: { desktopEnabled: false, homeBadgeEnabled: false, notifyWhileViewing: false,
    sounds: { dm: "flutter", mention: "flutter", thread_reply: "flutter" },
    slotAlertsEnabled: { dm: true, mention: true, thread_reply: true }, slotAlertsSnapshot: null },
  onSetDesktopNotificationsEnabled: async () => false, onSetHomeBadgeEnabled() {}, onSetSlotAlertsEnabled() {},
  onSetNotifyWhileViewing() {}, onSetAllSlotAlertsEnabled() {}, onSetSoundForSlot() {},
};
let root: Root;
let host: HTMLDivElement;
async function render(section: SettingsSection, session = "original") {
  await act(async () => root.render(<PlatformProvider client={client} locale="en"><SidebarProvider><SettingsView key={session} active section={section} onClose={() => {}} onSectionChange={() => {}} {...panelProps} /></SidebarProvider></PlatformProvider>));
}
async function click(selector: string) {
  const button = host.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  await act(async () => button!.click());
}
beforeEach(() => {
  setLocale("en");
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }));
  state.read.mockReset().mockReturnValue(profile);
  state.save.mockReset().mockRejectedValueOnce(new TransportError("publication response lost")).mockResolvedValue({ ...profile, displayName: "Canonical After", eventId: "2".repeat(64) });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function submit() {
  await render("profile");
  await click('[data-testid="profile-metadata-edit"]');
  const input = host.querySelector<HTMLInputElement>("#profile-display-name")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "After");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click('[data-testid="profile-metadata-edit"]');
  expect(host.textContent).toContain("The save result is unknown");
  return input;
}
it("keeps the actual native profile UNKNOWN intent across sections and reconciles the same immutable request", async () => {
  const editor = await submit();
  const request = state.save.mock.calls[0]![0];
  await render("appearance");
  await render("profile");
  expect(host.textContent).toContain("The save result is unknown");
  expect(host.querySelector("#profile-display-name")).toBe(editor);
  expect(editor.disabled).toBe(true);
  expect(state.save).toHaveBeenCalledTimes(1);
  const observe = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Check save result")!;
  await act(async () => observe.click());
  expect(state.save).toHaveBeenCalledTimes(2);
  expect(state.save.mock.calls[1]![0]).toBe(request);
  expect(host.textContent).toContain("Canonical After");
  expect(host.textContent).toContain("Saved and read back");
});
it("discards only the destroyed session UI without replaying or declaring its UNKNOWN write failed", async () => {
  await submit(); await render("appearance");
  state.read.mockReturnValue({ ...profile, pubkey: "b".repeat(64), displayName: "Next session" });
  await render("profile", "next-session");
  expect(host.textContent).toContain("Next session");
  expect(host.textContent).not.toContain("The save result is unknown");
  expect(host.textContent).not.toContain("Saved and read back");
  expect(state.save).toHaveBeenCalledTimes(1);
});
