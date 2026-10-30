// DD-135、05 §2.14、17 §8：Agents 页内 Skills 区的共用行为（Web/Desktop 同一实现）。
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ActionCommand } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import {
  InstallationSkills,
  SkillsSection,
  packTar,
  parseRequirements,
  toBase64,
  validSkillSlug,
} from "../src/react/skills";
import type { BffReply, BffRequest, BffTransport } from "../src/transport";
import { button, click, render, settle, type } from "./render";

const definitionId = "6d7f8a1c-0f1e-4e1b-9a55-0c1f3a2b4d5e";
const ownerId = "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e";
const assetId = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const digest = "a".repeat(64);

const definition = {
  resourceId: definitionId, ownerPrincipalId: ownerId, stableSlug: "release-notes", displayName: "Release notes",
  status: "ACTIVE", resourceVersion: 2, catalogShared: false, canUpload: true, canDisable: true, canShare: true,
};
const draft = {
  assetId, skillResourceId: definitionId, stableSlug: "release-notes", ordinal: 1, assetVersion: 2, ownerPrincipalId: ownerId,
  skillName: "release-notes", description: "Write release notes.", artifactFormat: "kailo-skill@1", artifactDigest: digest,
  artifactByteSize: 60, metadataHash: "b".repeat(64), capabilityRequirements: [], state: "DRAFT", current: false, canPublish: true,
};
const submission = (command: ActionCommand) => ({
  status: 202,
  body: { actionKey: command.actionKey, actionExecutionId: "1f2e3d4c-5b6a-4978-8a6b-5c4d3e2f1a0b",
    operationId: "2f2e3d4c-5b6a-4978-8a6b-5c4d3e2f1a0b", gateState: "ALLOWED", dispatchState: "DISPATCHED" },
});

type Route = (request: BffRequest) => BffReply | Promise<BffReply>;
function transport(route: Route): BffTransport & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(async (request: BffRequest) => route(request)) };
}

async function mount(t: BffTransport, ui: React.ReactNode) {
  await render(<PlatformProvider client={createBffClient(t)} locale="en">{ui}</PlatformProvider>);
  await settle();
  return document.body;
}

/** DD-170: secondary Skill actions live in the detail's "More actions" menu. */
async function chooseMore(label: string, testId = "skill-more") {
  const trigger = document.querySelector<HTMLButtonElement>(`[data-testid=${testId}]`)
    ?? document.querySelector<HTMLButtonElement>(`button[aria-label="${testId}"]`);
  if (!trigger) throw new Error(`Missing menu ${testId}`);
  await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await settle();
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) => node.textContent === label);
  if (!item) throw new Error(`Missing menu item ${label}`);
  await click(item);
}

function actions(t: { send: ReturnType<typeof vi.fn> }): ActionCommand[] {
  return t.send.mock.calls.map(([request]) => request as BffRequest)
    .filter((request) => request.path === "/api/v1/actions").map((request) => request.body as ActionCommand);
}

describe("skill package helpers", () => {
  it("accepts only the Codex mention-safe slug subset", () => {
    expect(["a", "release-notes", "a1"].every(validSkillSlug)).toBe(true);
    expect(["", "-a", "a-", "A", "a_b", "a".repeat(65)].some(validSkillSlug)).toBe(false);
  });

  it("parses unique contract_key@version requirements", () => {
    expect(parseRequirements("knowledge.search@v1, data_query.run@v2")).toEqual(["knowledge.search@v1", "data_query.run@v2"]);
    expect(parseRequirements("")).toEqual([]);
    expect(parseRequirements("a@v1,a@v1")).toBeNull();
    expect(parseRequirements("a")).toBeNull();
  });

  it("packs a folder into a checksummed ustar with plain 0644 files", () => {
    const body = new TextEncoder().encode("---\nname: release-notes\ndescription: d\n---\n");
    const tar = packTar([{ path: "release-notes/SKILL.md", bytes: body }]);
    expect(tar.length).toBe(512 + 512 + 1024);
    const text = new TextDecoder().decode(tar.subarray(0, 512));
    expect(text.startsWith("release-notes/SKILL.md")).toBe(true);
    expect(text.slice(257, 262)).toBe("ustar");
    expect(text.slice(100, 107)).toBe("0000644");
    const header = new Uint8Array(tar.subarray(0, 512));
    const stored = Number.parseInt(new TextDecoder().decode(header.subarray(148, 154)), 8);
    header.fill(0x20, 148, 156);
    expect(header.reduce((total, byte) => total + byte, 0)).toBe(stored);
    expect(new TextDecoder().decode(tar.subarray(512, 512 + body.length))).toContain("name: release-notes");
    expect(() => packTar([{ path: `${"x".repeat(200)}`, bytes: body }])).toThrow(RangeError);
    expect(atob(toBase64(body))).toBe(new TextDecoder().decode(body));
  });
});

