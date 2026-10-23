// Text for one governed Agents-page submission outcome (team CRUD, share, import, catalog copy).
// Recorded is never a business terminal state: the page re-reads the directory afterwards.
import type { ChannelActionOutcome } from "../channel-management-actions";
import type { Translate } from "../context";

export function agentActionOutcomeText(t: Translate, outcome: ChannelActionOutcome): string {
  switch (outcome.kind) {
    case "recorded": return t("agentTeams.actionRecorded", { operation: outcome.operation });
    case "waiting": return t("agentTeams.actionWaiting", { operation: outcome.operation });
    case "unknown": return t("agents.unknown", { operation: outcome.operation ?? "—" });
    case "aborted": return t("workspace.lifecycle.aborted", { reason: outcome.reason, operation: outcome.operation });
    case "rejected": return t("agents.rejected", { reason: outcome.reason });
  }
}
