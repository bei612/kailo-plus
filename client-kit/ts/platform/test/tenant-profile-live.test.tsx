import { act, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { PlatformSessionAccessMode, type PlatformSessionView, type TenantProfileView } from "@client-kit/contracts";
import { createBffClient, type BffClient } from "../src/client";
import { PlatformProvider, TenantProfileSessionCache } from "../src/react/context";
import { SidebarProfileCard } from "../src/react/sidebar/sidebar-profile-card";
import { TenantProfileDialog } from "../src/react/tenant-profile/TenantProfileDialog";
import { watchTenantProfile } from "../src/react/tenant-profile/live";
import type { BffRequest, BffReply } from "../src/transport";
import { button, click, render, settle, type, until } from "./render";

const stops: (() => void)[] = [];
afterEach(() => stops.splice(0).forEach(stop => stop()));
const session = (id: string): PlatformSessionView => ({ tenantId: "tenant", tenantName: "Before",
  tenantPrincipalId: id, tenantMembershipId: `member-${id}`, humanIdentityId: id,
  platformSessionId: `session-${id}`, displayName: id, accessMode: PlatformSessionAccessMode.Full });

function Host({ client, id, cache, desktop = false }: { client: BffClient; id: string; cache: QueryClient; desktop?: boolean }) {
  const [current, setCurrent] = useState(session(id));
  const [outer] = useState(() => new QueryClient());
  const contents = <>
    <div data-testid={`session-${id}`}>{current.tenantName}</div>
    <SidebarProfileCard communityLabel="Stale host label" resolvedDisplayName={id} avatar={<span/>} popoverAvatar={<span/>}
      onOpenSettings={() => {}} onSignOut={() => {}}/>
    {id === "admin" ? <TenantProfileDialog open onOpenChange={() => {}}/> : null}
  </>;
  return <QueryClientProvider client={desktop ? outer : cache}><PlatformProvider client={client} currentPrincipalId={id}
    feedbackClient={desktop ? "DESKTOP" : "WEB"} liveTenantProfile locale="en"
    onTenantProfile={profile => setCurrent(old => ({ ...old, tenantName: profile?.name }))}>
    {desktop ? <QueryClientProvider client={cache}><TenantProfileSessionCache/>{contents}</QueryClientProvider> : contents}
  </PlatformProvider></QueryClientProvider>;
}

describe("DD-158 independent online profile consumers", () => {
  it("updates another member's real sidebar and both host session views after the original governed form saves", async () => {
    let profile: TenantProfileView = { name: "Before", version: 3, icon: "🎉", refreshAfterMillis: 5 };
    const waiting: { id: string; resolve: (reply: BffReply) => void }[] = [];
    const paths: string[] = [];
    const snapshot = (id: string) => ({ ...profile, ...(id === "admin" ? { updateActionKey: "tenant.profile.update" } : {}) });
    const client = (id: string) => createBffClient({ send: async (request: BffRequest): Promise<BffReply> => {
      if (request.method === "POST") {
        const body = request.body as { resourceVersion: number; tenantProfile: { name: string } };
        expect(request.path).toBe("/api/v1/actions"); expect(body.resourceVersion).toBe(profile.version);
        profile = { ...profile, version: profile.version + 1, name: body.tenantProfile.name };
        for (const reader of waiting.splice(0)) reader.resolve({ status: 200, body: snapshot(reader.id) });
        return { status: 200, body: { actionKey: "tenant.profile.update", actionExecutionId: "ae", operationId: "op", gateState: "ALLOWED", dispatchState: "DISPATCHED" } };
      }
      paths.push(request.path); expect(request.fresh).toBe(true);
      const after = new URL(request.path, "https://core.invalid").searchParams.get("afterVersion");
      if (after !== null && Number(after) === profile.version)
        return new Promise(resolve => waiting.push({ id, resolve }));
      return { status: 200, body: snapshot(id) };
    } });
    const web = new QueryClient(), desktop = new QueryClient();
    web.setQueryData(["platform", "session"], session("admin"));
    desktop.setQueryData(["platform", "session"], session("member"));
    const first = await render(<Host client={client("admin")} id="admin" cache={web}/>);
    const second = await render(<Host client={client("member")} id="member" cache={desktop} desktop/>);
    await until(() => waiting.length >= 2, "both independently admitted watches");
    const form = document.querySelector<HTMLElement>('[data-testid="tenant-profile-dialog"]')!;
    await type(form.querySelector<HTMLInputElement>('[data-testid="tenant-profile-name"]')!, "After");
    await click(form.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    await click(button(form, "Save profile"));
    await until(() => second.querySelector('[data-testid="sidebar-profile-card"]')?.textContent?.includes("After") === true, "other member's live sidebar");
    expect(first.querySelector('[data-testid="session-admin"]')?.textContent).toBe("After");
    expect(second.querySelector('[data-testid="session-member"]')?.textContent).toBe("After");
    expect(desktop.getQueryData<PlatformSessionView>(["platform", "session"])?.tenantName).toBe("After");
    expect(second.querySelector('[data-testid="sidebar-profile-card"]')?.textContent).toContain("🎉");
    expect(paths).toContain("/api/v1/tenant/profile?afterVersion=3");
  });

  it("discards a late answer after the authenticated consumer retires", async () => {
    let resolve!: (reply: BffReply) => void;
    const seen: TenantProfileView[] = [];
    const client = createBffClient({ send: () => new Promise(reply => { resolve = reply; }) });
    const stop = watchTenantProfile(client, profile => seen.push(profile));
    stop(); resolve({ status: 200, body: { name: "Old identity", version: 3, refreshAfterMillis: 5 } });
    await settle(); expect(seen).toEqual([]);
  });

  it("clears the actual nested Desktop display cache and sidebar after a fresh membership refusal", async () => {
    let refuse!: (reply: BffReply) => void;
    let calls = 0;
    const client = createBffClient({ send: async () => {
      calls++;
      if (calls === 1) return { status: 200, body: { name: "Before", icon: "🎉", version: 3, refreshAfterMillis: 5 } };
      return new Promise<BffReply>(reply => { refuse = reply; });
    } });
    const cache = new QueryClient(); cache.setQueryData(["platform", "session"], session("member"));
    const host = await render(<Host client={client} id="member" cache={cache} desktop/>);
    await until(() => !!refuse, "pending fresh membership read");
    await act(async () => refuse({ status: 403, body: {} }));
    await until(() => !host.querySelector('[data-testid="sidebar-profile-card"]')?.textContent?.includes("Before"), "retired display cleared");
    expect(host.querySelector('[data-testid="sidebar-profile-card"]')?.textContent).not.toContain("🎉");
    expect(cache.getQueryData<PlatformSessionView>(["platform", "session"])?.tenantName).toBeUndefined();
    expect(cache.getQueryData<PlatformSessionView>(["platform", "session"])?.tenantPrincipalId).toBe("member");
    window.dispatchEvent(new Event("online")); await settle(); expect(calls).toBe(2);
  });

  it("retries the first unavailable read using the existing query backoff", async () => {
    let calls = 0;
    const seen: TenantProfileView[] = [];
    const client = createBffClient({ send: async () => ++calls === 1
      ? { status: 503, body: {} } : { status: 200, body: { name: "Recovered", version: 2 } } });
    stops.push(watchTenantProfile(client, profile => seen.push(profile)));
    await until(() => seen.length === 1, "first read recovered");
    expect(calls).toBe(2); expect(seen[0]?.name).toBe("Recovered");
  });

  it("keeps an online hint that arrives while the first failed request is still in flight", async () => {
    let reply!: (reply: BffReply) => void;
    let calls = 0;
    const seen: TenantProfileView[] = [];
    const client = createBffClient({ send: async () => {
      calls++; return calls === 1 ? new Promise<BffReply>(resolve => { reply = resolve; })
        : { status: 200, body: { name: "Online again", version: 2 } };
    } });
    stops.push(watchTenantProfile(client, profile => seen.push(profile)));
    window.dispatchEvent(new Event("online")); reply({ status: 503, body: {} });
    await settle(); expect(calls).toBe(2); expect(seen[0]?.name).toBe("Online again");
  });

  it("keeps older Core's snapshot without fabricating a background polling interval", async () => {
    let calls = 0;
    const seen: TenantProfileView[] = [];
    const client = createBffClient({ send: async () => { calls++; return { status: 200, body: { name: "Legacy", version: 1 } }; } });
    stops.push(watchTenantProfile(client, profile => seen.push(profile)));
    await settle(); await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(calls).toBe(1); expect(seen[0]?.name).toBe("Legacy");
  });
});
