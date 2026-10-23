// DD-131(2)、DD-42：Agent 快照导出对话框（Web/Desktop 同一实现）——受治理提交、owner 批准等待、READY 后保存。
import { describe, expect, it, vi } from "vitest";
import type { ActionCommand, ExportPackageView } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import {
  AgentSnapshotExportDialog,
  validExportView,
  type SnapshotExportHost,
  type SnapshotExportTarget,
} from "../src/react/agent-library/AgentSnapshotExportDialog";
import type { BffReply, BffRequest, BffTransport } from "../src/transport";
import { act } from "react";
import { click, render, settle } from "./render";

const target: SnapshotExportTarget = {
  resourceId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", resourceVersion: 3, displayName: "Writer",
  versionAssetId: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a",
};
const executionId = "4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c";
const packageId = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";
const ready: ExportPackageView = {
  packageAssetId: packageId, actionExecutionId: executionId, sourceResourceId: target.resourceId,
  sourceAssetId: target.versionAssetId, formatKey: "buzz-agent-snapshot@1", mediaType: "image/png",
  state: "READY" as ExportPackageView["state"], contentDigest: "a".repeat(64), byteSize: 2048,
  fileName: "Writer.agent.png", downloadPath: `/api/v1/export-packages/${packageId}/content`,
};

type Route = (request: BffRequest) => BffReply | Promise<BffReply>;
function transport(route: Route): BffTransport & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(async (request: BffRequest) => route(request)) };
}
function actions(t: { send: ReturnType<typeof vi.fn> }): ActionCommand[] {
  return t.send.mock.calls.map(([request]) => request as BffRequest)
    .filter((request) => request.path === "/api/v1/actions").map((request) => request.body as ActionCommand);
}
function submitted(gateState: string, dispatchState = "NOT_DISPATCHED"): Route {
  return (request) => request.path === "/api/v1/actions"
    ? { status: 202, body: { actionKey: "agent.definition.export", actionExecutionId: executionId,
      operationId: "5a6b7c8d-9e0f-4a1b-8c3d-4e5f6a7b8c9d", gateState, dispatchState } }
    : { status: 404, body: {} };
}

