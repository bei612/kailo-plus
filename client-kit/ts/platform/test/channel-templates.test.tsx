import { describe, expect, it, vi } from "vitest";
import { ActionDispatchState, ActionGateState, AgentVersionState, CreateActionKey, ErrorClass, ReasonCode, ResourceState, TaskStatus,
  type ActionCommand, type ActionSubmission } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { CollaborationPreferencesProvider, type CollaborationPreferenceActions } from "../src/react/collaboration-preferences";
import { applyChannelTemplate, renderCanvasTemplate, waitForCreatedWorkspace, type TemplateApplyClient } from "../src/react/channel-templates/applyChannelTemplate";
import { ChannelTemplatesSettingsCard } from "../src/react/channel-templates/ChannelTemplatesSettingsCard";
import { ProfilePrimaryActions } from "../src/react/pulse/UserProfilePrimaryActions";
import { useProfileFollow } from "../src/react/pulse/useProfileFollow";
import { OVERRIDES_KEY } from "../src/react/features/store";
import { BffError } from "../src/transport";
import { click, render, settle } from "./render";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const agentA = "22222222-2222-4222-8222-222222222222";
const agentB = "33333333-3333-4333-8333-333333333333";
const receipt = (command: ActionCommand): ActionSubmission => ({ operationId: "44444444-4444-4444-8444-444444444444",
  actionExecutionId: "55555555-5555-4555-8555-555555555555", actionKey: command.actionKey,
  gateState: ActionGateState.Allowed, dispatchState: ActionDispatchState.Dispatched });

describe("original channel template apply over governed submissions", () => {
  it("replaces the original canvas placeholders", () => {
    expect(renderCanvasTemplate({ name: "Incident", canvasTemplate: "{channel.name} uses {template.name}; {channel.name}" }, "ops"))
      .toBe("ops uses Incident; ops");
    expect(renderCanvasTemplate({ name: "Incident" }, "ops")).toBeNull();
  });

  it("submits each Agent separately with its own key and reports a refused one without rolling back", async () => {
    const commands: ActionCommand[] = [];
    const client = {
      agentDefinition: async (id: string) => ({ resourceId: id, displayName: id === agentA ? "Scribe" : "Critic",
        stableSlug: id, status: ResourceState.Active, resourceState: ResourceState.Active, resourceVersion: 1,
        ownerPrincipalId: workspaceId, currentPublishedVersionAssetId: `${id}-v` }),
      agentVersion: async (assetId: string) => ({ assetId, state: AgentVersionState.Published }),
      agentInstallationCandidates: async () => ({ workspaceId, canCreate: true, candidates: [agentA, agentB].map((id) => ({
        agentResourceId: id, resourceVersion: 1, displayName: id, agentVersionAssetId: `${id}-v`, assetVersion: 2, ordinal: 1 })) }),
      submitAction: async (command: ActionCommand) => {
        commands.push(command);
        if (command.resourceId === agentB) throw new BffError(403, "denied", { class: ErrorClass.Denied, reason: ReasonCode.PermissionDenied });
        return receipt(command);
      },
      task: async () => { throw new Error("unused"); },
    } as unknown as TemplateApplyClient;
    const results = await applyChannelTemplate(client, { name: "Incident", canvasTemplate: "# {channel.name}", agentResourceIds: [agentA, agentB, agentA] },
      workspaceId, "ops", new Map(), () => true);
    // Canvas is reported (its governed write has no body field in this contract) and nothing is sent for it.
    expect(results.map((result) => [result.item.kind, result.outcome])).toEqual([["canvas", "unavailable"], ["agent", "submitted"], ["agent", "failed"]]);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatchObject({ actionKey: "agent.installation.create", workspaceId, resourceId: agentA, assetId: `${agentA}-v`, assetVersion: 2 });
    expect(commands[0]!.idempotencyKey).not.toBe(commands[1]!.idempotencyKey);
    const refused = results[2]!;
    expect(refused.outcome === "failed" && refused.failure.kind === "rejected" && refused.failure.reason).toBe(ReasonCode.PermissionDenied);
    expect(refused.item.kind === "agent" && refused.item.name).toBe("Critic");
  });

  it("waits for the workspace.create task to complete before applying", async () => {
    const submission = receipt({ actionKey: CreateActionKey.WorkspaceCreate, idempotencyKey: "x" });
    const base = { operationId: submission.operationId, actionExecutionId: submission.actionExecutionId, actionKey: CreateActionKey.WorkspaceCreate,
      actionVersion: 1, targetId: workspaceId, gateState: ActionGateState.Allowed, dispatchState: ActionDispatchState.Dispatched,
      workflowId: "wf", createdAt: "2026-10-18T00:00:00Z" };
    const task = vi.fn()
      .mockResolvedValueOnce({ ...base, taskStatus: TaskStatus.Running })
      .mockResolvedValueOnce({ ...base, taskStatus: TaskStatus.Completed });
    const sleep = vi.fn(async () => undefined);
    await expect(waitForCreatedWorkspace({ task }, submission, { isCurrent: () => true, sleep })).resolves.toBe(workspaceId);
    expect(sleep).toHaveBeenCalledTimes(1);
    const denied = vi.fn().mockResolvedValue({ ...base, gateState: ActionGateState.Denied });
    await expect(waitForCreatedWorkspace({ task: denied }, submission, { isCurrent: () => true, sleep })).rejects.toThrow("rejected");
  });
});

