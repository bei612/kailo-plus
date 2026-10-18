// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPane } from "./SettingsPane";
import { setLocale } from "@client-kit/platform/i18n";
import { PlatformProvider } from "@client-kit/platform/react/context";
import { createBffClient } from "@client-kit/platform/client";
import { SidebarProvider } from "@client-kit/platform/react/sidebar/sidebar";
import { CollaborationPreferencesProvider, type CollaborationPreferenceActions } from "@client-kit/platform/react/collaboration-preferences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: feedback }));
vi.mock("@/platform/bff-client", () => ({ bff: { workspaces: vi.fn(), profile: vi.fn(async () => ({ pubkey: "a".repeat(64) })) }, fetchUserState: vi.fn(), uploadProfileAvatar: vi.fn() }));
vi.mock("@/shared/i18n", () => ({ getLocale: () => "en" }));
vi.mock("@/shared/theme/ThemeProvider", () => ({
  useTheme: () => ({ themeName: "buzz", selectedThemeName: "buzz", isDark: false, isLoading: false, followSystem: true, accentColor: "neutral", hasPair: true, setTheme: vi.fn(), setAccentColor: vi.fn(), setFollowSystem: vi.fn(), applyAppearance: vi.fn(), prominentActiveTab: false, setProminentActiveTab: vi.fn() }),
}));

const agent = "22222222-2222-4222-8222-222222222222";
const client = createBffClient({ send: async (request) => {
  if (request.path.startsWith("/api/v1/agent-definitions"))
    return { status: 200, body: { definitions: [{ resourceId: agent, stableSlug: "scribe", displayName: "Scribe", status: "ACTIVE",
      resourceVersion: 1, ownerPrincipalId: agent, resourceState: "ACTIVE" }] } };
  if (request.path === "/api/v1/profile")
    return { status: 200, body: { pubkey: "a".repeat(64), avatarMediaPaths: {} } };
  return { status: 200, body: [] };
} });
const saveTemplate = vi.fn(async () => "66666666-6666-4666-8666-666666666666");
// A stable double: hosts pass the provider value as one object per state.
const preferences: CollaborationPreferenceActions = {
  state: { version: 3, workspacePreferences: {}, readContexts: {} }, writable: true,
  isFollowingThread: () => false, isThreadMuted: () => false, isNotifiedForThread: () => false,
  followThread: async () => true, unfollowThread: async () => true,
  sections: [], assignments: {}, createSection: async () => null, renameSection: async () => true,
  deleteSection: async () => true, moveSection: async () => true, reorderSections: async () => true,
  assignChannel: async () => true, sortModeFor: () => "alpha", setSortModeFor: async () => true,
  templates: [], saveTemplate, deleteTemplate: async () => true,
  isFollowing: () => false, setFollowing: async () => true,
};

async function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); setLocale("en");
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true }));
});
afterEach(() => { vi.unstubAllGlobals(); saveTemplate.mockClear(); });

describe("Web channel templates settings (DD-125(4))", () => {
  it("shows the original Personal section and saves a template to Core user state", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<PlatformProvider client={client} locale="en"><SidebarProvider>
        <CollaborationPreferencesProvider value={preferences}><SettingsPane /></CollaborationPreferencesProvider>
      </SidebarProvider></PlatformProvider>));
      await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="settings-nav-channel-templates"]')!.click());
      const card = host.querySelector('[data-testid="settings-channel-templates"]')!;
      expect(card.textContent).toContain("No templates yet.");
      const create = [...card.querySelectorAll("button")].find((button) => button.textContent === "Create")!;
      await act(async () => create.click());
      const name = await vi.waitFor(() => {
        const input = document.querySelector<HTMLInputElement>("#template-name");
        if (!input) throw new Error("dialog not open");
        return input;
      });
      await typeInto(name, " Incident ");
      const agentRow = await vi.waitFor(() => {
        const row = document.querySelector<HTMLButtonElement>(`[data-testid="template-agent-${agent}"]`);
        if (!row) throw new Error("agents not loaded");
        return row;
      });
      await act(async () => agentRow.click());
      // Agent Teams are BLOCKED: the section explains it and offers nothing to pick.
      expect(document.querySelector('[data-testid="template-teams-blocked"]')?.textContent).toContain("can't be added");
      const form = document.querySelector<HTMLFormElement>("#template-form")!;
      await act(async () => { form.requestSubmit(); });
      await vi.waitFor(() => expect(saveTemplate).toHaveBeenCalledWith(null,
        { name: "Incident", channelType: "stream", visibility: "open", agentResourceIds: [agent] }));
      await vi.waitFor(() => expect(feedback.success).toHaveBeenCalledWith('Created "Incident"'));
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
