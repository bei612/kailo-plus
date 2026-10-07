import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { AgentDefinitionsPage } from "../src/react/agents";
import { PlatformProvider } from "../src/react/context";
import { PersonaDropdownField } from "../src/react/agent-library/PersonaDropdownField";
import type { BffReply, BffRequest } from "../src/transport";
import { button, click, render, settle, type } from "./render";

const definition = { resourceId: "definition", displayName: "Library Agent", stableSlug: "library-agent",
  ownerPrincipalId: "owner", resourceVersion: 1, resourceState: "ACTIVE", status: "ACTIVE" };

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
