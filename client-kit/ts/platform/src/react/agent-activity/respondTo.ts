// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/shared/api/types.ts::RespondToMode mapped
// onto Installation use authorization (DD-125(6), 05 §2.10):
//   owner-only ≙ default (owner, Workspace manage and Tenant manage already hold use)
//   allowlist  ≙ one agent.installation.use.grant per selected member
//   anyone     — not offered: channel membership never implies a Resource permission (10 §3).
// Saving submits one governed grant/revoke per changed member, sequentially: every write bumps the
// Installation Resource version and holds its projection until settled, so each step re-reads the
// use page for the current version. An UNKNOWN step keeps its exact command and key for Retry.
import * as React from "react";
import { AgentRespondToMode, type ActionCommand, type AgentInstallationUsePage } from "@client-kit/contracts";
import type { BffClient } from "../../client";
import { newIdempotencyKey } from "../../governance";
import type { WriteFailure } from "../../transport";
import { submitGoverned } from "./agentLifecycle";

export type RespondToChange = { principalId: string; displayName: string; grant: boolean };

export function respondToModeOf(page: Pick<AgentInstallationUsePage, "respondTo" | "members">): AgentRespondToMode {
  if (page.respondTo === AgentRespondToMode.Allowlist || page.respondTo === AgentRespondToMode.OwnerOnly) return page.respondTo;
  return page.members.some((member) => member.requested) ? AgentRespondToMode.Allowlist : AgentRespondToMode.OwnerOnly;
}

/** The explicit grants currently held (the original respondToAllowlist). */
export function respondToAllowlistOf(page: Pick<AgentInstallationUsePage, "members">): string[] {
  return page.members.filter((member) => member.requested).map((member) => member.principalId);
}

/**
 * Diff of the chosen mode/allowlist against the page. Owner only revokes every explicit grant.
 * Members the viewer cannot change are left as they are (Core would refuse them anyway).
 */
export function respondToChanges(page: Pick<AgentInstallationUsePage, "members">, mode: AgentRespondToMode,
  allowlist: readonly string[]): RespondToChange[] {
  const target = new Set(mode === AgentRespondToMode.Allowlist ? allowlist : []);
  const changes: RespondToChange[] = [];
  for (const member of page.members) {
    if (member.requested && !target.has(member.principalId) && member.canRevoke) {
      changes.push({ principalId: member.principalId, displayName: member.displayName, grant: false });
    } else if (!member.requested && target.has(member.principalId) && member.canGrant) {
      changes.push({ principalId: member.principalId, displayName: member.displayName, grant: true });
    }
  }
  return changes;
}

export function respondToCommand(page: Pick<AgentInstallationUsePage, "installationId" | "resourceVersion">,
  change: Pick<RespondToChange, "principalId" | "grant">, idempotencyKey = newIdempotencyKey()): ActionCommand {
  return {
    actionKey: change.grant ? "agent.installation.use.grant" : "agent.installation.use.revoke",
    idempotencyKey,
    resourceId: page.installationId,
    resourceVersion: page.resourceVersion,
    principalId: change.principalId,
    explicitConfirmation: true,
  };
}

type Step = { change: RespondToChange; command: ActionCommand };

export type RespondToSave = {
  saving: boolean;
  /** The step whose outcome is unknown, and what remains after it. */
  unknown: { step: Step; operationId?: string } | null;
  failure: (WriteFailure & { kind: "rejected" }) | "pending" | null;
  save: (changes: readonly RespondToChange[]) => Promise<boolean>;
  retry: () => Promise<boolean>;
};

export function useRespondToSave(client: BffClient, installationId: string, onRecorded?: () => void): RespondToSave {
  const [saving, setSaving] = React.useState(false);
  const [unknown, setUnknown] = React.useState<RespondToSave["unknown"]>(null);
  const [remaining, setRemaining] = React.useState<RespondToChange[]>([]);
  const [failure, setFailure] = React.useState<RespondToSave["failure"]>(null);
  const inFlight = React.useRef(false);
  const recorded = React.useRef(onRecorded);
  recorded.current = onRecorded;

  const drive = React.useCallback(async (first: Step | null, rest: readonly RespondToChange[]): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setSaving(true);
    setFailure(null);
    setUnknown(null);
    let done = true;
    try {
      const queue = [...rest];
      let step = first;
      for (;;) {
        if (!step) {
          const change = queue.shift();
          if (!change) break;
          const page = await client.agentInstallationUsers(installationId);
          if (!page || page.installationId !== installationId || !Number.isSafeInteger(page.resourceVersion)) {
            setFailure({ kind: "rejected", detail: "" });
            setRemaining([change, ...queue]);
            done = false;
            break;
          }
          if (page.pendingActionExecutionId !== undefined) {
            setFailure("pending");
            setRemaining([change, ...queue]);
            done = false;
            break;
          }
          step = { change, command: respondToCommand(page, change) };
        }
        const outcome = await submitGoverned(client, step.command);
        if (outcome.kind === "unknown") {
          setUnknown({ step, operationId: outcome.failure.operationId });
          setRemaining(queue);
          done = false;
          break;
        }
        if (outcome.kind === "refused") {
          setFailure(outcome.failure);
          setRemaining(queue);
          done = false;
          break;
        }
        step = null;
      }
      if (done) setRemaining([]);
    } catch {
      setFailure({ kind: "rejected", detail: "" });
      done = false;
    } finally {
      inFlight.current = false;
      setSaving(false);
      recorded.current?.();
    }
    return done;
  }, [client, installationId]);

  const save = React.useCallback((changes: readonly RespondToChange[]) => drive(null, changes), [drive]);
  const retry = React.useCallback(() => unknown ? drive(unknown.step, remaining) : drive(null, remaining), [drive, unknown, remaining]);
  return { saving, unknown, failure, save, retry };
}
