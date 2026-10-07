import { memo, useState, type ComponentProps } from "react";
import { act } from "react";
import { ConversationDisplaySettings } from "../src/react/conversation-display-settings";
import { ProminentActiveTabSetting } from "../src/react/prominent-active-tab-setting";
import {
  PROMINENT_ACTIVE_TAB_STORAGE_KEY,
  useProminentActiveTab,
} from "../src/theme/prominent-active-tab";
import {
  FONT_SIZE_STORAGE_KEY,
  getFontSize,
  initializeFontSizePreference,
  previewFontSize,
  setFontSize,
} from "../src/fontSizePreference";
import {
  CONVERSATION_DENSITY_STORAGE_KEY,
  getConversationDensity,
  initializeConversationDensityPreference,
  setConversationDensity,
} from "../src/conversationDensityPreference";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SettingsPage as SettingsPageView,
  LanguageSettings,
  ShortcutSettings,
  shortcutText,
  type SettingsSection,
  CommunityInvitationSettings,
  useInvitationSettingsState,
} from "../src/react/settings";
import { getLocale, setLocale, platformLocaleStorageKey } from "../src/i18n";
import { createBffClient } from "../src/client";
import { PlatformProvider, useT, useUiT } from "../src/react/context";
import { button, click, render, settle, type } from "./render";
import type { BffRequest } from "../src/transport";
import { ThreadLayoutSetting } from "../src/react/thread-layout-settings";
import { FocusThreadDrawer } from "../src/react/messages/thread/FocusThreadDrawer";
import { getThreadViewMode, setThreadViewMode, useThreadViewMode } from "../src/react/messages/thread/threadViewModePreference";
import { parseLinkPreviewSnapshots, parseLinkPreviewTextSnapshots, LinkPreviewAttachmentPresentation, LinkPreviewStyleSetting, setLinkPreviewStyle, useLinkPreviewStyle } from "../src/react/link-preview";
import { Sidebar, SidebarProvider, SidebarTrigger } from "../src/react/sidebar/sidebar";

function SettingsPage(props: ComponentProps<typeof SettingsPageView>) {
  return <SidebarProvider><SettingsPageView {...props} /></SidebarProvider>;
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true }));
});
afterEach(() => vi.unstubAllGlobals());