async function choose(selector: string, value: string): Promise<void> {
  const field = document.querySelector<HTMLSelectElement>(selector)!;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

describe("agent snapshot export", () => {
  it("trusts a package view only for the exact export and only exposes bytes when READY", () => {
    expect(validExportView(ready, executionId, target)).toBe(true);
    expect(validExportView({ ...ready, actionExecutionId: packageId }, executionId, target)).toBe(false);
    expect(validExportView({ ...ready, sourceAssetId: packageId }, executionId, target)).toBe(false);
    expect(validExportView({ ...ready, downloadPath: "/api/v1/profile/media/abc" }, executionId, target)).toBe(false);
    const creating = { ...ready, state: "CREATING" as ExportPackageView["state"], contentDigest: undefined,
      fileName: undefined, downloadPath: undefined, byteSize: undefined };
    expect(validExportView(creating, executionId, target)).toBe(true);
  });

  it("submits the governed export for the published version and waits for the owner without claiming success", async () => {
    const t = transport(submitted("WAITING"));
    const host = await render(<PlatformProvider client={createBffClient(t)} locale="en">
      <AgentSnapshotExportDialog target={target} onClose={() => {}} />
    </PlatformProvider>);
    expect(document.querySelector('[data-testid="agent-snapshot-export-memory"]')?.textContent).toBe("Agent only");
    await choose('[data-testid="agent-snapshot-export-format"]', "application/json");
    await click(document.querySelector<HTMLButtonElement>('[data-testid="agent-snapshot-export-confirm"]')!);
    await settle();
    expect(actions(t)).toEqual([expect.objectContaining({
      actionKey: "agent.definition.export", resourceId: target.resourceId, resourceVersion: 3,
      agentDefinitionExport: { versionAssetId: target.versionAssetId, mediaType: "application/json" },
    })]);
    expect(actions(t)[0]).not.toHaveProperty("explicitConfirmation");
    expect(document.querySelector('[data-testid="agent-snapshot-export-waiting"]')?.textContent)
      .toContain("Waiting for the agent owner to approve");
    expect(document.querySelector('[data-testid="agent-snapshot-export-save"]')).toBeNull();
    host.remove();
  });

  it("offers Save only once the package is READY and hands the exact package to the host", async () => {
    const t = transport((request) => request.path === `/api/v1/export-packages/by-action/${executionId}`
      ? { status: 200, body: ready } : submitted("ALLOWED", "DISPATCHED")(request));
    const save = vi.fn(async () => true);
    const exportHost: SnapshotExportHost = { save };
    const host = await render(<PlatformProvider client={createBffClient(t)} locale="zh-CN">
      <AgentSnapshotExportDialog target={target} host={exportHost} onClose={() => {}} />
    </PlatformProvider>);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="agent-snapshot-export-confirm"]')!);
    await settle(); await settle();
    expect(document.querySelector('[data-testid="agent-snapshot-export-ready"]')?.textContent).toContain("Writer.agent.png 已就绪");
    await click(document.querySelector<HTMLButtonElement>('[data-testid="agent-snapshot-export-save"]')!);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ packageAssetId: packageId, fileName: "Writer.agent.png",
      downloadPath: `/api/v1/export-packages/${packageId}/content` }));
    expect(actions(t)).toHaveLength(1);
    host.remove();
  });

  it("copies the verified PNG package so it can be pasted into a DM or channel", async () => {
    const pkg = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);
    const { sha256Hex } = await import("../src/react/agent-library/AgentSnapshotImportDialog");
    const view = { ...ready, byteSize: pkg.length, contentDigest: await sha256Hex(pkg) };
    const t = transport((request) => request.path === `/api/v1/export-packages/by-action/${executionId}`
      ? { status: 200, body: view } : submitted("ALLOWED", "DISPATCHED")(request));
    const written: ClipboardItem[][] = [];
    class FakeItem { constructor(readonly items: Record<string, Blob>) {} }
    vi.stubGlobal("ClipboardItem", FakeItem);
    Object.defineProperty(navigator, "clipboard", { configurable: true,
      value: { write: vi.fn(async (items: ClipboardItem[]) => { written.push(items); }) } });
    const host = await render(<PlatformProvider client={createBffClient(t)} locale="en">
      <AgentSnapshotExportDialog target={target} host={{ save: vi.fn(), readBytes: async () => pkg }} onClose={() => {}} />
    </PlatformProvider>);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="agent-snapshot-export-confirm"]')!);
    await settle(); await settle();
    await click(document.querySelector<HTMLButtonElement>('[data-testid="agent-snapshot-export-copy"]')!);
    await settle();
    expect(written).toHaveLength(1);
    const item = written[0]![0] as unknown as FakeItem;
    expect(Object.keys(item.items).sort()).toEqual(["image/png", "text/html"]);
    const html = await new Promise<string>((resolve) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(item.items["text/html"]!);
    });
    expect(html).toContain("data-buzz-agent-snapshot");
    expect(document.body.textContent).toContain("Copied.");
    vi.unstubAllGlobals();
    host.remove();
  });

  it("keeps the same idempotency key when the outcome is unknown", async () => {
    let calls = 0;
    const t = transport((request) => {
      if (request.path !== "/api/v1/actions") return { status: 404, body: {} };
      calls += 1;
      return calls === 1 ? { status: 503, body: { class: "UNKNOWN", operationId: "op" } }
        : submitted("WAITING")(request);
    });
    const host = await render(<PlatformProvider client={createBffClient(t)} locale="en">
      <AgentSnapshotExportDialog target={target} onClose={() => {}} />
    </PlatformProvider>);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="agent-snapshot-export-confirm"]')!);
    await settle();
    await click(document.querySelector<HTMLButtonElement>('[data-testid="agent-snapshot-export-confirm"]')!);
    await settle();
    const sent = actions(t);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.idempotencyKey).toBe(sent[0]!.idempotencyKey);
    host.remove();
  });
});
