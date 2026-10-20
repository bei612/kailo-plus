// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/workflows/ui/workflowDefinition.ts::getWorkflowCardLabel,
// getTriggerCardClause/getActionCardClause and workflowStepDescription.ts::compact.
// Original admitted trigger/action branches; wire data remains AutomationVersionContent.
import { AutomationStepAction, type AutomationStep, type AutomationVersionContent } from "@client-kit/contracts";
import type { Translate } from "./context";
import { parseConditionExpressions, type ParsedConditionExpression } from "./workflow-condition-expression";
import { formatDurationSeconds, formatDurationSecondsVerbose, parseDurationSeconds } from "./workflow-duration";
import { scheduleFormFromTrigger } from "./workflow-schedule";
import { truncateNpub, truncatePubkey } from "./conversations/pubkey";

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

export type WorkflowTriggerDescriptionOptions = WorkflowTriggerPresentation & {
  messageLabel?: string;
  messageLoading?: boolean;
  /** Original compactWorkflowTriggerDescription: the node icon already shows this emoji. */
  iconEmoji?: string;
};

const diffCardKeys = {
  contains: "workflows.card.diffContains", not_contains: "workflows.card.diffNotContains",
  starts_with: "workflows.card.diffStartsWith", ends_with: "workflows.card.diffEndsWith",
  equals: "workflows.card.diffEquals", not_equals: "workflows.card.diffNotEquals",
  is_not_empty: "workflows.card.diffWithText", is_empty: "workflows.card.diffWithoutText",
} as const;

// Original workflowTriggerDescription authorReference/messageReference
// attribution, including the omitUnresolvedReferences summary behaviour.
function authorAttribution(conditions: ParsedConditionExpression[], t: Translate, options: WorkflowTriggerDescriptionOptions): string {
  const author = conditions.find(condition => condition.field === "trigger_author");
  if (!author || (options.omitUnresolvedReferences && !options.authorLabel && !options.authorLoading)) return "";
  const label = options.authorLoading ? t("workflows.trigger.loadingAuthor") : options.authorLabel ?? truncateNpub(author.value);
  return t(author.operator === "not_equals" ? "workflows.trigger.exceptAuthor" : "workflows.trigger.byAuthor", {author: label});
}
function messageTarget(conditions: ParsedConditionExpression[], t: Translate, options: WorkflowTriggerDescriptionOptions): string {
  const message = conditions.find(condition => condition.field === "trigger_message_id");
  if (!message || (options.omitUnresolvedReferences && !options.messageLabel && !options.messageLoading)) return "";
  const label = options.messageLoading ? t("workflows.trigger.loadingMessage")
    : options.messageLabel ? `“${compact(options.messageLabel, 36)}”` : truncatePubkey(message.value);
  return t(message.operator === "not_equals" ? "workflows.trigger.exceptMessage" : "workflows.trigger.toMessage", {message: label});
}

const diffKeys = {
  contains: "workflows.trigger.diffContains", not_contains: "workflows.trigger.diffNotContains",
  starts_with: "workflows.trigger.diffStartsWith", ends_with: "workflows.trigger.diffEndsWith",
  equals: "workflows.trigger.diffEquals", not_equals: "workflows.trigger.diffNotEquals",
  is_not_empty: "workflows.trigger.diffWithText", is_empty: "workflows.trigger.diffWithoutText",
} as const;

/**
 * Original workflowTriggerDescription.ts::workflowTriggerDescription for the
 * admitted message, diff and reaction triggers, rendered on the canvas node.
 * Kailo MENTION and legacy textPrefix keep their existing summary.
 */
export function workflowTriggerDescription(content: AutomationVersionContent, t: Translate,
  options: WorkflowTriggerDescriptionOptions = {}): string {
  const trigger = content.trigger;
  if (trigger.kind === "SCHEDULE" || trigger.kind === "MENTION" || trigger.kind === "WEBHOOK" || trigger.textPrefix) {
    return workflowTriggerSummary(content, t);
  }
  const type = trigger.kind === "DIFF_POSTED" ? "diff_posted" : trigger.kind === "REACTION_ADDED" ? "reaction_added" : "message_posted";
  const conditions = trigger.filter ? parseConditionExpressions(trigger.filter, type) : [];
  if (!conditions) return t(type === "diff_posted" ? "workflows.trigger.diff" : type === "reaction_added" ? "workflows.trigger.reaction" : "workflows.trigger.message", {author: ""});
  if (type === "message_posted") return messageTriggerDescription(content, t, false, options);
  const attribution = authorAttribution(conditions, t, options);
  if (type === "diff_posted") {
    const text = conditions.find(condition => condition.field === "trigger_text");
    if (!text) return t("workflows.trigger.diffPosted", {author: attribution});
    return t(diffKeys[text.operator], {value: `“${compact(text.value, 36)}”`, author: attribution});
  }
  const emoji = conditions.find(condition => condition.field === "trigger_emoji");
  const target = messageTarget(conditions, t, options);
  // A legacy trigger.emoji is not part of the original sentence; the canvas
  // shows it as the node icon (WorkflowFormBuilder triggerEmoji).
  const emojiValue = emoji?.value.trim();
  if (emoji?.operator === "not_equals" && emojiValue) {
    return t("workflows.trigger.reactionExceptEmoji", {emoji: emojiValue, author: attribution, message: target});
  }
  return emojiValue && emojiValue !== options.iconEmoji
    ? t("workflows.trigger.reactionEmoji", {emoji: emojiValue, author: attribution, message: target})
    : t("workflows.trigger.reactionAdded", {author: attribution, message: target});
}

