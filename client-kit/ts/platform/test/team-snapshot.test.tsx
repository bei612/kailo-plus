// DD-131(3)：团队快照导入预览与 agent.team.import、团队快照导出与 agent.team.export（Web/Desktop 同一实现）。
import { describe, expect, it, vi } from "vitest";
import type { ActionCommand, AgentTeamView, ExportPackageView } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { sha256Hex } from "../src/react/agent-library/AgentSnapshotImportDialog";
import {
  TeamSnapshotImportDialog,
  teamSnapshotSource,
  type TeamSnapshotSource,
} from "../src/react/agent-library/TeamSnapshotImportDialog";
import {
  TeamSnapshotExportDialog,
  validTeamExportView,
  type TeamSnapshotExportTarget,
} from "../src/react/agent-library/TeamSnapshotExportDialog";
import { TeamShareDialog } from "../src/react/agent-library/TeamShareDialog";
import { SnapshotCard } from "../src/react/messages/SnapshotCard";
import type { BffReply, BffRequest, BffTransport } from "../src/transport";
import { click, render, settle, until } from "./render";

const uploadId = "7c8d9e0f-1a2b-4c3d-9e4f-5a6b7c8d9e0f";
const manifest = new TextEncoder().encode(JSON.stringify({ format: "buzz-team-snapshot", version: 1,
  team: { name: "Release crew", instructions: "Coordinate." },
  members: [{ format: "buzz-agent-snapshot", version: 1, definition: { name: "Writer", systemPrompt: "Write." },
    profile: { displayName: "Writer" } }] }));

function preview(bytes: Uint8Array, digest: string, extra: Record<string, unknown> = {}) {
  return { uploadId, packageDigest: digest, packageByteSize: bytes.length, mediaType: "application/json",
    formatKey: "buzz-team-snapshot@1", expiresAt: "2026-10-28T10:30:00Z", name: "Release crew",
    description: "Ships notes.", teamInstructionsOmitted: true,
    members: [
      { displayName: "Writer", instructions: "Write release notes.", omitted: ["RUNTIME"],
        avatarUrl: `https://buzz.example.test/media/${"b".repeat(64)}.png` },
      { displayName: "Reviewer", instructions: "", omitted: [] },
    ], ...extra };
}

type Route = (request: BffRequest) => BffReply | Promise<BffReply>;
function transport(route: Route): BffTransport & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(async (request: BffRequest) => route(request)) };
}
function actions(t: { send: ReturnType<typeof vi.fn> }): ActionCommand[] {
  return t.send.mock.calls.map(([request]) => request as BffRequest)
    .filter((request) => request.path === "/api/v1/actions").map((request) => request.body as ActionCommand);
}
function importRoutes(digest: string, extra: Record<string, unknown> = {}) {
  return transport((request) => {
    if (request.path === "/api/v1/agent-team-snapshots/uploads") return { status: 200, body: preview(manifest, digest, extra) };
    if (request.path === "/api/v1/actions") {
      const command = request.body as ActionCommand;
      return { status: 202, body: { actionKey: command.actionKey, actionExecutionId: "1f2e3d4c-5b6a-4978-8a6b-5c4d3e2f1a0b",
        operationId: "2f2e3d4c-5b6a-4978-8a6b-5c4d3e2f1a0b", gateState: "ALLOWED", dispatchState: "DISPATCHED" } };
    }
    return { status: 404, body: {} };
  });
}

describe("team snapshot helpers", () => {
  it("classifies only .team.json/.team.png packages within the original team caps", () => {
    expect(teamSnapshotSource("crew.team.json", manifest)).toMatchObject({ mediaType: "application/json" });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    expect(teamSnapshotSource("crew.team.png", png)).toMatchObject({ mediaType: "image/png" });
    expect(teamSnapshotSource("crew.team.png", manifest)).toBe("unsupported");
    expect(teamSnapshotSource("crew.persona.json", manifest)).toBe("unsupported");
    expect(teamSnapshotSource("crew.zip", manifest)).toBe("unsupported");
    // Larger than an agent package, still within the 25 MB team cap.
    expect(teamSnapshotSource("crew.team.json", new Uint8Array(6 * 1024 * 1024).fill(32))).toMatchObject({ mediaType: "application/json" });
    expect(teamSnapshotSource("crew.team.json", new Uint8Array(25 * 1024 * 1024 + 1).fill(32))).toBe("tooLarge");
  });
});

