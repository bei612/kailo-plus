import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { AgentDefinitionsPage } from "../src/react/agents";
import { PlatformProvider } from "../src/react/context";
import { PersonaDropdownField } from "../src/react/agent-library/PersonaDropdownField";
import { AgentCreationPreview } from "../src/react/agent-library/AgentCreationPreview";
import { AgentIdentityFields } from "../src/react/agent-library/AgentDescriptionField";
import { AvatarHostProvider, type AvatarHost } from "../src/react/profile/avatar-host";
import type { BffReply, BffRequest } from "../src/transport";
import { button, click, render, settle, type } from "./render";

const definition = { resourceId: "definition", displayName: "Library Agent", stableSlug: "library-agent",
  ownerPrincipalId: "owner", resourceVersion: 1, resourceState: "ACTIVE", status: "ACTIVE" };

describe("original Agent identity and avatar module", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());
  const client = createBffClient({ send: async () => ({ status: 503, body: undefined }) });
  function Avatar({ host, changed, pending }: { host: AvatarHost; changed: (url: string) => void; pending: (value: boolean) => void }) {
    const [avatar, setAvatar] = useState("");
    return <PlatformProvider client={client} locale={host.locale}><AvatarHostProvider value={host}>
      <AgentCreationPreview label="Agent" assetLabel={host.locale === "zh-CN" ? "头像" : "avatar"} avatarUrl={avatar || null}
        onSelectAvatar={(url) => { setAvatar(url); changed(url); }} onClearAvatar={() => { setAvatar(""); changed(""); }}
        onUploadPendingChange={pending} />
    </AvatarHostProvider></PlatformProvider>;
  }

  it("retains the original URL picker and clear action with translated labels and no profile write", async () => {
    const upload = vi.fn(); const changed = vi.fn(); const pending = vi.fn();
    const host = await render(<Avatar host={{ locale: "zh-CN", uploadMediaBytes: upload,
      rewriteMediaUrl: (url) => url, performDefaultHaptic: () => {} }} changed={changed} pending={pending} />);
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="添加头像"]')!);
    const picker = document.querySelector<HTMLElement>('fieldset[aria-label="头像选择器"]')!;
    expect(picker).not.toBeNull();
    const input = picker.querySelector<HTMLInputElement>('input[type="url"]')!;
    await type(input, "https://community.example/media/actual.png");
    await click(button(picker, "应用"));
    expect(changed).toHaveBeenLastCalledWith("https://community.example/media/actual.png");
    expect(upload).not.toHaveBeenCalled();
    await click(host.querySelector<HTMLButtonElement>('button[aria-label="编辑头像"]')!);
    await click(button(document.querySelector<HTMLElement>('fieldset[aria-label="头像选择器"]')!, "移除头像"));
    expect(changed).toHaveBeenLastCalledWith("");
  });

  it("uploads real image bytes through the host and exposes pending until completion", async () => {
    let complete!: (value: { url: string; type: string }) => void;
    const upload = vi.fn(() => new Promise<{ url: string; type: string }>((resolve) => { complete = resolve; }));
    const changed = vi.fn(); const pending = vi.fn();
    const host = await render(<Avatar host={{ locale: "en", uploadMediaBytes: upload,
      rewriteMediaUrl: (url) => url, performDefaultHaptic: () => {} }} changed={changed} pending={pending} />);
    const file = new File([new Uint8Array([137, 80, 78, 71])], "agent.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([137, 80, 78, 71]).buffer });
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await settle();
    expect(upload).toHaveBeenCalledExactlyOnceWith([137, 80, 78, 71]);
    expect(pending).toHaveBeenLastCalledWith(true);
    expect(changed).not.toHaveBeenCalled();
    await act(async () => complete({ url: "https://community.example/media/image.png", type: "image/png" }));
    expect(pending).toHaveBeenLastCalledWith(false);
    expect(changed).toHaveBeenCalledExactlyOnceWith("https://community.example/media/image.png");
  });

  it("uses the original Unicode edit limit without mutating a loaded historical value", async () => {
    const description = "😀".repeat(300); const changed = vi.fn(); const named = vi.fn();
    const host = await render(<PlatformProvider client={client} locale="en">
      <AgentIdentityFields displayName="Agent" description={description} onDisplayNameChange={named}
        onDescriptionChange={changed} disabled={false} />
    </PlatformProvider>);
    const input = host.querySelector<HTMLInputElement>("#persona-description")!;
    expect(input.value).toBe(description);
    expect(changed).not.toHaveBeenCalled();
    expect(host.textContent).toContain("300/280");
    await type(host.querySelector<HTMLInputElement>("#persona-display-name")!, "Different name");
    expect(named).toHaveBeenCalledWith("Different name");
    expect(changed).not.toHaveBeenCalled();
    await type(input, `${description}x`);
    expect(changed).toHaveBeenCalledExactlyOnceWith("😀".repeat(280));
  });
});

