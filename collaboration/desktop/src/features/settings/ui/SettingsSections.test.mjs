// Top 30 #3: Desktop settings host the original Moderation (DD-125(2)) and Channel templates
// (DD-125(4)) sections with the same shared cards as the Web host.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node, Element: dom.window.Element, Event: dom.window.Event,
  MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
});
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
// Settings reads the native app version through the Tauri app plugin.
dom.window.__TAURI_INTERNALS__ = { invoke: async () => "0.0.0-test", transformCallback: () => 0 };

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { settingsSectionValues } = await import("@client-kit/platform/react/settings-sections");
const { ChannelTemplatesSettingsCard } = await import("@client-kit/platform/react/channel-templates");
const { ModerationQueueCard } = await import("@client-kit/platform/react/moderation");
const { PlatformProvider } = await import("@client-kit/platform/react/context");
const { createBffClient } = await import("@client-kit/platform/client");
const { CollaborationPreferencesProvider } = await import("@client-kit/platform/react/collaboration-preferences");
const { SidebarProvider } = await import("@client-kit/platform/react/sidebar/sidebar");
const { setLocale } = await import("@client-kit/platform/i18n");
const { isSettingsSection, renderSettingsSection } = await import("./SettingsPanels.tsx");
const { SettingsView } = await import("./SettingsView.tsx");

after(() => dom.window.close());

const panelProps = {
  isUpdatingDesktopNotifications: false, notificationErrorMessage: null, notificationPermission: "granted",
  notificationSettings: {}, onSetDesktopNotificationsEnabled: async () => true, onSetHomeBadgeEnabled() {},
  onSetSlotAlertsEnabled() {}, onSetNotifyWhileViewing() {}, onSetAllSlotAlertsEnabled() {}, onSetSoundForSlot() {},
};

test("Desktop routes every shared settings section, including Moderation and Channel templates", () => {
  // Count assertion kept in step with the shared list (10 sections, the Web host's set).
  assert.equal(settingsSectionValues.length, 10);
  for (const section of settingsSectionValues) assert.equal(isSettingsSection(section), true, section);
  assert.equal(isSettingsSection("voice"), false);
});

test("the two sections render the shared cards, not an empty host slot", () => {
  assert.equal(renderSettingsSection("channel-templates", panelProps).type, ChannelTemplatesSettingsCard);
  assert.equal(renderSettingsSection("moderation", panelProps).type, ModerationQueueCard);
});

test("Settings navigation offers both sections and the templates card reads Core preferences", async () => {
  setLocale("en");
  const client = createBffClient({ send: async () => ({ status: 403, body: { code: "PermissionDenied", message: "fixture" } }) });
  const preferences = {
    state: { version: 3, workspacePreferences: {}, readContexts: {} }, writable: true,
    isFollowingThread: () => false, isThreadMuted: () => false, isNotifiedForThread: () => false,
    followThread: async () => true, unfollowThread: async () => true,
    sections: [], assignments: {}, createSection: async () => null, renameSection: async () => true,
    deleteSection: async () => true, moveSection: async () => true, reorderSections: async () => true,
    assignChannel: async () => true, sortModeFor: () => "alpha", setSortModeFor: async () => true,
    templates: [{ id: "t1", name: "Incident room", channelType: "stream", visibility: "private", agentResourceIds: [], updatedAt: 1 }],
    saveTemplate: async () => null, deleteTemplate: async () => true,
    isFollowing: () => false, setFollowing: async () => true,
  };
  const host = dom.window.document.createElement("div");
  dom.window.document.body.append(host);
  const root = createRoot(host);
  const selected = [];
  try {
    await act(async () => root.render(React.createElement(PlatformProvider, { client, locale: "en" },
      React.createElement(SidebarProvider, null,
        React.createElement(CollaborationPreferencesProvider, { value: preferences },
          React.createElement(SettingsView, { ...panelProps, active: true, section: "channel-templates",
            onClose() {}, onSectionChange: (section) => selected.push(section) }))))));
    const until = async (check) => {
      for (let index = 0; index < 50 && !check(); index++)
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      return check();
    };
    assert.ok(await until(() => host.querySelector('[data-testid="settings-channel-templates"]')));
    assert.ok(host.querySelector('[data-testid="settings-nav-channel-templates"]'));
    assert.ok(host.querySelector('[data-testid="settings-nav-moderation"]'));
    assert.match(host.querySelector('[data-testid="settings-channel-templates"]').textContent, /Incident room/);
    await act(async () => host.querySelector('[data-testid="settings-nav-moderation"]').click());
    assert.deepEqual(selected, ["moderation"]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
