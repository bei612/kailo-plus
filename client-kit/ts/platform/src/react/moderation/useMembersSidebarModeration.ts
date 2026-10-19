// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/channels/ui/useMembersSidebarModeration.ts::useMembersSidebarModeration
// Community ban/timeout wiring for the member list. DD-125(2): gated by Tenant manage (the
// original relay owner/admin role), independent of the Workspace role; restrictions are read
// only while the list is open and the viewer can moderate. One person's state covers every
// bound key (DD-77); the action names one key and Core applies it to all of them.
import * as React from "react";
import type { ModerationTimeoutDuration, WorkspaceMemberView } from "@client-kit/contracts";
import { memberCommand, memberRestrictionState, type MemberRestrictionState } from "../../moderation";
import { useCanModerate, useModerationRestrictionsQuery, useModerationRunner } from "./hooks";

type Member = Pick<WorkspaceMemberView, "principalId" | "pubkeys">;

export function useMembersSidebarModeration(open: boolean) {
  const canModerate = useCanModerate(open);
  const restrictionsQuery = useModerationRestrictionsQuery(open && canModerate);
  const { run, isPending } = useModerationRunner();
  const items = restrictionsQuery.data?.items;

  const moderationStateOf = React.useCallback(
    (member: Member): MemberRestrictionState => memberRestrictionState(items, member.pubkeys),
    [items],
  );

  const act = React.useCallback((member: Member, action: "ban" | "unban" | "untimeout", success: Parameters<typeof run>[1]) => {
    const pubkey = member.pubkeys[0];
    if (!pubkey) return;
    void run({ intent: `${action}:${member.principalId}`, build: (key) => memberCommand(action, pubkey, key) }, success);
  }, [run]);

  const onBan = React.useCallback((member: Member) => act(member, "ban", "moderation.toast.memberBanned"), [act]);
  const onUnban = React.useCallback((member: Member) => act(member, "unban", "moderation.toast.banLifted"), [act]);
  const onUntimeout = React.useCallback((member: Member) => act(member, "untimeout", "moderation.toast.timeoutLifted"), [act]);
  const onTimeout = React.useCallback((member: Member, duration: ModerationTimeoutDuration) => {
    const pubkey = member.pubkeys[0];
    if (!pubkey) return;
    void run({
      intent: `timeout:${member.principalId}:${duration}`,
      build: (key) => memberCommand("timeout", pubkey, key, duration),
    }, "moderation.toast.memberTimedOut");
  }, [run]);

  return { canModerate, isModerationPending: isPending, moderationStateOf, onBan, onUnban, onTimeout, onUntimeout };
}
