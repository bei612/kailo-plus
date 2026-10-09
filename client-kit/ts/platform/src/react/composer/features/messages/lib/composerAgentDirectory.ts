// Kailo host seam for Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/lib/useMentions.ts: Agent identity comes only
// from the admitted Installation directory, never kind-0 profile/is_agent.
import type {
  AgentInstallationView,
  WorkspaceMemberView,
} from "@client-kit/contracts";
import { AgentTrigger, ChannelType } from "@client-kit/contracts";
import type { BffClient } from "../../../../../client";
import { canonicalNpub, truncateNpub } from "../../../../conversations/pubkey";

export type ComposerAgent = {
  installation: AgentInstallationView;
  pubkey: string;
  displayName: string;
  avatarUrl: null;
};

export function admittedComposerInstallations(
  rows: readonly AgentInstallationView[],
  workspaceId: string,
  channelId: string,
): AgentInstallationView[] {
  const byId = new Map<string, AgentInstallationView>();
  const rejected = new Set<string>();
  for (const row of rows) {
    if (row.workspaceId !== workspaceId)
      throw new Error("Agent directory scope mismatch");
    const prior = byId.get(row.resourceId);
    if (prior && JSON.stringify(prior) !== JSON.stringify(row))
      rejected.add(row.resourceId);
    if (
      row.state !== "ACTIVE" ||
      row.resourceState !== "ACTIVE" ||
      row.agentPrincipalState !== "ACTIVE" ||
      row.executionPermission?.effective !== true ||
      row.channelBinding?.status !== "ACTIVE" ||
      row.channelBinding.channelId !== channelId ||
      !row.channelBinding.triggers.includes(AgentTrigger.Mention) ||
      row.projection?.state !== "ACTIVE" ||
      !Number.isSafeInteger(row.activeProjectionGeneration) ||
      row.projection.generation !== row.activeProjectionGeneration ||
      !row.agentPubkey ||
      !/^[0-9a-f]{64}$/.test(row.agentPubkey)
    )
      rejected.add(row.resourceId);
    byId.set(row.resourceId, row);
  }
  const active = [...byId.values()].filter(
    (row) => !rejected.has(row.resourceId),
  );
  const byPubkey = new Map<string, string>();
  for (const row of active) {
    const prior = byPubkey.get(row.agentPubkey!);
    if (prior && prior !== row.resourceId)
      throw new Error("Ambiguous Agent Installation identity");
    byPubkey.set(row.agentPubkey!, row.resourceId);
  }
  return active;
}

export async function loadComposerAgentDirectory(
  client: Pick<
    BffClient,
    | "session"
    | "workspaceChannel"
    | "agentInstallations"
    | "agentDefinition"
    | "profile"
    | "members"
  >,
  scope: {
    workspaceId: string;
    channelId?: string;
    principalId?: string;
    ownerPubkey?: string;
  },
  current: () => boolean,
): Promise<{
  principalId: string;
  ownerPubkey: string;
  channelId: string;
  agents: ComposerAgent[];
  members: WorkspaceMemberView[];
}> {
  const check = () => {
    if (!current()) throw new Error("Composer identity or scope changed");
  };
  check();
  const principalId = (await client.session()).tenantPrincipalId;
  check();
  if (scope.principalId && scope.principalId !== principalId)
    throw new Error("Composer principal changed");
  const channel = await client.workspaceChannel(scope.workspaceId);
  check();
  if (
    channel.archived ||
    (channel.channelType !== ChannelType.Stream &&
      channel.channelType !== ChannelType.Forum) ||
    (scope.channelId && channel.channelId !== scope.channelId)
  )
    throw new Error("Composer channel admission mismatch");
  const ownerPubkey = scope.ownerPubkey ?? (await client.profile()).pubkey;
  check();
  if (!/^[0-9a-f]{64}$/.test(ownerPubkey))
    throw new Error("Composer identity unavailable");
  const members = await client.members(scope.workspaceId);
  check();
  const rows: AgentInstallationView[] = [];
  let offset = 0;
  for (;;) {
    const page = await client.agentInstallations(scope.workspaceId, offset);
    check();
    if (!page || !Array.isArray(page.installations))
      throw new Error("Agent directory unavailable");
    rows.push(...page.installations);
    if (page.nextOffset == null) break;
    if (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset)
      throw new Error("Invalid Agent directory cursor");
    offset = page.nextOffset;
  }
  const installations = admittedComposerInstallations(
    rows,
    scope.workspaceId,
    channel.channelId,
  );
  const agents: ComposerAgent[] = [];
  for (const installation of installations) {
    let displayName = truncateNpub(canonicalNpub(installation.agentPubkey!)!);
    // Definition read is separately authorized; absence cannot fabricate a
    // display name, and does not turn the public key into a human profile.
    try {
      const definition = await client.agentDefinition(
        installation.agentResourceId,
      );
      check();
      if (
        definition.resourceId === installation.agentResourceId &&
        definition.resourceState === "ACTIVE" &&
        definition.displayName.trim()
      ) {
        displayName = definition.displayName;
      }
    } catch (error) {
      check();
      if (
        !(
          error &&
          typeof error === "object" &&
          "status" in error &&
          (error.status === 403 || error.status === 404)
        )
      )
        throw error;
    }
    agents.push({
      installation,
      pubkey: installation.agentPubkey!,
      displayName,
      avatarUrl: null,
    });
  }
  if ((await client.session()).tenantPrincipalId !== principalId)
    throw new Error("Composer principal changed during read");
  check();
  const finalChannel = await client.workspaceChannel(scope.workspaceId);
  check();
  if (
    finalChannel.archived ||
    finalChannel.channelId !== channel.channelId ||
    finalChannel.channelType !== channel.channelType
  )
    throw new Error("Composer channel changed during read");
  return {
    principalId,
    ownerPubkey,
    channelId: channel.channelId,
    agents,
    members: members.filter((member) => member.state === "ACTIVE"),
  };
}