function preferences(overrides: Partial<CollaborationPreferenceActions>): CollaborationPreferenceActions {
  return {
    state: { version: 1, workspacePreferences: {}, readContexts: {} }, writable: true,
    isFollowingThread: () => false, isThreadMuted: () => false, isNotifiedForThread: () => false,
    followThread: async () => true, unfollowThread: async () => true,
    sections: [], assignments: {}, createSection: async () => null, renameSection: async () => true,
    deleteSection: async () => true, moveSection: async () => true, reorderSections: async () => true,
    assignChannel: async () => true, sortModeFor: () => "alpha", setSortModeFor: async () => true,
    templates: [], saveTemplate: async () => null, deleteTemplate: async () => true,
    isFollowing: () => false, setFollowing: async () => true,
    ...overrides,
  };
}

const client = createBffClient({ send: async () => ({ status: 200, body: { definitions: [] } }) });

describe("Channel templates settings card", () => {
  it("lists the caller's Core templates with the original row summary", async () => {
    const value = preferences({ templates: [{ id: workspaceId, name: "Incident", description: "Triage",
      channelType: "stream", visibility: "private", canvasTemplate: "# x", agentResourceIds: [agentA], updatedAt: "2026-10-18T00:00:00Z" }] });
    const ui = await render(<PlatformProvider client={client} locale="en"><CollaborationPreferencesProvider value={value}>
      <ChannelTemplatesSettingsCard />
    </CollaborationPreferencesProvider></PlatformProvider>);
    const row = ui.querySelector(`[data-testid="channel-template-${workspaceId}"]`)!;
    expect(row.textContent).toContain("Incident");
    expect(row.textContent).toContain("1 agent");
    expect(row.textContent).toContain("canvas");
  });

  it("explains that templates are unavailable without the Core preference host", async () => {
    const ui = await render(<PlatformProvider client={client} locale="en"><ChannelTemplatesSettingsCard /></PlatformProvider>);
    expect(ui.querySelector('[role="status"]')?.textContent).toBe("Channel templates aren't available here.");
  });
});

function FollowHarness({ pubkey }: { pubkey: string }) {
  const follow = useProfileFollow(pubkey, true);
  return <ProfilePrimaryActions follow={follow} />;
}

describe("Pulse follow tile", () => {
  it("follows by key through Core preferences only when the original pulse gate is on", async () => {
    localStorage.clear();
    const setFollowing = vi.fn(async () => true);
    const value = preferences({ setFollowing });
    const pubkey = "a".repeat(64);
    const hidden = await render(<PlatformProvider client={client} locale="en"><CollaborationPreferencesProvider value={value}>
      <FollowHarness pubkey={pubkey} /></CollaborationPreferencesProvider></PlatformProvider>);
    expect(hidden.querySelector('[data-testid="user-profile-follow"]')).toBeNull();

    localStorage.setItem(OVERRIDES_KEY, JSON.stringify({ pulse: true }));
    const ui = await render(<PlatformProvider client={client} locale="en"><CollaborationPreferencesProvider value={value}>
      <FollowHarness pubkey={pubkey} /></CollaborationPreferencesProvider></PlatformProvider>);
    const tile = ui.querySelector<HTMLButtonElement>('[data-testid="user-profile-follow"]')!;
    expect(tile.textContent).toBe("Follow");
    await click(tile);
    await settle();
    expect(setFollowing).toHaveBeenCalledWith(pubkey, true);
    localStorage.clear();
  });
});