describe("team snapshot import", () => {
  it("previews every member and submits only the frozen upload reference — no slug, no runtime", async () => {
    const digest = await sha256Hex(manifest);
    const t = importRoutes(digest);
    const source = teamSnapshotSource("crew.team.json", manifest) as TeamSnapshotSource;
    const imported = vi.fn();
    await render(<PlatformProvider client={createBffClient(t)} locale="en">
      <TeamSnapshotImportDialog source={source} onClose={() => {}} onImported={imported} />
    </PlatformProvider>);
    await until(() => !!document.querySelector("[data-testid=team-snapshot-import-preview]"), "team import preview");
    const body = document.querySelector("[data-testid=team-snapshot-import-preview]")!;
    expect(body.textContent).toContain("Release crew");
    expect(body.textContent).toContain("Members (2)");
    expect(document.querySelector("[data-testid=team-snapshot-import-instructions-omitted]")).not.toBeNull();
    expect(document.querySelector("[data-testid=team-snapshot-import-member-1-no-instructions]")!.textContent)
      .toContain("add them before publishing");
    expect(document.querySelector("[data-testid=team-snapshot-import-member-0]")!.textContent).toContain("Avatar imported");
    await click(document.querySelector<HTMLButtonElement>("[data-testid=team-snapshot-import-review]")!);
    expect(document.querySelector("[data-testid=team-snapshot-import-confirm]")!.textContent).toContain("2 draft agents");
    await click(document.querySelector<HTMLButtonElement>("[data-testid=team-snapshot-import-submit]")!);
    const [command] = actions(t);
    expect(command).toMatchObject({ actionKey: "agent.team.import", explicitConfirmation: true,
      agentTeamImport: { uploadId, packageDigest: digest } });
    expect(command!.agentTeamImport).toEqual({ uploadId, packageDigest: digest });
    expect(command).not.toHaveProperty("slug");
    expect(imported).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-testid=team-snapshot-import-outcome]")!.textContent)
      .toContain("The team appears once every member is created");
  });

  it.each([
    ["an agent package format", { formatKey: "buzz-agent-snapshot@1" }],
    ["an empty team", { members: [] }],
    ["an unstaged member avatar", { members: [{ displayName: "Writer", instructions: "", omitted: [], avatarUrl: "https://evil.test/a.png" }] }],
    ["an unknown omission", { members: [{ displayName: "Writer", instructions: "", omitted: ["SECRET"] }] }],
  ])("rejects a preview with %s", async (_label, extra) => {
    const digest = await sha256Hex(manifest);
    const source = teamSnapshotSource("crew.team.json", manifest) as TeamSnapshotSource;
    await render(<PlatformProvider client={createBffClient(importRoutes(digest, extra))} locale="en">
      <TeamSnapshotImportDialog source={source} onClose={() => {}} />
    </PlatformProvider>);
    await until(() => !!document.querySelector("[data-testid=team-snapshot-import-rejected]"), "team preview rejection");
    expect(document.querySelector("[data-testid=team-snapshot-import-preview]")).toBeNull();
    expect(document.querySelector("[data-testid=team-snapshot-import-rejected]")).not.toBeNull();
  });

  it("verifies a team card's bytes against imeta before opening the team import preview", async () => {
    const digest = await sha256Hex(manifest);
    const t = importRoutes(digest);
    const host = await render(<PlatformProvider client={createBffClient(t)} locale="zh-CN">
      <SnapshotCard displayName="Release crew" href="/media/t" filename="crew.team.json" size={manifest.length}
        sha256={digest} snapshotKind="team" onDownload={async () => {}} readBytes={async () => manifest} />
    </PlatformProvider>);
    await settle();
    await click(host.querySelector<HTMLButtonElement>("[data-testid=agent-snapshot-card-add]")!);
    // The card hashes the bytes (WebCrypto) before opening the preview, then the preview uploads them.
    await until(() => !!document.querySelector("[data-testid=team-snapshot-import-preview]"), "team import preview from card");
    expect(document.querySelector("[data-testid=team-snapshot-import-preview]")).not.toBeNull();
    expect(t.send.mock.calls.map(([request]) => (request as BffRequest).path)).toContain("/api/v1/agent-team-snapshots/uploads");
    host.remove();
  });

  it("does not open the preview when a team card's bytes do not match imeta", async () => {
    const t = importRoutes("a".repeat(64));
    const host = await render(<PlatformProvider client={createBffClient(t)} locale="en">
      <SnapshotCard displayName="Release crew" href="/media/t" filename="crew.team.json" size={manifest.length}
        sha256={"0".repeat(64)} snapshotKind="team" onDownload={async () => {}} readBytes={async () => manifest} />
    </PlatformProvider>);
    const add = host.querySelector<HTMLButtonElement>("[data-testid=agent-snapshot-card-add]")!;
    await click(add);
    await until(() => !add.disabled, "imeta verification");
    expect(t.send).not.toHaveBeenCalled();
    expect(document.querySelector("[data-testid=team-snapshot-import-preview]")).toBeNull();
    host.remove();
  });
});

