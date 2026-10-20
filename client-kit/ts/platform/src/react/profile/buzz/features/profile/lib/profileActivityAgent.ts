// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/profile/lib/profileActivityAgent.ts.
// DD-125(6): the activity of a Kailo Agent is its Installation's Codex thread, readable only by
// Installation `audit` holders (the original "viewerIsOwner" gate). There is no local managed
// agent or Relay agent directory, so the activity agent is resolved from the admitted
// Installation alone; everyone else gets no activity agent and sees only the 20002 signal.
import type { AgentInstallationView } from "@client-kit/contracts";

import { isInstallationActive } from "../../../../../agent-activity/agentLifecycle";

export type ProfileActivityAgent = {
  pubkey: string;
  name: string;
  status: "running" | "stopped";
  avatarUrl?: string | null;
  installation: AgentInstallationView;
};

export function resolveProfileActivityAgent({
  effectivePubkey,
  fallbackName,
  installation,
  profile,
}: {
  effectivePubkey: string | null;
  fallbackName: string;
  installation: AgentInstallationView | undefined;
  profile: { avatarUrl?: string | null; displayName?: string | null } | null;
}): ProfileActivityAgent | null {
  if (!installation || installation.canAudit !== true || !effectivePubkey) {
    return null;
  }

  return {
    avatarUrl: profile?.avatarUrl ?? null,
    installation,
    name:
      profile?.displayName?.trim() ||
      installation.agentDisplayName?.trim() ||
      fallbackName,
    pubkey: effectivePubkey,
    status: isInstallationActive(installation) ? "running" : "stopped",
  };
}
