// DD-131(2)、DD-143：Agent 快照导入预览与 agent.definition.import 提交（Web/Desktop 同一实现）。
import { describe, expect, it, vi } from "vitest";
import type { ActionCommand } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import {
  AgentSnapshotImportDialog,
  agentSnapshotSource,
  defaultImportSlug,
  sha256Hex,
  type AgentSnapshotSource,
} from "../src/react/agent-library/AgentSnapshotImportDialog";
import { SnapshotCard } from "../src/react/messages/SnapshotCard";
import type { BffReply, BffRequest, BffTransport } from "../src/transport";
import { act } from "react";
import { click, render, settle } from "./render";

const uploadId = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const routeId = "6d7f8a1c-0f1e-4e1b-9a55-0c1f3a2b4d5e";
const manifest = new TextEncoder().encode(JSON.stringify({ format: "buzz-agent-snapshot", version: 1,
  definition: { name: "Writer", systemPrompt: "Write release notes." }, profile: { displayName: "Writer" },
  memory: { level: "none" } }));

function preview(bytes: Uint8Array, digest: string, extra: Record<string, unknown> = {}) {
  return { uploadId, packageDigest: digest, packageByteSize: bytes.length, mediaType: "application/json",
    formatKey: "buzz-agent-snapshot@1", expiresAt: "2026-10-23T10:30:00Z", displayName: "Writer",
    instructions: "Write release notes.", omitted: ["RUNTIME", "RESPOND_TO_ALLOWLIST"], ...extra };
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

const configuration = {
  profiles: [{ key: "server-codex", kind: "SERVER_CODEX", status: "ACTIVE", webAvailability: "ENABLED",
    capabilityContract: { capabilityRequirements: [], maxIdleTimeoutSeconds: 60, maxParallelism: 1, maxTurnDurationSeconds: 600,
      replyPolicies: ["thread"], replyPolicyMappings: [{ key: "thread", threadReplies: true, broadcastReplies: false }] } }],
  routes: [{ resourceId: routeId, resourceVersion: 1, ownerPrincipalId: routeId, nativeConfigResourceId: routeId,
    nativeRevision: 1, nativeConfigHash: "c".repeat(64) }],
  nextOffset: null, canImport: true,
};

type Route = (request: BffRequest) => BffReply | Promise<BffReply>;
function transport(route: Route): BffTransport & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(async (request: BffRequest) => route(request)) };
}

function actions(t: { send: ReturnType<typeof vi.fn> }): ActionCommand[] {
  return t.send.mock.calls.map(([request]) => request as BffRequest)
    .filter((request) => request.path === "/api/v1/actions").map((request) => request.body as ActionCommand);
}

async function routes(digest: string, extra: Record<string, unknown> = {}, config: Record<string, unknown> = configuration) {
  return transport((request) => {
    if (request.path === "/api/v1/agent-snapshots/uploads") return { status: 200, body: preview(manifest, digest, extra) };
    if (request.path.startsWith("/api/v1/agent-snapshots/configuration")) return { status: 200, body: config };
    if (request.path === "/api/v1/actions") {
      const command = request.body as ActionCommand;
      return { status: 202, body: { actionKey: command.actionKey, actionExecutionId: "1f2e3d4c-5b6a-4978-8a6b-5c4d3e2f1a0b",
        operationId: "2f2e3d4c-5b6a-4978-8a6b-5c4d3e2f1a0b", gateState: "ALLOWED", dispatchState: "DISPATCHED" } };
    }
    return { status: 404, body: {} };
  });
}

