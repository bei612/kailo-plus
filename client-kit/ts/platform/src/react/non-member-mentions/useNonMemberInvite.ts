// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/ui/useNonMemberInvite.ts: own the whole Invite attempt (synchronous
// double-click guard, cancellation on a superseding prompt or destination, pending state), with
// Kailo's governed membership add as the attempt body.
import * as React from "react";
import type { PlatformLocale } from "../../i18n";
import { useUiLocale, useUiT, type Translate } from "../context";
import type { NonMemberInviteFailure, NonMemberInviteResult } from "./nonMemberMentions";

/** Original names list ("Ada, Grace"); Chinese uses the enumeration comma. */
export function nonMemberNameSeparator(locale: PlatformLocale): string {
  return locale === "en" ? ", " : "、";
}

/** Localized prompt error for an invitation that did not converge. */
export function nonMemberInviteFailureText(t: Translate, failure: NonMemberInviteFailure, separator = ", "): string {
  const names = failure.principals.map((principal) => principal.displayName).join(separator);
  if (!names) return t("buzz.nonMemberMention.inviteFailed");
  switch (failure.status) {
    case "rejected": return t("buzz.nonMemberMention.inviteRejected", { names });
    case "error": return t("buzz.nonMemberMention.inviteError", { names });
    case "timeout": return t("buzz.nonMemberMention.inviteTimeout", { names });
  }
}

export function useNonMemberInvite<TDraft extends object>({
  draft,
  canInvite,
  run,
  onActive,
  setError,
}: {
  /** The pending prompt; a different non-null draft supersedes a running attempt. */
  draft: TDraft | null;
  canInvite: boolean;
  run: (draft: TDraft, signal: AbortSignal) => Promise<NonMemberInviteResult>;
  /** Publish the held draft with every mentioned person notified. */
  onActive: (draft: TDraft, signal: AbortSignal) => void | Promise<void>;
  setError: (error: string | null) => void;
}) {
  const t = useUiT();
  const separator = nonMemberNameSeparator(useUiLocale());
  const active = React.useRef<{ controller: AbortController; draft: TDraft } | null>(null);
  const [isPending, setIsPending] = React.useState(false);
  const cancel = React.useCallback(() => {
    active.current?.controller.abort();
    active.current = null;
    setIsPending(false);
  }, []);
  React.useLayoutEffect(() => {
    const attempt = active.current;
    // Clearing the prompt on success is promotion, not cancellation.
    if (attempt && draft !== null && draft !== attempt.draft) cancel();
  }, [draft, cancel]);
  React.useLayoutEffect(() => () => {
    active.current?.controller.abort();
    active.current = null;
  }, []);

  const invite = React.useCallback(() => {
    if (!draft || active.current) return;
    if (!canInvite) {
      setError(t("buzz.nonMemberMention.addDenied"));
      return;
    }
    const controller = new AbortController();
    active.current = { controller, draft }; // synchronous double-click guard
    setIsPending(true);
    setError(null);
    const isCurrent = () => active.current?.controller === controller && !controller.signal.aborted;
    void (async () => {
      const result = await run(draft, controller.signal);
      if (!isCurrent() || result.status === "cancelled") return;
      if (result.status !== "active") {
        setError(nonMemberInviteFailureText(t, result, separator));
        return;
      }
      await onActive(draft, controller.signal);
    })()
      .catch(() => {
        if (isCurrent()) setError(t("buzz.nonMemberMention.inviteFailed"));
      })
      .finally(() => {
        if (active.current?.controller === controller) {
          active.current = null;
          setIsPending(false);
        }
      });
  }, [draft, canInvite, run, onActive, setError, t, separator]);

  return { invite, cancel, isPending };
}
