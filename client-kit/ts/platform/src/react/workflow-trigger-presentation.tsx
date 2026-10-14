// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/workflows/ui/useWorkflowTriggerPresentation.ts,
// WorkflowRichTriggerDescription.tsx and WorkflowFormBuilder.tsx triggerEmoji.
// Author and message references resolve only through the existing scoped
// directory and the host message seam; unresolved references stay compact IDs.
import { LoaderCircle } from "lucide-react";
import { AutomationTriggerKind, type AutomationVersionContent } from "@client-kit/contracts";
import { useT } from "./context";
import { UserAvatar } from "./messages/UserAvatar";
import { resolveUserLabel } from "./messages/system/identity";
import { parseConditionExpressions } from "./workflow-condition-expression";
import { parseDirectAuthorInput } from "./workflow-author-candidates";
import { useWorkflowAuthorDirectory, useWorkflowAuthorProfiles } from "./workflow-author-directory";
import { splitWorkflowAuthorDescription, workflowTriggerDescription } from "./workflow-card-label";
import { normalizeMessageEventId } from "./workflow-message-candidates";
import { useWorkflowMessageScope } from "./workflow-message-host";
import { useWorkflowTriggerMessage } from "./workflow-message-picker";

export type WorkflowTriggerNodePresentation = {
  avatarUrl: string | null;
  description: string;
  iconEmoji?: string;
  isAgent: boolean;
  label: string | null;
  loading: boolean;
  resolveMediaUrl: (url: string) => string | undefined;
};

export function useWorkflowTriggerPresentation(content: AutomationVersionContent, workspaceId?: string): WorkflowTriggerNodePresentation {
  const t = useT();
  const trigger = content.trigger;
  const type = trigger.kind === AutomationTriggerKind.DiffPosted ? "diff_posted"
    : trigger.kind === AutomationTriggerKind.ReactionAdded ? "reaction_added" : "message_posted";
  const conditions = trigger.filter ? parseConditionExpressions(trigger.filter, type) ?? [] : [];
  const directory = useWorkflowAuthorDirectory(workspaceId);
  const authorKey = parseDirectAuthorInput(conditions.find(condition => condition.field === "trigger_author")?.value ?? "");
  const profiles = useWorkflowAuthorProfiles(workspaceId, authorKey ? [authorKey] : [], directory);
  const candidate = authorKey ? directory.rows.find(row => row.pubkey === authorKey) : undefined;
  const loading = !!authorKey && !candidate && directory.isLoading;
  const label = authorKey && !loading
    ? resolveUserLabel({pubkey: authorKey, fallbackName: candidate?.displayName, profiles: profiles.profiles, t}) : null;
  const scope = useWorkflowMessageScope(workspaceId);
  const messageCondition = conditions.find(condition => condition.field === "trigger_message_id");
  const message = useWorkflowTriggerMessage(messageCondition ? normalizeMessageEventId(messageCondition.value) : null, scope.scope);
  const iconEmoji = trigger.kind !== AutomationTriggerKind.ReactionAdded ? undefined
    : trigger.emoji?.trim() || conditions.find(condition => condition.field === "trigger_emoji"
      && condition.operator === "equals")?.value.trim() || undefined;
  return {
    avatarUrl: authorKey ? profiles.profiles[authorKey]?.avatarUrl ?? null : null,
    description: workflowTriggerDescription(content, t, {
      authorLabel: label ?? undefined, authorLoading: loading,
      messageLabel: message.messageLabel ?? undefined, messageLoading: message.messageLoading, iconEmoji,
    }),
    iconEmoji,
    isAgent: false,
    label,
    loading,
    resolveMediaUrl: profiles.resolveMediaUrl,
  };
}

export function WorkflowRichTriggerDescription({ avatarUrl, description, isAgent, label, loading, resolveMediaUrl }:
  WorkflowTriggerNodePresentation) {
  const t = useT();
  if (loading) {
    return <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate">{description}</span>
      <LoaderCircle aria-label={t("workflows.trigger.loadingAuthor")} className="h-3.5 w-3.5 shrink-0 animate-spin" role="status" />
    </span>;
  }
  const segments = label ? splitWorkflowAuthorDescription(description, label, t) : null;
  if (!label || !segments) return description;
  const { prefix, suffix } = segments;
  return <span className="flex min-w-0 items-center gap-1.5">
    {prefix ? <span className="shrink-0">{prefix}</span> : null}
    <UserAvatar avatarUrl={avatarUrl} resolveMediaUrl={resolveMediaUrl} className="h-4 w-4" displayName={label}
      fallbackDelayMs={0} shape={isAgent ? "squircle" : "circle"} size="xs" testId="workflow-trigger-author-avatar" />
    <span className="min-w-0 truncate">{label}{suffix ? ` ${suffix}` : ""}</span>
  </span>;
}