describe("agent snapshot helpers", () => {
  it("classifies only original .agent.json/.agent.png packages within the original limits", () => {
    expect(agentSnapshotSource("writer.agent.json", manifest)).toMatchObject({ mediaType: "application/json" });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    expect(agentSnapshotSource("writer.agent.png", png)).toMatchObject({ mediaType: "image/png" });
    expect(agentSnapshotSource("writer.agent.png", manifest)).toBe("unsupported");
    expect(agentSnapshotSource("writer.persona.json", manifest)).toBe("unsupported");
    expect(agentSnapshotSource("writer.zip", manifest)).toBe("unsupported");
    expect(agentSnapshotSource("big.agent.json", new Uint8Array(5 * 1024 * 1024 + 1).fill(32))).toBe("tooLarge");
  });

  it("derives a valid slug that differs per import", () => {
    expect(defaultImportSlug("Release Writer!", "a1b2c3")).toBe("release-writer-a1b2c3");
    expect(defaultImportSlug("写作助理", "a1b2c3")).toBe("agent-a1b2c3");
  });
});

describe("agent snapshot import", () => {
  it("previews the staged package and submits only the frozen upload reference with explicit confirmation", async () => {
    const digest = await sha256Hex(manifest);
    const t = await routes(digest);
    const source = agentSnapshotSource("w.agent.json", manifest) as AgentSnapshotSource;
    const imported = vi.fn();
    await render(<PlatformProvider client={createBffClient(t)} locale="en">
      <AgentSnapshotImportDialog source={source} onClose={() => {}} onImported={imported} />
    </PlatformProvider>);
    await settle();
    const dialog = document.querySelector("[data-testid=agent-snapshot-import-preview]")!;
    expect(dialog.textContent).toContain("Write release notes.");
    expect(dialog.textContent).toContain("Respond-to allowlist");
    expect(document.querySelector<HTMLInputElement>("[data-testid=agent-snapshot-import-slug]")!.value).toMatch(/^writer-[0-9a-f]{6}$/);
    // Nothing is preselected: the importer opts in to a runtime and route.
    expect(document.querySelector<HTMLSelectElement>("select[id$=-profile]")!.value).toBe("");
    expect(document.querySelector<HTMLSelectElement>("select[id$=-route]")!.value).toBe("");
    await choose("select[id$=-profile]", "server-codex");
    await choose("select[id$=-route]", routeId);
    await click(document.querySelector<HTMLButtonElement>("[data-testid=agent-snapshot-import-review]")!);
    await click(document.querySelector<HTMLButtonElement>("[data-testid=agent-snapshot-import-submit]")!);
    const [command] = actions(t);
    expect(command).toMatchObject({ actionKey: "agent.definition.import", explicitConfirmation: true,
      agentDefinitionImport: { uploadId, packageDigest: digest, runtimeProfileKey: "server-codex", modelRouteResourceId: routeId } });
    expect(command).not.toHaveProperty("name");
    expect(imported).toHaveBeenCalledTimes(1);
  });

  it("imports without forcing a runtime choice, even when the directory is empty (DD-131(2) ruling)", async () => {
    const digest = await sha256Hex(manifest);
    const t = await routes(digest, {}, { profiles: [], routes: [], nextOffset: null, canImport: true });
    const source = agentSnapshotSource("w.agent.json", manifest) as AgentSnapshotSource;
    await render(<PlatformProvider client={createBffClient(t)} locale="en">
      <AgentSnapshotImportDialog source={source} onClose={() => {}} />
    </PlatformProvider>);
    await settle();
    expect(document.body.textContent).toContain("choose them in the version editor before publishing");
    await click(document.querySelector<HTMLButtonElement>("[data-testid=agent-snapshot-import-review]")!);
    await click(document.querySelector<HTMLButtonElement>("[data-testid=agent-snapshot-import-submit]")!);
    const [command] = actions(t);
    expect(command!.agentDefinitionImport).toEqual({ uploadId, packageDigest: digest });
  });

  it("accepts a package without instructions and says they must be added before publishing", async () => {
    const digest = await sha256Hex(manifest);
    const t = await routes(digest, { instructions: "" });
    const source = agentSnapshotSource("w.agent.json", manifest) as AgentSnapshotSource;
    await render(<PlatformProvider client={createBffClient(t)} locale="zh-CN">
      <AgentSnapshotImportDialog source={source} onClose={() => {}} />
    </PlatformProvider>);
    await settle();
    expect(document.querySelector("[data-testid=agent-snapshot-import-instructions]")).toBeNull();
    expect(document.querySelector("[data-testid=agent-snapshot-import-no-instructions]")!.textContent).toContain("补充指令后才能发布");
    expect(document.querySelector<HTMLButtonElement>("[data-testid=agent-snapshot-import-review]")!.disabled).toBe(false);
  });

  it("shows the inline avatar as imported by reference", async () => {
    const digest = await sha256Hex(manifest);
    const avatar = { avatarDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      avatarUrl: `https://buzz.example.test/media/${"a".repeat(64)}.png` };
    const t = await routes(digest, avatar);
    const source = agentSnapshotSource("w.agent.json", manifest) as AgentSnapshotSource;
    await render(<PlatformProvider client={createBffClient(t)} locale="en">
      <AgentSnapshotImportDialog source={source} onClose={() => {}} />
    </PlatformProvider>);
    await settle();
    expect(document.querySelector("[data-testid=agent-snapshot-import-avatar]")).not.toBeNull();
    expect(document.querySelector("[data-testid=agent-snapshot-import-avatar-imported]")).not.toBeNull();
  });

  it("rejects a preview whose inline avatar was not staged as a media object", async () => {
    const digest = await sha256Hex(manifest);
    const source = agentSnapshotSource("w.agent.json", manifest) as AgentSnapshotSource;
    const unstaged = await routes(digest, { avatarDataUrl: "data:image/png;base64,iVBORw0KGgo=" });
    await render(<PlatformProvider client={createBffClient(unstaged)} locale="en">
      <AgentSnapshotImportDialog source={source} onClose={() => {}} />
    </PlatformProvider>);
    await settle();
    expect(document.querySelector("[data-testid=agent-snapshot-import-preview]")).toBeNull();
    expect(document.querySelector("[data-testid=agent-snapshot-import-rejected]")).not.toBeNull();
  });

  it("verifies the attachment bytes against imeta before offering the import preview", async () => {
    const digest = await sha256Hex(manifest);
    const t = await routes(digest);
    const host = await render(<PlatformProvider client={createBffClient(t)} locale="en">
      <SnapshotCard displayName="Writer" href="/media/x" filename="writer.agent.json" size={manifest.length}
        sha256={"0".repeat(64)} snapshotKind="agent" onDownload={async () => {}} readBytes={async () => manifest} />
    </PlatformProvider>);
    await settle();
    await click(host.querySelector<HTMLButtonElement>("[data-testid=agent-snapshot-card-add]")!);
    expect(t.send).not.toHaveBeenCalled();
    expect(document.querySelector("[data-testid=agent-snapshot-import-preview]")).toBeNull();
  });

  it("offers Add for team cards too (DD-131(3)) but never without a platform session", async () => {
    const team = await render(<PlatformProvider client={createBffClient(await routes("a".repeat(64)))} locale="en">
      <SnapshotCard displayName="Crew" href="/media/t" filename="crew.team.json" sha256={"a".repeat(64)} snapshotKind="team"
        onDownload={async () => {}} readBytes={async () => manifest} />
    </PlatformProvider>);
    expect(team.querySelector("[data-testid=agent-snapshot-card-add]")).not.toBeNull();
    const bare = await render(<SnapshotCard displayName="Writer" href="/media/x" filename="writer.agent.json"
      sha256={"a".repeat(64)} snapshotKind="agent" onDownload={async () => {}} readBytes={async () => manifest} />);
    expect(bare.querySelector("[data-testid=agent-snapshot-card-add]")).toBeNull();
    expect(bare.querySelector("[data-testid=agent-snapshot-card-download]")).not.toBeNull();
  });
});
