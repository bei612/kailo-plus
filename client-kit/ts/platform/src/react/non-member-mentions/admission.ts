// DD-125(8): whether "Invite" is offered. The BFF role projection (`GET role-members?workspaceId`)
// states per target whether the caller may run `workspace.member.add` (`canAddToWorkspace`); a
// 403 means no Workspace `manage`. A target whose membership is already PROVISIONING (an earlier
// accepted add still converging) is only awaited by the invite executor, never re-submitted, so a
// caller who may read that projection can still choose "Invite" for it. Any read failure fails
// closed to "Send anyway" only. Core still re-authorizes the add itself.
import { WorkspaceMembershipState } from "@client-kit/contracts";
import type { BffClient } from "../../client";
import { loadRoleMemberDirectory } from "../roles";

export async function resolveNonMemberInviteAdmission(
  client: BffClient,
  workspaceId: string,
  principalIds: readonly string[],
): Promise<boolean> {
  if (principalIds.length === 0) return false;
  try {
    const directory = await loadRoleMemberDirectory(client, workspaceId);
    const addable = (principalId: string) => directory.get(principalId)?.canAddToWorkspace === true;
    if (principalIds.every(addable)) return true;
    const roster = await client.members(workspaceId);
    const converging = new Set(
      roster
        .filter((member) => member.state === WorkspaceMembershipState.Provisioning)
        .map((member) => member.principalId),
    );
    return principalIds.every((principalId) => addable(principalId) || converging.has(principalId));
  } catch {
    return false;
  }
}