describe("shared Buzz settings presentation", () => {
  it("uses the original SettingsView shell and keeps the mounted draft when inactive", async () => {
    const close = vi.fn();
    function Host() {
      const [active, setActive] = useState(true);
      return <SidebarProvider defaultOpen={false}>
        <button onClick={() => setActive(value => !value)}>Toggle settings</button>
        <SettingsPageView active={active} locale="en" section="profile" onSelect={() => {}} onClose={close} appVersion="1.2.3">
          <input aria-label="Unconfirmed draft" defaultValue="unknown save" />
        </SettingsPageView>
      </SidebarProvider>;
    }
    const host = await render(<Host />);
    const sidebar = host.querySelector('[data-testid="settings-sidebar"]')!;
    expect(sidebar.closest('[data-state="expanded"]')).not.toBeNull();
    expect(sidebar.querySelector('[data-testid="settings-sidebar-top-chrome"]')).not.toBeNull();
    expect(sidebar.querySelector('[data-sidebar="header"] [data-testid="settings-back-to-app"]')).not.toBeNull();
    expect(sidebar.querySelector('[data-sidebar="footer"]')?.textContent).toBe("v1.2.3");
    const viewport = host.querySelector('[data-testid="settings-view"]')!;
    expect(viewport.querySelector('[data-testid="settings-top-chrome"]')).not.toBeNull();
    expect(viewport.querySelector('[data-testid="settings-content-scroll"]')?.className).toContain("overflow-y-auto");
    expect(host.querySelectorAll('[data-buzz-content-surface]')).toHaveLength(1);
    await click(host.querySelector<HTMLElement>('[data-testid="settings-back-to-app"]')!);
    expect(close).toHaveBeenCalledOnce();
    const draft = host.querySelector<HTMLInputElement>('input[aria-label="Unconfirmed draft"]')!;
    await click(button(host, "Toggle settings"));
    expect(host.querySelector('[data-testid="settings-sidebar"]')).toBeNull();
    expect(draft.isConnected).toBe(true);
    await click(button(host, "Toggle settings"));
    expect(host.querySelector('input[aria-label="Unconfirmed draft"]')).toBe(draft);
    expect(draft.value).toBe("unknown save");
  });
  it("opens only the active original sidebar sheet on a narrow host", async () => {
    vi.stubGlobal("innerWidth", 600);
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true }));
    const host = await render(<SidebarProvider>
      <SidebarTrigger />
      <div hidden><Sidebar active={false}><span>Inactive application menu</span></Sidebar></div>
      <SettingsPageView locale="en" section="profile" onSelect={() => {}} onClose={() => {}}>
        <input aria-label="Mobile draft" defaultValue="preserve" />
      </SettingsPageView>
    </SidebarProvider>);
    const draft = host.querySelector<HTMLInputElement>('input[aria-label="Mobile draft"]')!;
    await click(host.querySelector<HTMLButtonElement>('[data-sidebar="trigger"]')!);
    const sheets = document.querySelectorAll('[data-mobile="true"]');
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.querySelector('[data-testid="settings-back-to-app"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("Inactive application menu");
    expect(draft.isConnected).toBe(true);
    expect(draft.value).toBe("preserve");
  });
  it("applies the original thread layout to a mounted consumer without losing its reply intent", async () => {
    setLocale("en"); setThreadViewMode("split");
    const close=vi.fn();
    function Host(){
      const mode=useThreadViewMode();
      return <><ThreadLayoutSetting isDark={false}/><FocusThreadDrawer active={mode==="focus"} channelName="general" onClose={close}>
        <input aria-label="Reply draft" defaultValue="uncertain reply"/>
      </FocusThreadDrawer></>;
    }
    const host=await render(<Host/>);
    const reply=host.querySelector<HTMLInputElement>('input[aria-label="Reply draft"]')!;
    await click(host.querySelector<HTMLElement>('[data-testid="thread-layout-focus"]')!);
    expect(getThreadViewMode()).toBe("focus");
    expect(localStorage.getItem("buzz.channels.threadViewMode")).toBe("focus");
    expect(host.querySelector('[data-testid="focus-thread-drawer"]')).not.toBeNull();
    expect(host.querySelector('input[aria-label="Reply draft"]')).toBe(reply);
    await click(host.querySelector<HTMLElement>('[data-testid="thread-layout-split"]')!);
    expect(getThreadViewMode()).toBe("split");
    expect(host.querySelector('[data-testid="focus-thread-drawer"]')).toBeNull();
    expect(reply.value).toBe("uncertain reply"); expect(reply.isConnected).toBe(true);
    await act(async()=>window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"})));
    expect(close).not.toHaveBeenCalled();
  });
  it("restores original Communities invitations from one authorized read and preserves its uncertain intent",async()=>{
    let refused=false;let unavailable=false;let attempts=0;
    const send=vi.fn(async(request:BffRequest)=>{
      if(request.method==="GET")return refused?{status:403,body:{}}:unavailable?{status:503,body:{}}:{status:200,body:[]};
      attempts++;
      return attempts===1?{status:202,body:{actionKey:"tenant.member.invite",actionExecutionId:"ae",operationId:"op",gateState:"ALLOWED",dispatchState:"UNKNOWN"}}:{status:403,body:{}};
    });
    const client=createBffClient({send});
    const nextSend=vi.fn(async()=>({status:200,body:[]}));
    const nextClient=createBffClient({send:nextSend});
    function Settings(){
      const [section,setSection]=useState<SettingsSection>("profile");
      const invitations=useInvitationSettingsState();
      return <SettingsPage locale="en" section={section} onSelect={setSection} invitationAccess={invitations.access} onRetryInvitations={invitations.reload}>
        <CommunityInvitationSettings active={section==="community-members"} onAccessChange={invitations.onAccessChange}/>
      </SettingsPage>;
    }
    function Scope(){
      const [changed,setChanged]=useState(false);
      return <><button onClick={()=>setChanged(true)}>Switch session</button><PlatformProvider client={changed?nextClient:client} locale="en"><Settings/></PlatformProvider></>;
    }
    const host=await render(<Scope/>);await settle();
    expect(send).toHaveBeenCalledTimes(1);expect(send).toHaveBeenCalledWith({method:"GET",path:"/api/v1/invitations"});
    expect(host.textContent).toContain("Communities");
    await click(host.querySelector<HTMLElement>('[data-testid="settings-nav-community-members"]')!);
    const panel=host.querySelector<HTMLElement>('[data-testid="settings-community-invitations"]')!;
    await type(panel.querySelector('input[name="inviteeLabel"]')!,"Ada");await click(button(panel,"Create invitation link"));
    expect(panel.textContent).toContain("op");
    await click(host.querySelector<HTMLElement>('[data-testid="settings-nav-profile"]')!);expect(panel.hidden).toBe(true);
    await click(host.querySelector<HTMLElement>('[data-testid="settings-nav-community-members"]')!);expect(panel.hidden).toBe(false);
    expect(panel.querySelector<HTMLInputElement>('input[name="inviteeLabel"]')!.value).toBe("Ada");
    unavailable=true;await act(async()=>window.dispatchEvent(new Event("focus")));await settle();
    expect(host.querySelector('[data-testid="settings-panel-community-members"]')).not.toBeNull();
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector<HTMLInputElement>('input[name="inviteeLabel"]')!.value).toBe("Ada");
    unavailable=false;
    refused=true;await act(async()=>window.dispatchEvent(new Event("focus")));await settle();
    expect(host.querySelector('[data-testid="settings-nav-community-members"]')).toBeNull();
    const firstVisible=host.querySelector<HTMLButtonElement>('[data-testid^="settings-nav-"]')!;
    expect(firstVisible.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[data-testid="settings-panel-profile"]')).not.toBeNull();
    expect(panel.hidden).toBe(true);
    refused=false;await act(async()=>window.dispatchEvent(new Event("focus")));await settle();
    await click(host.querySelector<HTMLElement>('[data-testid="settings-nav-community-members"]')!);
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector<HTMLInputElement>('input[name="inviteeLabel"]')!.value).toBe("Ada");
    await click(button(panel,"Try again"));
    const writes=send.mock.calls.filter(([r])=>r.method==="POST").map(([r])=>r.body);
    expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);
    expect(panel.querySelector<HTMLInputElement>('input[name="inviteeLabel"]')!.disabled).toBe(true);
    const previousCalls=send.mock.calls.length;
    await click(button(host,"Switch session"));
    expect(panel.isConnected).toBe(false);
    expect(host.querySelector<HTMLInputElement>('input[name="inviteeLabel"]')!.value).toBe("");
    await act(async()=>window.dispatchEvent(new Event("focus")));await settle();
    expect(send).toHaveBeenCalledTimes(previousCalls);expect(nextSend).toHaveBeenCalledTimes(2);
  });
  it("never offers invitations for an unconfirmed read and retries the same page read",async()=>{
    let failed=true;const send=vi.fn(async()=>failed?{status:503,body:{}}:{status:200,body:[]});
    function Settings(){
      const state=useInvitationSettingsState();
      return <SettingsPage locale="en" section="profile" onSelect={()=>{}} invitationAccess={state.access} onRetryInvitations={state.reload}>
        <CommunityInvitationSettings active={false} onAccessChange={state.onAccessChange}/>
      </SettingsPage>;
    }
    const host=await render(<PlatformProvider client={createBffClient({send})} locale="en"><Settings/></PlatformProvider>);await settle();
    expect(host.querySelector('[data-testid="settings-nav-community-members"]')).toBeNull();
    const notice=host.querySelector<HTMLElement>('[data-testid="community-access-error"]')!;expect(notice).not.toBeNull();
    failed=false;await click(button(notice,"Try again"));
    expect(host.querySelector('[data-testid="settings-nav-community-members"]')).not.toBeNull();expect(send).toHaveBeenCalledTimes(2);
  });
  it("applies the original link-preview setting to a real mounted message card", async () => {
    const href = "https://example.com/product";
    const snapshot = ["link-preview", "snapshot", "1", href, "Product", "Example", "Full description", "", "", "", ""];
    const preview = parseLinkPreviewTextSnapshots([snapshot], href)[0]!;
    setLinkPreviewStyle("compact");
    function Message() {
      const style = useLinkPreviewStyle();
      return <div data-testid="message-preview"><LinkPreviewAttachmentPresentation style={style} preview={preview} /></div>;
    }
    const host = await render(<><LinkPreviewStyleSetting isDark={false} /><Message /></>);
    expect(host.querySelector('[data-testid="message-preview"] [data-link-preview-inline]')).toBeNull();
    await click(host.querySelector<HTMLButtonElement>('[data-testid="link-preview-style-rich"]')!);
    expect(host.querySelector('[data-testid="message-preview"] [data-link-preview-inline]')).not.toBeNull();
    expect(localStorage.getItem("buzz.appearance.linkPreviewStyle")).toBe("rich");
    const expand = host.querySelector<HTMLButtonElement>('[data-testid="message-preview"] button[aria-expanded]')!;
    await click(expand);
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector('[data-testid="message-preview"]')?.textContent).not.toContain("Full description");
  });
  it("does not infer a media origin for Web snapshot text or relax Native validation", () => {
    const href = "https://example.com/product";
    const hash = "a".repeat(64);
    const snapshot = ["link-preview", "snapshot", "1", href, "Product", "Example", "Description", `https://untrusted.example/media/${hash}.png`, hash, "https://untrusted.example/favicon.png", hash];
    const text = parseLinkPreviewTextSnapshots([snapshot], href);
    expect(text).toHaveLength(1);
    expect(text[0]).toMatchObject({ title: "Product", imageDataUrl: null, faviconDataUrl: null, imageState: "none" });
    expect(parseLinkPreviewSnapshots([snapshot], href, "https://relay.example")).toEqual([]);
    expect(parseLinkPreviewSnapshots([snapshot], href, null)).toEqual([]);
    expect(parseLinkPreviewTextSnapshots([snapshot], "unrelated content")).toEqual([]);
    expect(parseLinkPreviewTextSnapshots([snapshot], `||${href}||`)).toEqual([]);
    expect(parseLinkPreviewTextSnapshots([[...snapshot.slice(0, 2), "unknown", ...snapshot.slice(3)]], href)).toEqual([]);
  });
  it("updates a memoized Buzz primitive and honors an explicit host locale", async () => {
    localStorage.clear();
    const client = createBffClient({ send: async () => { throw new Error("No server locale store"); } });
    const Primitive = memo(function Primitive() { const t = useUiT(); return <output>{t("buzz.sendMessage")}</output>; });
    const standalone = await render(<Primitive />);
    const hosted = await render(<PlatformProvider client={client} locale="en"><Primitive /></PlatformProvider>);
    expect(standalone.textContent).toBe("发送消息");
    expect(hosted.textContent).toBe("Send message");
    await act(async () => setLocale("en"));
    expect(standalone.textContent).toBe("Send message");
    await act(async () => setLocale("zh-CN"));
    expect(standalone.textContent).toBe("发送消息");
    expect(hosted.textContent).toBe("Send message");
  });
  it("defaults to Chinese and switches English without remounting an in-progress draft", async () => {
    localStorage.clear();
    const client = createBffClient({ send: async () => { throw new Error("No server locale store"); } });
    function Draft() {
      const [draft, setDraft] = useState("");
      const t = useT();
      return <><span>{t("buzz.sendMessage")}</span><input data-testid="draft" value={draft} onChange={(event) => setDraft(event.target.value)} /></>;
    }
    const host = await render(<PlatformProvider client={client}><LanguageSettings /><Draft /></PlatformProvider>);
    expect(getLocale()).toBe("zh-CN");
    expect(host.textContent).toContain("发送消息");
    const draft = host.querySelector<HTMLInputElement>('[data-testid="draft"]')!;
    await type(draft, "unfinished draft");
    await click(host.querySelector<HTMLInputElement>('input[value="en"]')!);
    expect(host.textContent).toContain("Send message");
    expect(localStorage.getItem(platformLocaleStorageKey)).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(host.querySelector('[data-testid="draft"]')).toBe(draft);
    expect(draft.value).toBe("unfinished draft");
    await act(async () => {
      localStorage.removeItem(platformLocaleStorageKey);
      window.dispatchEvent(new StorageEvent("storage", { key: platformLocaleStorageKey }));
    });
    expect(host.textContent).toContain("发送消息");
    expect(draft.value).toBe("unfinished draft");
  });
  it("preserves an explicit English choice when language persistence fails", async () => {
    localStorage.clear();
    setLocale("en");
    const host = await render(<LanguageSettings />);
    const denied = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    try {
      await click(host.querySelector<HTMLInputElement>('input[value="zh-CN"]')!);
      expect(getLocale()).toBe("en");
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("previous language is unchanged");
      expect(host.querySelector<HTMLInputElement>('input[value="en"]')!.checked).toBe(true);
    } finally { denied.mockRestore(); }
  });
  it("preserves the original high-contrast navigation preference across Buzz theme changes", async () => {
    localStorage.clear();
    let preference: ReturnType<typeof useProminentActiveTab>;
    let changeTheme: (buzz: boolean) => void;
    function Host() {
      const [buzz, setBuzz] = useState(true);
      changeTheme = setBuzz;
      preference = useProminentActiveTab(buzz);
      return <ProminentActiveTabSetting locale="zh-CN" {...preference} />;
    }
    const host = await render(<Host />);
    const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(host.textContent).toContain("突出显示当前导航");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(document.documentElement.hasAttribute("data-prominent-active-tab")).toBe(false);
    await click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem(PROMINENT_ACTIVE_TAB_STORAGE_KEY)).toBe("true");
    expect(document.documentElement.hasAttribute("data-prominent-active-tab")).toBe(true);
    await act(async () => changeTheme(false));
    expect(document.documentElement.hasAttribute("data-prominent-active-tab")).toBe(false);
    expect(localStorage.getItem(PROMINENT_ACTIVE_TAB_STORAGE_KEY)).toBe("true");
    await act(async () => changeTheme(true));
    expect(document.documentElement.hasAttribute("data-prominent-active-tab")).toBe(true);
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "QuotaExceededError");
    });
    try {
      expect(() => preference.setProminentActiveTab(false)).toThrow("Storage unavailable");
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      expect(document.documentElement.hasAttribute("data-prominent-active-tab")).toBe(true);
    } finally { write.mockRestore(); }
    await click(toggle);
    expect(localStorage.getItem(PROMINENT_ACTIVE_TAB_STORAGE_KEY)).toBe("false");
    expect(document.documentElement.hasAttribute("data-prominent-active-tab")).toBe(false);
  });
  it.each([null, "unknown", "false", "true"])("reads original saved prominent-tab value %s", async (stored) => {
    localStorage.clear();
    if (stored !== null) localStorage.setItem(PROMINENT_ACTIVE_TAB_STORAGE_KEY, stored);
    function Host() {
      const preference = useProminentActiveTab(true);
      return <ProminentActiveTabSetting locale="en" {...preference} />;
    }
    const host = await render(<Host />);
    expect(host.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe(String(stored === "true"));
    expect(document.documentElement.hasAttribute("data-prominent-active-tab")).toBe(stored === "true");
  });
  it("previews pointer scrubbing without saving and restores one transition duration on cancel", async () => {
    localStorage.clear();
    initializeFontSizePreference();
    initializeConversationDensityPreference();
    const host = await render(<ConversationDisplaySettings locale="en" />);
    const control = host.querySelector<HTMLFieldSetElement>('[data-testid="font-size-control"]')!;
    const indicator = host.querySelector<HTMLElement>('[data-testid="font-size-control-indicator"]')!;
    let captured: number | null = null;
    Object.defineProperties(control, {
      setPointerCapture: { value: (id: number) => { captured = id; } },
      hasPointerCapture: { value: (id: number) => captured === id },
      releasePointerCapture: { value: () => { captured = null; } },
    });
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 32));
    async function pointer(type: string, clientX: number) {
      await act(async () => {
        const event = new MouseEvent(type, { bubbles: true, button: 0, clientX });
        Object.defineProperty(event, "pointerId", { value: 1 });
        control.dispatchEvent(event);
      });
    }
    expect(indicator.classList.contains("duration-200")).toBe(true);
    expect(indicator.classList.contains("duration-0")).toBe(false);
    await pointer("pointerdown", 150);
    await pointer("pointermove", 250);
    expect(indicator.classList.contains("duration-0")).toBe(true);
    expect(indicator.classList.contains("duration-200")).toBe(false);
    expect(document.documentElement.getAttribute("data-font-size")).toBe("larger");
    expect(indicator.style.transform).toBe("translateX(200%)");
    expect(getFontSize()).toBe("default");
    expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBeNull();
    await pointer("pointercancel", 250);
    expect(captured).toBeNull();
    expect(indicator.classList.contains("duration-200")).toBe(true);
    expect(indicator.classList.contains("duration-0")).toBe(false);
    expect(indicator.style.transform).toBe("translateX(100%)");
    expect(document.documentElement.getAttribute("data-font-size")).toBe("default");
    expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBeNull();
  });
  it("applies and restores the original device font/density preferences from the shared controls", async () => {
    localStorage.clear();
    initializeFontSizePreference();
    initializeConversationDensityPreference();
    const host = await render(<ConversationDisplaySettings locale="zh-CN" />);
    expect(host.textContent).toContain("字号");
    await click(button(host, "较大"));
    await click(button(host, "宽松"));
    expect(document.documentElement.getAttribute("data-font-size")).toBe(
      "larger",
    );
    expect(
      document.documentElement.getAttribute("data-conversation-density"),
    ).toBe("spacious");
    expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe("larger");
    expect(localStorage.getItem(CONVERSATION_DENSITY_STORAGE_KEY)).toBe(
      "spacious",
    );
    await act(async () => {
      setFontSize("smaller");
      setConversationDensity("compact");
      localStorage.setItem(FONT_SIZE_STORAGE_KEY, "larger");
      localStorage.setItem(CONVERSATION_DENSITY_STORAGE_KEY, "spacious");
      initializeFontSizePreference();
      initializeConversationDensityPreference();
    });
    expect(button(host, "较大").getAttribute("aria-pressed")).toBe("true");
    expect(button(host, "宽松").getAttribute("aria-pressed")).toBe("true");
    expect(
      host.querySelector('[data-testid="conversation-preview-content"]'),
    ).not.toBeNull();
  });
  it("synchronizes storage changes, rejects unknown choices and keeps previews transient", async () => {
    initializeFontSizePreference();
    initializeConversationDensityPreference();
    const host = await render(<ConversationDisplaySettings locale="en" />);
    await act(async () => {
      setFontSize("default");
      previewFontSize("larger");
    });
    expect(getFontSize()).toBe("default");
    expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe("default");
    expect(document.documentElement.getAttribute("data-font-size")).toBe(
      "larger",
    );
    previewFontSize(null);
    expect(document.documentElement.getAttribute("data-font-size")).toBe(
      "default",
    );
    await act(async () => {
      localStorage.setItem(FONT_SIZE_STORAGE_KEY, "unknown");
      localStorage.setItem(CONVERSATION_DENSITY_STORAGE_KEY, "unknown");
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(getFontSize()).toBe("default");
    expect(getConversationDensity()).toBe("comfortable");
    expect(button(host, "Default").getAttribute("aria-pressed")).toBe("true");
    expect(button(host, "Comfy").getAttribute("aria-pressed")).toBe("true");
  });
  it("keeps the live settings effective when device storage is unavailable", async () => {
    const host = await render(<ConversationDisplaySettings locale="en" />);
    const denied = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    try {
      await click(button(host, "Smaller"));
      await click(button(host, "Compact"));
      expect(document.documentElement.getAttribute("data-font-size")).toBe(
        "smaller",
      );
      expect(
        document.documentElement.getAttribute("data-conversation-density"),
      ).toBe("compact");
    } finally {
      denied.mockRestore();
    }
  });
  it("selects the original profile and existing sections without generating unsupported controls", async () => {
    function Host() {
      const [section, setSection] = useState<SettingsSection>("appearance");
      return (
        <SettingsPage locale="zh-CN" section={section} onSelect={setSection}>
          {section}
        </SettingsPage>
      );
    }
    const host = await render(<Host />);
    await click(host.querySelector<HTMLButtonElement>('[data-testid="settings-nav-notifications"]')!);
    expect(
      host.querySelector('[data-testid="settings-panel-notifications"]')
        ?.textContent,
    ).toBe("notifications");
    await click(host.querySelector<HTMLButtonElement>('[data-testid="settings-nav-shortcuts"]')!);
    expect(
      host.querySelector('[data-testid="settings-panel-shortcuts"]'),
    ).not.toBeNull();
    await click(host.querySelector<HTMLButtonElement>('[data-testid="settings-nav-profile"]')!);
    expect(host.querySelector('[data-testid="settings-panel-profile"]')?.textContent).toBe("profile");
    expect([...host.querySelectorAll('[data-testid^="settings-nav-"]')].map(node => node.getAttribute("data-testid"))).toEqual([
      "settings-nav-profile", "settings-nav-appearance", "settings-nav-notifications", "settings-nav-shortcuts", "settings-nav-custom-emoji",
    ]);
    expect(host.querySelector('[data-sidebar="menu-label"] [aria-hidden="true"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="settings-content-scroll"]')).not.toBeNull();
    expect(host.textContent).not.toMatch(/provider|私钥|配对|语言/);
  });
  it("does not advertise Desktop commands when the host only supplies Web Enter", async () => {
    const host = await render(
      <ShortcutSettings
        locale="en"
        shortcuts={[
          {
            id: "send-message",
            keys: "Enter",
            ...shortcutText("en", "send-message")!,
          },
        ]}
      />,
    );
    expect(host.querySelectorAll("kbd")).toHaveLength(1);
    expect(host.textContent).toContain("Enter");
    expect(host.textContent).not.toContain("Ctrl+K");
    expect(shortcutText("zh-CN", "format-bold")?.label).toBe("粗体");
    expect(shortcutText("en", "unregistered-command")).toBeNull();
  });
  it("retains the original shortcut categories and per-key presentation", async () => {
    const host = await render(<ShortcutSettings locale="zh-CN" shortcuts={[
      { id: "open-settings", keys: "Ctrl+,", category: "Navigation", ...shortcutText("zh-CN", "open-settings")! },
      { id: "format-strikethrough", keys: "Ctrl+Shift+X", category: "Formatting", ...shortcutText("zh-CN", "format-strikethrough")! },
      { id: "format-bold", keys: "⌘B", category: "Formatting", ...shortcutText("zh-CN", "format-bold")! },
      { id: "zoom-in", keys: "⌘+", category: "Formatting", ...shortcutText("zh-CN", "zoom-in")! },
    ]} />);
    expect([...host.querySelectorAll("h2")].map((el) => el.textContent)).toEqual(["导航", "格式"]);
    expect([...host.querySelectorAll('[data-shortcut="format-strikethrough"] kbd')].map((el) => el.textContent)).toEqual(["Ctrl", "Shift", "X"]);
    expect([...host.querySelectorAll('[data-shortcut="format-bold"] kbd')].map((el) => el.textContent)).toEqual(["⌘B"]);
    expect([...host.querySelectorAll('[data-shortcut="zoom-in"] kbd')].map((el) => el.textContent)).toEqual(["⌘+"]);
    expect(host.querySelectorAll('[data-slot="settings-section-card"]')).toHaveLength(2);
  });
});