describe("Skills section in the Agents page", () => {
  it("creates a definition only through skill.definition.create with explicit confirmation", async () => {
    const t = transport((request) => {
      if (request.path === "/api/v1/skill-definitions") return { status: 200, body: { definitions: [] } };
      if (request.path === "/api/v1/actions") return submission(request.body as ActionCommand);
      return { status: 404, body: undefined };
    });
    const host = await mount(t, <SkillsSection />);
    expect(host.textContent).toContain("No skills you can discover yet.");
    await click(host.querySelector<HTMLButtonElement>("[data-testid=new-skill-card]")!);
    const inputs = [...document.querySelectorAll<HTMLInputElement>("[data-testid=skill-create-dialog] input")];
    await type(inputs[0]!, "Release notes");
    await type(inputs[1]!, "Release_Notes");
    expect(document.body.textContent).toContain("Use lowercase letters, digits and hyphens");
    await type(inputs[1]!, "release-notes");
    await click(button(document.body, "Review request"));
    expect(actions(t)).toEqual([]);
    await click(button(document.body, "Submit governed request"));
    const [command] = actions(t);
    expect(command).toMatchObject({ actionKey: "skill.definition.create", name: "Release notes", slug: "release-notes", explicitConfirmation: true });
    expect(typeof command?.idempotencyKey).toBe("string");
  });

  it("uploads a SKILL.md, shows the checked metadata and submits the frozen upload reference", async () => {
    const uploaded = {
      accepted: true, skillResourceId: definitionId, uploadDigest: "c".repeat(64), uploadByteSize: 60, encoding: "SKILL_MD",
      uploadId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", artifactDigest: digest, artifactByteSize: 60, skillName: "release-notes",
      description: "Write release notes.", expiresAt: "2026-10-22T00:30:00Z", violations: [],
    };
    const t = transport((request) => {
      if (request.path === "/api/v1/skill-definitions") return { status: 200, body: { definitions: [definition] } };
      if (request.path === `/api/v1/skill-definitions/${definitionId}`) return { status: 200, body: definition };
      if (request.path.startsWith(`/api/v1/skill-definitions/${definitionId}/versions`)) return { status: 200, body: { skillResourceId: definitionId, resourceVersion: 2, versions: [] } };
      if (request.path === `/api/v1/skill-definitions/${definitionId}/uploads`) return { status: 200, body: uploaded };
      if (request.path === "/api/v1/actions") return submission(request.body as ActionCommand);
      return { status: 404, body: undefined };
    });
    const host = await mount(t, <SkillsSection />);
    await click(host.querySelector<HTMLButtonElement>(`[data-testid=skill-definition-${definitionId}] button`)!);
    await click(button(document.body, "Upload version"));
    const input = document.querySelector<HTMLInputElement>("[data-testid=skill-upload-file]")!;
    const file = new File(["---\nname: release-notes\ndescription: Write release notes.\n---\n"], "SKILL.md", { type: "text/markdown" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(); await settle();
    const upload = t.send.mock.calls.map(([request]) => request as BffRequest).find((request) => request.path.endsWith("/uploads"));
    expect(upload?.method).toBe("POST");
    expect(atob((upload?.body as { contentBase64: string }).contentBase64)).toContain("name: release-notes");
    expect(document.querySelector("[data-testid=skill-upload-preview]")?.textContent).toContain("Write release notes.");
    await type(document.querySelector<HTMLInputElement>("[data-testid=skill-upload-preview] input")!, "knowledge.search@v1");
    await click(button(document.body, "Review request"));
    await click(button(document.body, "Submit governed request"));
    const created = actions(t).find((command) => command.actionKey === "skill.version.create");
    expect(created).toMatchObject({
      resourceId: definitionId, resourceVersion: 2, explicitConfirmation: true,
      skillVersionUpload: { uploadId: uploaded.uploadId, artifactDigest: digest, capabilityRequirements: ["knowledge.search@v1"] },
    });
  });

  it("lists every upload violation with its path and creates no version", async () => {
    const t = transport((request) => {
      if (request.path === "/api/v1/skill-definitions") return { status: 200, body: { definitions: [definition] } };
      if (request.path === `/api/v1/skill-definitions/${definitionId}`) return { status: 200, body: definition };
      if (request.path.startsWith(`/api/v1/skill-definitions/${definitionId}/versions`)) return { status: 200, body: { skillResourceId: definitionId, resourceVersion: 2, versions: [] } };
      if (request.path === `/api/v1/skill-definitions/${definitionId}/uploads`) return { status: 422, body: {
        accepted: false, skillResourceId: definitionId, uploadDigest: "c".repeat(64), uploadByteSize: 2048,
        violations: [{ code: "EXECUTABLE_ENTRY", path: "s/scripts/run.sh" }, { code: "EXTRA_ENTRY", path: "s/references/a.png" }],
      } };
      return { status: 404, body: undefined };
    });
    const host = await mount(t, <SkillsSection />);
    await click(host.querySelector<HTMLButtonElement>(`[data-testid=skill-definition-${definitionId}] button`)!);
    await click(button(document.body, "Upload version"));
    const input = document.querySelector<HTMLInputElement>("[data-testid=skill-upload-file]")!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File([new Uint8Array(2048)], "skill.tar")] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(); await settle();
    const violations = document.querySelector("[data-testid=skill-upload-violations]")?.textContent ?? "";
    expect(violations).toContain("Executable files are not allowed:");
    expect(violations).toContain("s/scripts/run.sh");
    expect(violations).toContain("s/references/a.png");
    expect(actions(t)).toEqual([]);
  });

  it("publishes a draft version with the exact asset version it read", async () => {
    const t = transport((request) => {
      if (request.path === "/api/v1/skill-definitions") return { status: 200, body: { definitions: [definition] } };
      if (request.path === `/api/v1/skill-definitions/${definitionId}`) return { status: 200, body: definition };
      if (request.path.startsWith(`/api/v1/skill-definitions/${definitionId}/versions`)) return { status: 200, body: { skillResourceId: definitionId, resourceVersion: 2, versions: [draft] } };
      if (request.path === "/api/v1/actions") return submission(request.body as ActionCommand);
      return { status: 404, body: undefined };
    });
    const host = await mount(t, <SkillsSection />);
    await click(host.querySelector<HTMLButtonElement>(`[data-testid=skill-definition-${definitionId}] button`)!);
    expect(document.querySelector("[data-testid=skill-version]")?.getAttribute("data-state")).toBe("DRAFT");
    await click(button(document.body, "Publish"));
    // 确认文案以成员看到的版本序号称呼版本，而不是并发控制用的 assetVersion（生产验收 D2）。
    const review = document.querySelector("[data-testid=skill-action-review]")?.textContent ?? "";
    expect(review).toContain("Publish version v1 of Release notes.");
    expect(review).not.toContain("version 2");
    await click(button(document.body, "Submit governed request"));
    expect(actions(t)).toEqual([expect.objectContaining({
      actionKey: "skill.version.publish", resourceId: definitionId, resourceVersion: 2, assetId, assetVersion: 2, explicitConfirmation: true,
    })]);
  });

  it("keeps the frozen intent and idempotency key when the result is unknown", async () => {
    let calls = 0;
    const t = transport((request) => {
      if (request.path === "/api/v1/skill-definitions") return { status: 200, body: { definitions: [definition] } };
      if (request.path === `/api/v1/skill-definitions/${definitionId}`) return { status: 200, body: definition };
      if (request.path.startsWith(`/api/v1/skill-definitions/${definitionId}/versions`)) return { status: 200, body: { skillResourceId: definitionId, resourceVersion: 2, versions: [] } };
      if (request.path === "/api/v1/actions") {
        calls += 1;
        return { status: 503, body: { class: "UNKNOWN", reason: "DISPATCH_RESULT_UNKNOWN", operationId: "op" } };
      }
      return { status: 404, body: undefined };
    });
    const host = await mount(t, <SkillsSection />);
    await click(host.querySelector<HTMLButtonElement>(`[data-testid=skill-definition-${definitionId}] button`)!);
    await chooseMore("Share to catalog");
    await click(button(document.body, "Submit governed request"));
    await click(button(document.body, "Re-check same request"));
    const sent = actions(t);
    expect(calls).toBe(2);
    expect(sent[0]?.idempotencyKey).toBe(sent[1]?.idempotencyKey);
    expect(sent[0]?.actionKey).toBe("skill.definition.share");
  });
});

describe("Skill destructive actions (DD-170 §16.6)", () => {
  const published = { ...draft, state: "PUBLISHED", current: true, canPublish: false, canRetire: true };
  it("retires a version only through the confirmation dialog and re-checks an UNKNOWN outcome with the same key", async () => {
    let calls = 0;
    const t = transport((request) => {
      if (request.path === "/api/v1/skill-definitions") return { status: 200, body: { definitions: [definition] } };
      if (request.path === `/api/v1/skill-definitions/${definitionId}`) return { status: 200, body: definition };
      if (request.path.startsWith(`/api/v1/skill-definitions/${definitionId}/versions`)) return { status: 200, body: { skillResourceId: definitionId, resourceVersion: 2, versions: [published] } };
      if (request.path === "/api/v1/actions") {
        calls += 1;
        return calls === 1 ? { status: 503, body: { class: "UNKNOWN", reason: "DISPATCH_RESULT_UNKNOWN", operationId: "op" } }
          : submission(request.body as ActionCommand);
      }
      return { status: 404, body: undefined };
    });
    const host = await mount(t, <SkillsSection />);
    await click(host.querySelector<HTMLButtonElement>(`[data-testid=skill-definition-${definitionId}] button`)!);
    // The owner reads as a name, never the Principal ID; the digest is only a technical identifier.
    const detail = document.querySelector<HTMLElement>("[data-testid=skill-detail]")!;
    expect(detail.textContent).not.toContain(ownerId);
    expect(detail.textContent).not.toContain(digest);
    expect(detail.textContent).toContain("Unknown member");
    await chooseMore("Retire", "Actions for v1");
    const dialog = document.querySelector<HTMLElement>("[data-testid=skill-danger-confirm]")!;
    expect(dialog.textContent).toContain("Retire v1 of “Release notes”?");
    expect(actions(t)).toEqual([]);
    await click(dialog.querySelector<HTMLButtonElement>("[data-testid=confirm-dialog-action]")!);
    expect(actions(t)).toHaveLength(1);
    expect(document.querySelector("[data-testid=skill-danger-confirm]")).not.toBeNull();
    expect(document.querySelector("[data-testid=skill-danger-confirm]")?.textContent).toContain("Outcome is not confirmed.");
    await click(document.querySelector<HTMLButtonElement>("[data-testid=skill-danger-confirm] [data-testid=confirm-dialog-action]")!);
    const sent = actions(t);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0]).toMatchObject({ actionKey: "skill.version.retire", resourceId: definitionId, assetId, explicitConfirmation: true });
    expect(document.querySelector("[data-testid=skill-danger-confirm]")).toBeNull();
  });
});

describe("Installation skill projection status", () => {
  it("shows requested skills with their projection and current state", async () => {
    const installation = "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d";
    const t = transport((request) => request.path === `/api/v1/agent-installations/${installation}/skills`
      ? { status: 200, body: { installationResourceId: installation, agentVersionAssetId: assetId, generation: 3, skills: [
        { skillVersionAssetId: assetId, skillResourceId: definitionId, stableSlug: "release-notes", ordinal: 1, artifactDigest: digest, projected: true, status: "EFFECTIVE" },
        { skillVersionAssetId: definitionId, skillResourceId: ownerId, stableSlug: "style-guide", ordinal: 4, artifactDigest: "d".repeat(64), projected: true, status: "NO_PERMISSION" },
      ] } }
      : { status: 404, body: undefined });
    const host = await mount(t, <InstallationSkills installationId={installation} locked={false} />);
    const rows = [...host.querySelectorAll("[data-testid=agent-installation-skill]")];
    expect(rows.map((row) => row.getAttribute("data-status"))).toEqual(["EFFECTIVE", "NO_PERMISSION"]);
    expect(rows[0]?.textContent).toContain("In use");
    expect(rows[1]?.textContent).toContain("No permission");
  });
});
