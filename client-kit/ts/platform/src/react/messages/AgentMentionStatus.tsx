// DD-121, V-SCN-105/106: the admission outcome of an ordinary @mention, shown only under the
// sender's own message row. Read-only presentation: it never retries, never posts on the
// sender's behalf and never re-admits the denied mention. The host computes the entries for
// its own messages only, so other members' views stay unchanged.
import { AgentMentionOutcomeState, ReasonCode } from "@client-kit/contracts";
import { useUiT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";

/** A mentioned Agent without an outcome row yet is PENDING (not scanned yet), per DD-121 (1). */
export type AgentMentionPhase = "PENDING" | AgentMentionOutcomeState;

export type AgentMentionStatusEntry = {
  /** Stable per-Agent key (Installation ID, or the Agent pubkey before an outcome exists). */
  key: string;
  name: string;
  state: AgentMentionPhase;
  reasonCode?: ReasonCode;
  /**
   * The sender currently holds execute use of this Installation (it is in their admitted
   * channel Agent directory). Only outcomes recorded before DD-126 used PERMISSION_DENIED for a
   * missing delegation; for those this still tells the delegation apart from missing use.
   */
  delegable?: boolean;
};

export type AgentMentionDenial = "delegation" | "renewal" | "use" | "quota" | "unavailable";

/**
 * Refusals that only an administrator can lift: the Installation's capability/scope/binding or
 * the sender's tenant standing. Since DD-126 (6) Core records a missing delegation as
 * DELEGATION_REQUIRED and a consent change as DELEGATION_RENEWAL_REQUIRED; PERMISSION_DENIED
 * means missing use, except on outcomes recorded earlier (split by `delegable` below).
 */
const ADMIN_REASONS: ReadonlySet<ReasonCode> = new Set([
  ReasonCode.CapabilityBlocked,
  ReasonCode.ScopeGuardFailed,
  ReasonCode.BindingNotActive,
  ReasonCode.TenantMembershipNotActive,
  ReasonCode.TenantNotActive,
]);

/**
 * DD-121 (2) / DD-126 (6) presentation of a DENIED outcome:
 * - DELEGATION_REQUIRED (never granted, expired, revoked, replaced or uses used up) → offer
 *   renewal (opens that Installation's delegation management);
 * - DELEGATION_RENEWAL_REQUIRED (the Agent's action rules changed since the grant) → the same
 *   renewal entry, saying the delegation must be confirmed again;
 * - PERMISSION_DENIED while the sender holds execute use (outcomes recorded before DD-126) →
 *   treated as a missing delegation;
 * - PERMISSION_DENIED without execute use, or an ADMIN_REASONS code → an admin must grant use;
 * - QUOTA_EXHAUSTED → the organization's Agent quota is used up; only an admin can raise it
 *   (DD-123 (5): members see no limit or usage figures);
 * - anything else (rate, dependency, conflict, unknown or absent code) → temporarily
 *   unavailable; a new @mention later is admitted normally (the denied one never is).
 *   DEPENDENCY_UNAVAILABLE (OpenMeter unreadable) stays here: it says nothing about the quota.
 */
export function agentMentionDenial(reasonCode: ReasonCode | undefined, delegable: boolean): AgentMentionDenial {
  if (reasonCode === ReasonCode.DelegationRequired) return "delegation";
  if (reasonCode === ReasonCode.DelegationRenewalRequired) return "renewal";
  if (reasonCode === ReasonCode.PermissionDenied) return delegable ? "delegation" : "use";
  if (reasonCode !== undefined && ADMIN_REASONS.has(reasonCode)) return "use";
  if (reasonCode === ReasonCode.QuotaExhausted) return "quota";
  return "unavailable";
}

/** REPLIED shows nothing: the Agent's reply itself is visible in the timeline. */
export function agentMentionVisible(entry: AgentMentionStatusEntry): boolean {
  return entry.state !== AgentMentionOutcomeState.Replied;
}

export function AgentMentionStatus({ entries, onRenewDelegation, className }: {
  entries: readonly AgentMentionStatusEntry[];
  /** Host navigation to the Installation's delegation management; omitted → no action shown. */
  onRenewDelegation?: (key: string) => void;
  className?: string;
}) {
  const t = useUiT();
  const visible = entries.filter(agentMentionVisible);
  if (visible.length === 0) return null;
  return (
    <div className={cn("mt-1 flex flex-col gap-0.5 text-xs", className)} data-testid="agent-mention-status">
      {visible.map((entry) => {
        if (entry.state === "PENDING" || entry.state === AgentMentionOutcomeState.Running) {
          return <p key={entry.key} role="status" className="text-muted-foreground" data-state="running">
            {t("agentMention.running", { name: entry.name })}
          </p>;
        }
        if (entry.state === AgentMentionOutcomeState.Failed) {
          return <p key={entry.key} className="text-destructive" data-state="failed">
            {t("agentMention.failed", { name: entry.name })}
          </p>;
        }
        const denial = agentMentionDenial(entry.reasonCode, entry.delegable === true);
        if (denial === "delegation" || denial === "renewal") {
          return <p key={entry.key} className="flex flex-wrap items-baseline gap-x-2 text-destructive" data-state="denied" data-denial={denial}>
            <span>{t(denial === "renewal" ? "agentMention.delegationRenewalRequired" : "agentMention.delegationRequired",
              { name: entry.name })}</span>
            {onRenewDelegation ? <button type="button" className="font-medium text-primary underline-offset-2 hover:underline focus-visible:underline"
              onClick={() => onRenewDelegation(entry.key)}>{t("agentMention.renewDelegation")}</button> : null}
          </p>;
        }
        return <p key={entry.key} className="text-destructive" data-state="denied" data-denial={denial}>
          {t(denial === "use" ? "agentMention.useRequired" : denial === "quota" ? "agentMention.quotaExhausted"
            : "agentMention.unavailable", { name: entry.name })}
        </p>;
      })}
    </div>
  );
}