/**
 * Original workflowTriggerDescription.ts::splitWorkflowAuthorDescription: locate
 * the generated author attribution (exclusion first) without matching quoted
 * user copy. Markers are the localized attribution phrases.
 */
export function splitWorkflowAuthorDescription(description: string, label: string, t: Translate): {prefix: string; suffix: string} | null {
  const markers = [t("workflows.trigger.exceptAuthor", {author: label}), t("workflows.trigger.byAuthor", {author: label})];
  for (const marker of markers) {
    let insideQuote = false;
    for (let index = 0; index <= description.length - marker.length; index += 1) {
      const character = description[index];
      if (character === "“") insideQuote = true;
      if (character === "”") insideQuote = false;
      if (!insideQuote && description.startsWith(marker, index)) {
        const labelIndex = index + marker.lastIndexOf(label);
        return {prefix: description.slice(0, labelIndex).trimEnd(), suffix: description.slice(labelIndex + label.length).trimStart()};
      }
    }
  }
  return null;
}

/** Original getWorkflowTriggerSummary uses omission, unlike the card's author presentation. */
export function workflowTriggerSummary(content: AutomationVersionContent, t: Translate): string {
  if (content.trigger.kind === "SCHEDULE") return t("workflows.trigger.schedule");
  if (content.trigger.kind === "WEBHOOK") return t("workflows.trigger.webhook");
  if (content.trigger.kind === "MENTION") return t("workflows.trigger.mention");
  if (content.trigger.textPrefix) return t("workflows.trigger.matchingMessage");
  return workflowTriggerDescription(content, t, {omitUnresolvedReferences: true});
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
  options: WorkflowTriggerDescriptionOptions = {}): string {
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
  // Original getTriggerCardClause: "When a webhook arrives".
  if (trigger.kind === "WEBHOOK") return t("workflows.card.webhook");
  // Original getWorkflowCardLabel: the presented condition clause
  // (getPresentedTriggerCardClause), else getTriggerCardClause.
  if (trigger.kind === "DIFF_POSTED") {
    const conditions = trigger.filter ? parseConditionExpressions(trigger.filter, "diff_posted") : [];
    if (!conditions) return t("workflows.card.matchingDiff");
    const author = authorAttribution(conditions, t, options);
    const text = conditions.find(condition => condition.field === "trigger_text");
    if (text) return t(diffCardKeys[text.operator], {value: `“${compact(text.value, 36)}”`, author});
    return author ? t("workflows.card.diffPosted", {author}) : t("workflows.card.diff");
  }
  if (trigger.kind === "REACTION_ADDED") {
    const conditions = trigger.filter ? parseConditionExpressions(trigger.filter, "reaction_added") : [];
    const emoji = conditions?.find(condition => condition.field === "trigger_emoji");
    if (emoji?.operator === "not_equals" && emoji.value.trim()) {
      return t("workflows.card.reactionExceptEmoji", {emoji: emoji.value.trim()});
    }
    const emojiValue = (emoji?.operator === "equals" ? emoji.value.trim() : "") || trigger.emoji?.trim();
    if (emojiValue) return t("workflows.card.reactionTriggerWith", {emoji: emojiValue});
    const author = conditions ? authorAttribution(conditions, t, options) : "";
    const message = conditions ? messageTarget(conditions, t, options) : "";
    return author || message ? t("workflows.card.reactionAdded", {author, message}) : t("workflows.card.reactionTrigger");
  }
  // Legacy textPrefix is an additional Kailo constraint, not a Buzz filter.
  if (trigger.textPrefix) return t("workflows.card.matchingMessage");
  return messageTriggerDescription(content, t, true, options);
}

function actionClause(step: AutomationStep, t: Translate): string {
  switch (step.action) {
    case AutomationStepAction.Delay: {
      const duration = step.duration?.trim();
      const seconds = duration ? parseDurationSeconds(duration) : null;
      const detail = duration ? compact(seconds === null ? duration : formatDurationSecondsVerbose(seconds, t)) : null;
      return detail ? t("workflows.card.wait", {duration: detail}) : t("workflows.card.waitMoment");
    }
    case AutomationStepAction.SendMessage: {
      const detail = quoted(step.text);
      return detail ? t("workflows.card.send", {text: detail}) : t("workflows.card.sendMessage");
    }
    case AutomationStepAction.RequestApproval: {
      const detail = quoted(step.message);
      return detail ? t("workflows.card.approvalMessage", {message: detail}) : t("workflows.card.approval");
    }
    case AutomationStepAction.AddReaction: return step.emoji?.trim()
      ? t("workflows.card.reactionEmoji", {emoji: step.emoji.trim()}) : t("workflows.card.reaction");
    case AutomationStepAction.SetChannelTopic: {
      const detail = quoted(step.topic);
      return detail ? t("workflows.card.topicValue", {topic: detail}) : t("workflows.card.topic");
    }
    case AutomationStepAction.CallWebhook: {
      const url = step.url?.trim();
      return url ? t("workflows.card.call", {target: `${step.method?.trim() || "POST"} ${compact(url)}`})
        : t("workflows.card.callWebhook");
    }
  }
}

/** Same original first action + remaining step count, not the editable name. */
export function workflowCardLabel(content: AutomationVersionContent, t: Translate,
  options: WorkflowTriggerDescriptionOptions = {}): string {
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
