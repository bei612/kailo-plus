// DD-140 / SF-BUZ-61(2): Buzz 779af8886caae1317b4de962082429867ab61503 ProjectChannelRequestDialog
// over the viewer's pending approvals; Cancel = DENY, Create channel = APPROVE.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalStatus, type ApprovalView } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { setLocale } from "../src/i18n";
import { PlatformProvider } from "../src/react/context";
import type { BffReply, BffRequest } from "../src/transport";
import { click, render, settle } from "./render";

const viewer = "b".repeat(64);
const home = "11111111-1111-4111-8111-111111111111";
vi.mock("../src/react/projects/projectEnumeration", async (original) => ({
  ...await original<typeof import("../src/react/projects/projectEnumeration")>(),
  loadProjectDirectory: async () => ({ viewerPubkey: viewer, projects: [
    { id: "p", name: "Apollo", owner: viewer, channelId: home, relatedChannelIds: [], projectAddress: `30621:${viewer}:apollo` }] }),
}));
vi.mock("../src/react/projects/ProjectChannelManagement", () => ({ useProjectChannelLinking: () => ({ busy: false, record: vi.fn() }) }));
const { ProjectChannelRequestDialog, ProjectChannelRequestDetails } = await import("../src/react/projects/ProjectChannelRequestDialog");

beforeEach(() => { setLocale("en"); vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })); });
afterEach(() => vi.unstubAllGlobals());

const approval = (homeChannelId: string): ApprovalView => ({ workflowId: "wf-1", actionExecutionId: "22222222-2222-4222-8222-222222222222",
  actionKey: "workspace.create", targetType: "WORKSPACE", targetId: "33333333-3333-4333-8333-333333333333",
  initiatorPrincipalId: "44444444-4444-4444-8444-444444444444", status: ApprovalStatus.Waiting,
  expiresAt: "2999-01-01T00:00:00Z", decisions: [], roleRequirements: [],
  projectChannelRequest: { installationResourceId: "55555555-5555-4555-8555-555555555555",
    request: { homeChannelId, name: "launch", description: "Launch prep", visibility: "private", ttlSeconds: 86400 } } } as ApprovalView);

function mount(approvals: ApprovalView[]) {
  const send = vi.fn(async (request: BffRequest): Promise<BffReply> => {
    if (request.path === "/api/v1/approvals") return { status: 200, body: approvals };
    if (request.path.endsWith("/decision")) return { status: 200, body: { status: "APPROVED" } };
    if (request.path.startsWith("/api/v1/tasks/")) return { status: 200, body: { actionExecutionId: approvals[0]!.actionExecutionId,
      actionKey: "workspace.create", actionVersion: 1, operationId: "op", targetId: "t", gateState: "ALLOWED", dispatchState: "DISPATCHED", createdAt: "2026-10-23T00:00:00Z" } };
    return { status: 404, body: {} };
  });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const host = { scopeKey: "s", query: vi.fn(), publish: vi.fn() } as never;
  return { send, ui: <QueryClientProvider client={cache}><PlatformProvider client={createBffClient({ send })} locale="en">
    <ProjectChannelRequestDialog host={host} /></PlatformProvider></QueryClientProvider> };
}
const decisions = (send: ReturnType<typeof mount>["send"]) => send.mock.calls.map(([r]) => r).filter(r => r.path.endsWith("/decision")).map(r => (r.body as { decision: string }).decision);

describe("original project channel request dialog (DD-140)", () => {
  it("shows the original details for a request from the viewer's own project and approves it", async () => {
    const m = mount([approval(home)]);
    await render(m.ui);
    await vi.waitFor(() => expect(document.querySelector('[data-testid="project-channel-request-dialog"]')).not.toBeNull());
    expect(document.body.textContent).toContain("Create project channel?");
    expect(document.body.textContent).toContain("#launch");
    expect(document.body.textContent).toContain("Apollo");
    await click(document.querySelector<HTMLElement>('[data-testid="project-channel-request-approve"]')!);
    await settle();
    expect(decisions(m.send)).toEqual(["APPROVE"]);
  });
  it("ignores a request whose home channel is not one of the viewer's projects", async () => {
    const m = mount([approval("99999999-9999-4999-8999-999999999999")]);
    await render(m.ui);
    await settle();
    expect(document.querySelector('[data-testid="project-channel-request-dialog"]')).toBeNull();
    expect(decisions(m.send)).toEqual([]);
  });
  it("renders the details in Chinese", async () => {
    setLocale("zh-CN");
    const host = await render(<PlatformProvider client={createBffClient({ send: async () => ({ status: 404, body: {} }) })} locale="zh-CN">
      <ProjectChannelRequestDetails request={{ homeChannelId: home, name: "launch", visibility: "open" }} /></PlatformProvider>);
    expect(host.textContent).toContain("名称");
    expect(host.textContent).toContain("公开");
  });
});