const target: TeamSnapshotExportTarget = { resourceId: "9e0f1a2b-3c4d-4e5f-9a6b-7c8d9e0f1a2b", resourceVersion: 2, name: "Release crew" };
const executionId = "1a2b3c4d-5e6f-4a7b-9c8d-9e0f1a2b3c4d";
const packageId = "0f1a2b3c-4d5e-4f6a-8b7c-8d9e0f1a2b3c";
const ready: ExportPackageView = {
  packageAssetId: packageId, actionExecutionId: executionId, sourceResourceId: target.resourceId,
  formatKey: "buzz-team-snapshot@1", mediaType: "image/png", state: "READY" as ExportPackageView["state"],
  contentDigest: "a".repeat(64), byteSize: 4096, fileName: "Release crew.team.png",
  downloadPath: `/api/v1/export-packages/${packageId}/content`,
};
function submitted(gateState: string, dispatchState = "NOT_DISPATCHED"): Route {
  return (request) => request.path === "/api/v1/actions"
    ? { status: 202, body: { actionKey: "agent.team.export", actionExecutionId: executionId,
      operationId: "5a6b7c8d-9e0f-4a1b-8c3d-4e5f6a7b8c9d", gateState, dispatchState } }
    : { status: 404, body: {} };
}

describe("team snapshot export", () => {
  it("trusts only the exact team package and never a single-version agent package", () => {
    expect(validTeamExportView(ready, executionId, target)).toBe(true);
    expect(validTeamExportView({ ...ready, formatKey: "buzz-agent-snapshot@1" }, executionId, target)).toBe(false);
    expect(validTeamExportView({ ...ready, sourceAssetId: packageId }, executionId, target)).toBe(false);
    expect(validTeamExportView({ ...ready, actionExecutionId: packageId }, executionId, target)).toBe(false);
    expect(validTeamExportView({ ...ready, downloadPath: "/elsewhere" }, executionId, target)).toBe(false);
  });

  it("submits the governed team export and waits for every affected owner without claiming success", async () => {
    const t = transport(submitted("WAITING"));
    const host = await render(<PlatformProvider client={createBffClient(t)} locale="en">
      <TeamSnapshotExportDialog target={target} onClose={() => {}} />
    </PlatformProvider>);
    expect(document.querySelector('[data-testid="team-snapshot-export-memory"]')?.textContent).toBe("Team only");
    await click(document.querySelector<HTMLButtonElement>('[data-testid="team-snapshot-export-confirm"]')!);
    await until(() => !!document.querySelector('[data-testid="team-snapshot-export-waiting"]'), "owner approval wait");
    expect(actions(t)).toEqual([expect.objectContaining({
      actionKey: "agent.team.export", resourceId: target.resourceId, resourceVersion: 2,
      agentTeamExport: { mediaType: "image/png" },
    })]);
    expect(actions(t)[0]).not.toHaveProperty("explicitConfirmation");
    expect(document.querySelector('[data-testid="team-snapshot-export-waiting"]')?.textContent)
      .toContain("team owner and every member's owner");
    expect(document.querySelector('[data-testid="team-snapshot-export-save"]')).toBeNull();
    host.remove();
  });

  it("offers Save only once the team package is READY", async () => {
    const t = transport((request) => request.path === `/api/v1/export-packages/by-action/${executionId}`
      ? { status: 200, body: ready } : submitted("ALLOWED", "DISPATCHED")(request));
    const save = vi.fn(async () => true);
    const host = await render(<PlatformProvider client={createBffClient(t)} locale="zh-CN">
      <TeamSnapshotExportDialog target={target} host={{ save }} onClose={() => {}} />
    </PlatformProvider>);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="team-snapshot-export-confirm"]')!);
    await until(() => !!document.querySelector('[data-testid="team-snapshot-export-ready"]'), "READY team package");
    expect(document.querySelector('[data-testid="team-snapshot-export-ready"]')?.textContent).toContain("Release crew.team.png 已就绪");
    await click(document.querySelector<HTMLButtonElement>('[data-testid="team-snapshot-export-save"]')!);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ packageAssetId: packageId, fileName: "Release crew.team.png" }));
    host.remove();
  });

  it("opens the export from the original Share dialog entry", async () => {
    const team = { resourceId: target.resourceId, resourceVersion: 2, ownerPrincipalId: "o", name: "Release crew",
      memberAgentResourceIds: [], hiddenMemberCount: 0, catalogShared: false } as unknown as AgentTeamView;
    const onExport = vi.fn();
    await render(<PlatformProvider client={createBffClient(transport(() => ({ status: 404, body: {} })))} locale="en">
      <TeamShareDialog team={team} canShare isPending={false} unknown={false} problem={null}
        onCatalogShareChange={() => {}} onOpenChange={() => {}} open onExport={onExport} />
    </PlatformProvider>);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="team-share-export-open"]')!);
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
