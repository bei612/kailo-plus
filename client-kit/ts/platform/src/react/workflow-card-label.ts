// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/workflows/ui/workflowDefinition.ts::getWorkflowCardLabel,
// getTriggerCardClause/getActionCardClause and workflowStepDescription.ts::compact.
// Original admitted trigger/action branches; wire data remains AutomationVersionContent.
import { ActionEnum, type AutomationStep, type AutomationVersionContent } from "@client-kit/contracts";
import type { Translate } from "./context";
import { parseConditionExpressions } from "./workflow-condition-expression";
import { formatDurationSeconds, formatDurationSecondsVerbose, parseDurationSeconds } from "./workflow-duration";
import { scheduleFormFromTrigger } from "./workflow-schedule";
import { truncateNpub } from "./conversations/pubkey";

export type WorkflowTriggerPresentation = {
  authorLabel?: string;
  authorLoading?: boolean;
  omitUnresolvedReferences?: boolean;
};

// workflowTriggerDescription's admitted message_posted branch. Preserve its
// author/text combination and attribution position, including exclusion. Other
// upstream event kinds are not admitted by AutomationVersionContent.
function messageTriggerDescription(content: AutomationVersionContent, t: Translate,
  card: boolean, options: WorkflowTriggerPresentation): string {
  const conditions = content.trigger.filter
    ? parseConditionExpressions(content.trigger.filter, "message_posted") : [];
  const text = conditions?.find(condition => condition.field === "trigger_text");
  const author = conditions?.find(condition => condition.field === "trigger_author");
  const showAuthor = author && (!options.omitUnresolvedReferences || options.authorLabel || options.authorLoading);
  const authorLabel = showAuthor ? options.authorLoading ? t("workflows.trigger.loadingAuthor")
    : options.authorLabel ?? truncateNpub(author.value) : undefined;
  const attribution = authorLabel ? t(author?.operator === "not_equals"
    ? "workflows.trigger.exceptAuthor" : "workflows.trigger.byAuthor", {author: authorLabel}) : "";
  const values = {value: text ? `“${compact(text.value, 36)}”` : "", author: attribution};
  if (!text) return t(card ? "workflows.card.message" : "workflows.trigger.message", values);
  const keys = card ? {
    contains: "workflows.card.contains", not_contains: "workflows.card.notContains",
    starts_with: "workflows.card.startsWith", ends_with: "workflows.card.endsWith",
    equals: "workflows.card.equals", not_equals: "workflows.card.notEquals",
    is_not_empty: "workflows.card.withText", is_empty: "workflows.card.withoutText",
  } as const : {
    contains: "workflows.trigger.contains", not_contains: "workflows.trigger.notContains",
    starts_with: "workflows.trigger.startsWith", ends_with: "workflows.trigger.endsWith",
    equals: "workflows.trigger.equals", not_equals: "workflows.trigger.notEquals",
    is_not_empty: "workflows.trigger.withText", is_empty: "workflows.trigger.withoutText",
  } as const;
  return t(keys[text.operator], values);
}

/** Original getWorkflowTriggerSummary uses omission, unlike the card's author presentation. */
export function workflowTriggerSummary(content: AutomationVersionContent, t: Translate): string {
  if (content.trigger.kind === "SCHEDULE") return t("workflows.trigger.schedule");
  if (content.trigger.kind === "MENTION") return t("workflows.trigger.mention");
  if (content.trigger.textPrefix) return t("workflows.trigger.matchingMessage");
  return messageTriggerDescription(content, t, false, {omitUnresolvedReferences: true});
}

function compact(value: string, max = 42): string {
  const normalized = value.trim().replaceAll(/\s+/g, " ");
  return normalized.length > max ? `${normalized.slice(0, max - 3)}...` : normalized;
}
function quoted(value?: string): string | null {
  const text = value ? compact(value) : "";
  return text ? `“${text}”` : null;
}

export function workflowTriggerCardClause(content: AutomationVersionContent, t: Translate,
  options: WorkflowTriggerPresentation = {}): string {
  const trigger = content.trigger;
  if (trigger.kind === "SCHEDULE") {
    const spec = trigger.scheduleSpec;
    const schedule = scheduleFormFromTrigger({on: "schedule", cron: spec?.cron,
      interval: spec?.everySeconds === undefined ? undefined : formatDurationSeconds(spec.everySeconds)});
    switch (schedule.frequency) {
      case "daily": return t("workflows.card.daily", {time: schedule.time});
      case "weekly": return t("workflows.card.weekly", {time: schedule.time});
      case "monthly": return t("workflows.card.monthly", {time: schedule.time});
      case "custom_interval": return schedule.customInterval
        ? t("workflows.card.interval", {duration: schedule.customInterval}) : t("workflows.card.schedule");
      case "custom_cron": return t("workflows.card.customSchedule");
      case "every_15_minutes": return t("workflows.card.every15Minutes");
      case "every_30_minutes": return t("workflows.card.every30Minutes");
      case "hourly": return t("workflows.card.hourly");
    }
  }
  // A Kailo MENTION also requires its existing trusted principal predicate;
  // do not describe that authorized extra constraint as an unrestricted message.
  if (trigger.kind === "MENTION") return t("workflows.card.mention");
  // Legacy textPrefix is an additional Kailo constraint, not a Buzz filter.
  if (trigger.textPrefix) return t("workflows.card.matchingMessage");
  return messageTriggerDescription(content, t, true, options);
}

function actionClause(step: AutomationStep, t: Translate): string {
  switch (step.action) {
    case ActionEnum.Delay: {
      const duration = step.duration?.trim();
      const seconds = duration ? parseDurationSeconds(duration) : null;
      const detail = duration ? compact(seconds === null ? duration : formatDurationSecondsVerbose(seconds, t)) : null;
      return detail ? t("workflows.card.wait", {duration: detail}) : t("workflows.card.waitMoment");
    }
    case ActionEnum.SendMessage: {
      const detail = quoted(step.text);
      return detail ? t("workflows.card.send", {text: detail}) : t("workflows.card.sendMessage");
    }
    case ActionEnum.RequestApproval: {
      const detail = quoted(step.message);
      return detail ? t("workflows.card.approvalMessage", {message: detail}) : t("workflows.card.approval");
    }
    case ActionEnum.AddReaction: return step.emoji?.trim()
      ? t("workflows.card.reactionEmoji", {emoji: step.emoji.trim()}) : t("workflows.card.reaction");
    case ActionEnum.SetChannelTopic: {
      const detail = quoted(step.topic);
      return detail ? t("workflows.card.topicValue", {topic: detail}) : t("workflows.card.topic");
    }
  }
}

/** Same original first action + remaining step count, not the editable name. */
export function workflowCardLabel(content: AutomationVersionContent, t: Translate,
  options: WorkflowTriggerPresentation = {}): string {
  const trigger = workflowTriggerCardClause(content, t, options);
  const steps = content.steps;
  const first = steps?.[0];
  const action = first ? actionClause(first, t)
    : content.action?.kind === "POST_MESSAGE" ? t("workflows.card.send", {text: quoted(content.action.template) ?? ""})
    : content.action?.kind === "AGENT_TURN" ? t("workflows.card.agentTurn") : null;
  if (!action) return trigger;
  const remaining = (steps?.length ?? 1) - 1;
  return remaining === 0 ? t("workflows.card.label", {trigger, action})
    : t(remaining === 1 ? "workflows.card.oneMore" : "workflows.card.more", {trigger, action, count: remaining});
}