describe("original Agent configuration picker", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("retains the native scroll boundary and selects only a real enabled directory option", async () => {
    const select = vi.fn();
    const host = await render(<PersonaDropdownField id="profile" value="" placeholder="选择已查证的记录"
      onValueChange={select} options={[{ value: "unavailable", label: "不可用", disabled: true },
        { value: "available", label: "已授权配置" }]} />);
    const trigger = host.querySelector<HTMLButtonElement>("button")!;
    expect(trigger.className).toContain("h-11");
    await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await settle();
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu.querySelector(".overscroll-contain")).not.toBeNull();
    const items = menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    expect(items[0]?.getAttribute("aria-disabled")).toBe("true");
    await click(items[0]!);
    expect(select).not.toHaveBeenCalled();
    await click(items[1]!);
    expect(select).toHaveBeenCalledExactlyOnceWith("available");
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("does not substitute a default for a missing record or unlock a disabled editor", async () => {
    const select = vi.fn();
    const host = await render(<PersonaDropdownField id="profile" value="stale-profile" placeholder="Choose a verified record"
      disabled onValueChange={select} options={[{ value: "different-profile", label: "Different profile" }]} />);
    const trigger = host.querySelector<HTMLButtonElement>("button")!;
    expect(trigger.disabled).toBe(true);
    expect(trigger.textContent).toBe("Choose a verified record");
    await click(trigger);
    expect(select).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
async function setup(reply?: (request: BffRequest) => BffReply | undefined, locale: "en" | "zh-CN" = "en") {
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
    const result = reply?.(request);
    if (result) return result;
    if (request.path === "/api/v1/tasks") return { status: 200, body: [] };
    if (request.path === "/api/v1/agent-definitions") return { status: 200, body: { definitions: [definition] } };
    if (request.path === "/api/v1/agent-definitions/definition") return { status: 200, body: definition };
    if (request.path.startsWith("/api/v1/agent-definitions/definition/versions?")) return { status: 200, body: {
      agentResourceId: "definition", resourceVersion: 1, versions: [] } };
    if (request.path.startsWith("/api/v1/agent-definitions/definition/version-configuration?")) return { status: 200,
      body: { agentResourceId: "definition", resourceVersion: 1, profiles: [], routes: [], canCreate: false } };
    if (request.path === "/api/v1/workspaces") return { status: 200, body: [] };
    if (request.path.startsWith("/api/v1/platform-tools?")) return { status: 200, body: { tools: [] } };
    return { status: 503, body: undefined };
  });
  const host = await render(<PlatformProvider client={createBffClient({ send })} locale={locale}>
    <AgentDefinitionsPage />
  </PlatformProvider>);
  await settle();
  return { host, send };
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
async function fillDefinition() {
  const fields = dialog().querySelectorAll<HTMLInputElement>("input");
  await type(fields[0]!, "New Agent"); await type(fields[1]!, "new-agent");
}
async function escape() {
  await act(async () => dialog().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
}

describe("original Agent library governed dialogs", () => {
  it("keeps technical forms out of the library and uses the actual definition and tool readers", async () => {
    const { host, send } = await setup();
    expect(host.querySelector("form")).toBeNull();
    expect(dialog()).toBeNull();
    expect(send.mock.calls.some(([r]) => r.path.startsWith("/api/v1/platform-tools"))).toBe(false);
    await click(button(host, "View definition"));
    expect(dialog().querySelector('[data-testid="agent-definition-detail"]')).not.toBeNull();
    expect(dialog().textContent).toContain("Library Agent");
    await click(button(dialog(), "Close"));
    await click(button(host, "Platform tools"));
    expect(dialog().querySelector('[data-testid="platform-tools"]')).not.toBeNull();
    expect(send).toHaveBeenCalledWith({ method: "GET", path: "/api/v1/platform-tools?offset=0" });
    expect(send.mock.calls.every(([r]) => r.method === "GET")).toBe(true);
  });

  it("preserves the unsubmitted definition draft when the original shell closes and reopens", async () => {
    const { host } = await setup();
    await click(host.querySelector<HTMLElement>('[data-testid="new-agent-card"]')!);
    await fillDefinition();
    await click(button(dialog(), "Close"));
    expect(dialog()).toBeNull();
    await click(host.querySelector<HTMLElement>('[data-testid="new-agent-card"]')!);
    expect([...dialog().querySelectorAll("input")].map((field) => field.value)).toEqual(["New Agent", "new-agent"]);
  });

  it("retains UNKNOWN on a refused recheck, prevents dismissal, and sends only the same frozen command", async () => {
    let count = 0;
    const { host, send } = await setup((r) => r.method === "POST" ? ++count === 1 ? { status: 202, body: {
      actionKey: "agent.definition.create", actionExecutionId: "execution", operationId: "operation",
      gateState: "ALLOWED", dispatchState: "UNKNOWN" } } : { status: 403, body: undefined } : undefined);
    await click(host.querySelector<HTMLElement>('[data-testid="new-agent-card"]')!);
    await fillDefinition();
    await click(button(dialog(), "Review request"));
    await click(button(dialog(), "Submit governed request"));
    expect([...dialog().querySelectorAll("button")].some((node) => node.textContent === "Close")).toBe(false);
    await escape();
    expect(dialog()).not.toBeNull();
    await click(button(dialog(), "Re-check same request"));
    expect(dialog().textContent).toContain("Outcome is not confirmed.");
    expect(dialog().textContent).not.toContain("Request recorded.");
    await escape();
    expect(dialog()).not.toBeNull();
    await click(button(dialog(), "Re-check same request"));
    const writes = send.mock.calls.map(([r]) => r).filter((r) => r.method === "POST");
    expect(writes).toHaveLength(3);
    expect(writes[1]?.body).toEqual(writes[0]?.body);
    expect(writes[2]?.body).toEqual(writes[0]?.body);
  });

  it("uses the same Chinese shell and existing labels rather than English management chrome", async () => {
    const { host } = await setup(undefined, "zh-CN");
    await click(button(host, "查看定义"));
    expect(dialog().textContent).toContain("查看定义");
    expect(dialog().textContent).not.toContain("View definition");
    await click(button(dialog(), "关闭"));
    await click(button(host, "平台原生工具"));
    expect(dialog().textContent).toContain("平台原生工具");
  });
});
