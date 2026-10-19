// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/moderation/hooks.ts:
// the original moderation reads and writes. DD-125(2): reads are Core's audited Tenant-manage
// views (Core reads the Relay /moderation/* as the Tenant CONTROL over NIP-98, nothing is
// copied); writes are moderation.* Governed Actions admitted and executed by Core. One
// idempotency key per intent is kept while the outcome is unknown (DD-81), so repeating the
// same action answers the original operation instead of acting twice.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import type { ActionCommand } from "@client-kit/contracts";
import { newIdempotencyKey } from "../../governance";
import type { PlatformMessageKey } from "../../i18n";
import { moderationOutcome, type ModerationOutcome } from "../../moderation";
import { BffError, isOutcomeUnknown } from "../../transport";
import { useBffClient, useReasonText, useT } from "../context";

export const moderationAccessQueryKey = ["platform", "moderation", "access"] as const;
export const moderationReportsQueryKey = ["platform", "moderation", "reports"] as const;
export const moderationAuditQueryKey = ["platform", "moderation", "audit"] as const;
export const moderationRestrictionsQueryKey = ["platform", "moderation", "restrictions"] as const;

/** Whether the original moderation affordances appear (Tenant manage); a hint, never a grant. */
export function useModerationAccessQuery(enabled = true) {
  const client = useBffClient();
  return useQuery({
    enabled,
    queryKey: moderationAccessQueryKey,
    queryFn: () => client.moderationAccess(),
    staleTime: 60_000,
    retry: false,
  });
}

export function useCanModerate(enabled = true): boolean {
  return useModerationAccessQuery(enabled).data?.canModerate === true;
}

/** The open moderation queue (original useModerationReportsQuery({status:"open"})). */
export function useModerationReportsQuery(enabled = true) {
  const client = useBffClient();
  return useQuery({
    enabled,
    queryKey: [...moderationReportsQueryKey, "open"],
    queryFn: () => client.moderationReports("open"),
    staleTime: 15_000,
    retry: false,
  });
}

export function useModerationAuditQuery(enabled = true) {
  const client = useBffClient();
  return useQuery({
    enabled,
    queryKey: moderationAuditQueryKey,
    queryFn: () => client.moderationAudit(),
    staleTime: 15_000,
    retry: false,
  });
}

export function useModerationRestrictionsQuery(enabled = true) {
  const client = useBffClient();
  return useQuery({
    enabled,
    queryKey: moderationRestrictionsQueryKey,
    queryFn: () => client.moderationRestrictions(),
    staleTime: 15_000,
    retry: false,
  });
}

/** Idempotency keys of intents whose outcome is still unknown, by intent identity. */
const unknownIntents = new Map<string, string>();

export type ModerationIntent = {
  /** Stable identity of one intent (action and target), e.g. `ban:<pubkey>`. */
  intent: string;
  build: (idempotencyKey: string) => ActionCommand;
};

/**
 * Submits one moderation action. A definite outcome forgets the key; an unknown one keeps
 * it so a repeat replays the same operation. Moderation writes surface in the reads only
 * after Core settles them, so the reads are invalidated rather than patched (original).
 */
export function useModerationAction() {
  const client = useBffClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ intent, build }: ModerationIntent): Promise<ModerationOutcome> => {
      const key = unknownIntents.get(intent) ?? newIdempotencyKey();
      unknownIntents.set(intent, key);
      try {
        const outcome = moderationOutcome(await client.submitAction(build(key)));
        if (outcome.kind !== "unknown") unknownIntents.delete(intent);
        return outcome;
      } catch (error) {
        if (!isOutcomeUnknown(error)) unknownIntents.delete(intent);
        throw error;
      }
    },
    onSettled: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: moderationReportsQueryKey }),
      queryClient.invalidateQueries({ queryKey: moderationAuditQueryKey }),
      queryClient.invalidateQueries({ queryKey: moderationRestrictionsQueryKey }),
    ]),
  });
}

/**
 * Original `run(action, success)`: one action with its success toast; a refusal shows the
 * reason with its stable code, an unknown outcome says so instead of success or failure.
 */
export function useModerationRunner() {
  const action = useModerationAction();
  const t = useT();
  const reasonText = useReasonText();
  const { mutateAsync } = action;
  const run = useCallback(async (intent: ModerationIntent, success: PlatformMessageKey): Promise<boolean> => {
    try {
      const outcome = await mutateAsync(intent);
      if (outcome.kind === "done") {
        toast.success(t(success));
        return true;
      }
      if (outcome.kind === "unknown") toast(t("moderation.toast.unknown", { operation: outcome.operationId }));
      else toast.error(outcome.reason ? reasonText(outcome.reason) : t("moderation.toast.failed"));
      return false;
    } catch (error) {
      if (isOutcomeUnknown(error)) {
        const operation = error instanceof BffError ? error.operationId ?? "" : "";
        toast(t("moderation.toast.unknown", { operation }));
      } else {
        toast.error(error instanceof BffError && error.reason ? reasonText(error.reason) : t("moderation.toast.failed"));
      }
      return false;
    }
  }, [mutateAsync, reasonText, t]);
  return { run, isPending: action.isPending };
}
