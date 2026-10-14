// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/workflows/ui/WorkflowStepCard.tsx::WorkflowStepCard/StepSettingAccordion.
// The original card/detail affordances; only the actually executed actions enter its model.
import { ChevronRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { ActionEnum, ActionKind, type AutomationStep, type AutomationVersionContent, type AutomationTriggerKind as TriggerKind } from "@client-kit/contracts";
import { Button } from "./profile/buzz/shared/ui/button";
import { Input } from "./composer/shared/ui/input";
import { useT } from "./context";
import { cn } from "./profile/buzz/shared/lib/cn";
import { formatDurationSeconds, parseDurationSeconds } from "./workflow-duration";
import { WorkflowDurationField } from "./workflow-duration-field";
import { WorkflowTemplateTextarea } from "./workflow-template-textarea";
import { WorkflowMessageTextCondition } from "./workflow-message-text-condition-editor";
import { supportsMessageTextCondition } from "./workflow-message-text-condition";

// Original workflowFormTypes.ts::nextStepId. Step references are not request IDs.
const STEP_ID_PATTERN = /^step_(\d+)$/;
// Original WorkflowStepCard display fallback only; never persisted as a default
// deadline or added to an old immutable AutomationVersion.
const DEFAULT_STEP_TIMEOUT_SECONDS = 5 * 60;
// Original StepFormState.timeoutSecs is authoring text, not a wire field.
export type WorkflowStepDraft = AutomationStep & { timeoutSecs?: string };
export function validStepTimeout(value: unknown): boolean {
  return value === undefined || typeof value === "number" && Number.isSafeInteger(value)
    && value > 0 && value <= 9223372036;
}
export function workflowStepsContent(steps: WorkflowStepDraft[]): AutomationStep[] {
  return steps.map(({timeoutSecs, ...step}) => {
    if (timeoutSecs === undefined) return step;
    if (!timeoutSecs.trim()) delete step.timeout_secs;
    else step.timeout_secs = parseDurationSeconds(timeoutSecs) ?? NaN;
    return step;
  });
}
export function nextStepId(existingSteps: AutomationStep[]): string {
  const existingIds = new Set(existingSteps.map((s) => s.id));
  let maxN = 0;
  for (const id of existingIds) {
    const match = STEP_ID_PATTERN.exec(id);
    const ordinal = match ? Number(match[1]) : NaN;
    if (Number.isSafeInteger(ordinal)) maxN = Math.max(maxN, ordinal);
  }
  // Preserve normal original IDs without looping forever on a user-authored
  // suffix whose numeric representation no longer increments.
  let n = Number.isSafeInteger(maxN + 1) ? maxN + 1 : 1;
  while (existingIds.has(`step_${n}`)) n++;
  return `step_${n}`;
}

export function validApprovalPolicy(value: unknown): value is NonNullable<AutomationVersionContent["approvalPolicy"]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 2
    && typeof row.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id)
    && typeof row.version === "number" && Number.isSafeInteger(row.version) && row.version > 0;
}

export function workflowApprovalPolicy(content: AutomationVersionContent) {
  return content.steps?.find((step) => step.action === "request_approval")?.approvalPolicy ?? content.approvalPolicy;
}

export function supportedSteps(value: unknown, formatVersion: 2 | 3 = 2): value is AutomationStep[] {
  if (!Array.isArray(value) || value.length < 1) return false;
  const ids = new Set<string>();
  let approval = false;
  let messages = 0;
  return value.every((step: unknown, index) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) return false;
    const row = step as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id.trim() || ids.has(row.id)
      || (row.name !== undefined && (typeof row.name !== "string" || !row.name.trim()))) return false;
    ids.add(row.id);
    // Original Step.if: a non-empty expression; Core checks variables and syntax.
    if (row.if !== undefined && (typeof row.if !== "string" || !row.if.trim()
      || new TextEncoder().encode(row.if).length > 4096)) return false;
    if (formatVersion === 3 && row.action === "send_message") {
      messages += 1;
      return Object.keys(row).every((key) => ["id", "name", "if", "action", "text", "timeout_secs"].includes(key))
        && validStepTimeout(row.timeout_secs) && typeof row.text === "string" && !!row.text.trim();
    }
    if (formatVersion === 3 && index === value.length - 1) return false;
    // Original Step.timeout_secs on the effect step; Core enforces it before dispatch.
    if (index === value.length - 1) return validStepTimeout(row.timeout_secs) && (row.action === "add_reaction"
      ? Object.keys(row).every((key) => ["id", "name", "if", "action", "emoji", "timeout_secs"].includes(key))
        && typeof row.emoji === "string" && !!row.emoji.trim()
      : row.action === "set_channel_topic"
        ? Object.keys(row).every((key) => ["id", "name", "if", "action", "topic", "timeout_secs"].includes(key)) && typeof row.topic === "string"
      : Object.keys(row).every((key) => ["id", "name", "if", "action", "text", "timeout_secs"].includes(key))
        && row.action === "send_message" && typeof row.text === "string" && !!row.text.trim());
    if (row.action === "request_approval") {
      if (approval || messages > 0) return false;
      approval = true;
      return Object.keys(row).every((key) => ["id", "name", "if", "action", "approvalPolicy", "message"].includes(key))
        && validApprovalPolicy(row.approvalPolicy) && typeof row.message === "string" && !!row.message.trim();
    }
    return Object.keys(row).every((key) => ["id", "name", "if", "action", "duration", "timeout_secs"].includes(key))
      && validStepTimeout(row.timeout_secs)
      && row.action === "delay" && typeof row.duration === "string"
      && parseDurationSeconds(row.duration) !== null && parseDurationSeconds(row.duration)! <= 9223372036;
  });
}

export type WorkflowActionKind = ActionKind | ActionEnum.AddReaction | ActionEnum.SetChannelTopic;
export function workflowAction(content: AutomationVersionContent): {kind: WorkflowActionKind; template: string} | undefined {
  return content.formatVersion === 2 || content.formatVersion === 3
    ? content.steps?.at(-1)?.action === ActionEnum.AddReaction
      ? {kind: ActionEnum.AddReaction, template: content.steps.at(-1)?.emoji ?? ""}
      : content.steps?.at(-1)?.action === ActionEnum.SetChannelTopic
        ? {kind: ActionEnum.SetChannelTopic, template: content.steps.at(-1)?.topic ?? ""}
      : { kind: ActionKind.PostMessage, template: content.steps?.at(-1)?.text ?? "" }
    : content.action;
}

export function WorkflowStepCard({ step, index, onUpdate, onRemove, policies, trigger, previousSteps, bare = false, showHeader = true, disabled }: {
  step: WorkflowStepDraft; index: number; onUpdate: (step: WorkflowStepDraft) => void; onRemove?: () => void;
  policies?: NonNullable<AutomationVersionContent["approvalPolicy"]>[] | null;
  trigger: TriggerKind;
  previousSteps?: AutomationStep[];
  bare?: boolean; showHeader?: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState<"details" | "run-controls" | null>(null);
  const timeoutDraft = step.timeoutSecs ?? (step.timeout_secs === undefined ? "" : formatDurationSeconds(step.timeout_secs));
  const prefix = `wf-step-${index}`;
  // Original WorkflowStepCard runControlsSummary.
  const conditionSupported = supportsMessageTextCondition(trigger);
  const conditional = Boolean(step.if?.trim());
  // Original Run controls timeout; Kailo executes it for delays and effect steps
  // (approval expiry stays with its policy).
  const timed = step.action !== "request_approval";
  const timeoutLabel = timed ? timeoutDraft.trim() : "";
  const runControlsSummary = conditional && timeoutLabel ? t("workflows.steps.conditionalTimeout", {timeout: timeoutLabel})
    : conditional ? t("workflows.steps.conditional") : timeoutLabel || t("workflows.steps.default");
  return <div className={cn("space-y-0", !bare && "rounded-lg border border-border/70 bg-muted/10 p-3")}>
    {showHeader ? <div className="mb-3 flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">{t("workflows.steps.number", {number: index + 1})}</span>
      {onRemove ? <Button aria-label={t("workflows.steps.remove")} className="h-7 w-7" disabled={disabled} onClick={onRemove} size="icon" type="button" variant="ghost">
        <Trash2 className="h-4 w-4 text-muted-foreground" />
      </Button> : null}
    </div> : null}
    <section className="space-y-4 pb-5">
      {step.action === "delay" ? <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted-foreground" htmlFor={`${prefix}-duration`}>{t("workflows.steps.duration")}</label>
        <Input autoCapitalize="off" disabled={disabled} id={`${prefix}-duration`} value={step.duration ?? ""}
          placeholder={t("workflows.steps.durationExample")}
          onChange={(event) => onUpdate({ ...step, duration: event.target.value })} />
      </div>
        : step.action === "request_approval" ? <div className="space-y-2">
          <label className="block space-y-1.5 text-xs font-medium text-muted-foreground" htmlFor={`${prefix}-policy`}>
            {t("agents.automation.approvalPolicy")}
            <select id={`${prefix}-policy`} className="h-8 w-full rounded-md border border-input bg-background px-2"
              value={step.approvalPolicy ? `${step.approvalPolicy.id}:${step.approvalPolicy.version}` : ""}
              disabled={disabled || !policies} onChange={(event) => {
                const policy = policies?.find((row) => `${row.id}:${row.version}` === event.target.value);
                if (policy) onUpdate({ ...step, approvalPolicy: { id: policy.id, version: policy.version } });
              }}>
              <option value="">{t("agents.automation.select")}</option>
              {step.approvalPolicy && !policies?.some((row) => row.id === step.approvalPolicy?.id && row.version === step.approvalPolicy.version)
                ? <option disabled value={`${step.approvalPolicy.id}:${step.approvalPolicy.version}`}>{step.approvalPolicy.id} · {step.approvalPolicy.version}</option> : null}
              {policies?.map((row) => <option key={`${row.id}:${row.version}`} value={`${row.id}:${row.version}`}>{row.id} · {row.version}</option>)}
            </select>
          </label>
          <p className="text-xs text-muted-foreground">{t("workflows.steps.approvalPolicyHint")}</p>
          <label className="block space-y-1.5 text-xs font-medium text-muted-foreground" htmlFor={`${prefix}-message`}>
            {t("workflows.steps.message")}<Input autoCapitalize="off" disabled={disabled} id={`${prefix}-message`} value={step.message ?? ""}
              placeholder={t("workflows.steps.approvalMessageExample")}
              onChange={(event) => onUpdate({ ...step, message: event.target.value })} />
          </label>
        </div>
        : step.action === "add_reaction" ? <label className="block space-y-1.5 text-xs font-medium text-muted-foreground" htmlFor={`${prefix}-emoji`}>
          {t("workflows.steps.emoji")}<Input disabled={disabled} autoCapitalize="off" id={`${prefix}-emoji`} value={step.emoji ?? ""}
            placeholder={t("workflows.steps.emojiExample")}
            onChange={(event) => onUpdate({ ...step, emoji: event.target.value })} />
          <span className="block font-normal">{t("workflows.steps.reactionTarget")}</span>
        </label>
        : step.action === "set_channel_topic" ? <label className="block space-y-1.5 text-xs font-medium text-muted-foreground" htmlFor={`${prefix}-topic`}>
          {t("workflows.steps.topic")}<Input disabled={disabled} autoCapitalize="off" id={`${prefix}-topic`} value={step.topic ?? ""}
            placeholder={t("workflows.steps.topicExample")}
            onChange={(event) => onUpdate({ ...step, topic: event.target.value })} />
          <span className="block font-normal">{t("workflows.steps.topicTarget")}</span>
        </label>
        : <div className="space-y-2"><div className="space-y-1.5">
          <label className="block text-xs font-medium text-muted-foreground" htmlFor={`${prefix}-text`}>{t("workflows.steps.messageText")}</label>
          <WorkflowTemplateTextarea autoCapitalize="off" disabled={disabled} id={`${prefix}-text`} value={step.text ?? ""}
            placeholder={t("workflows.steps.messageExample")}
            triggerType={trigger} previousSteps={previousSteps} onValueChange={(text) => onUpdate({ ...step, text })}
            className="min-h-[60px] resize-y text-xs" />
        </div><p className="text-xs text-muted-foreground">{t("workflows.steps.channelTarget")}</p></div>}
    </section>
    <section className="divide-y divide-border/50 border-t border-border/50">
      {timed || conditionSupported ? <div>
        <button aria-expanded={expanded === "run-controls"} disabled={disabled}
          className="flex min-h-12 w-full items-center gap-3 py-3 text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => setExpanded((value) => value === "run-controls" ? null : "run-controls")} type="button">
          <span className="min-w-0 flex-1 truncate text-base font-medium">{t("workflows.steps.runControls")}</span>
          <span className="max-w-40 truncate text-sm text-muted-foreground">{runControlsSummary}</span>
          <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform duration-150 motion-reduce:transition-none", expanded === "run-controls" && "rotate-90")} />
        </button>
        {expanded === "run-controls" ? <div className="animate-in pb-4 pt-1 fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none"><div className="space-y-4">
          {conditionSupported ? <WorkflowMessageTextCondition disabled={disabled} value={step.if ?? ""}
            onChange={(condition) => {
              const next = { ...step };
              if (condition) next.if = condition; else delete next.if;
              onUpdate(next);
            }} /> : null}
          {timed ? <WorkflowDurationField disabled={disabled} fallbackSeconds={DEFAULT_STEP_TIMEOUT_SECONDS}
            id={`${prefix}-timeout-secs`} label={t("workflows.steps.timeout")} placeholder="5m"
            value={timeoutDraft} onChange={(timeoutSecs) => onUpdate({...step, timeoutSecs})} /> : null}
        </div></div> : null}
      </div> : null}
      <div>
      <button aria-expanded={expanded === "details"} disabled={disabled}
        className="flex min-h-12 w-full items-center gap-3 py-3 text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => setExpanded((value) => value === "details" ? null : "details")} type="button">
        <span className="min-w-0 flex-1 truncate text-base font-medium">{t("workflows.steps.details")}</span>
        <span className="max-w-40 truncate text-sm text-muted-foreground">{step.name?.trim() || step.id}</span>
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform duration-150 motion-reduce:transition-none", expanded === "details" && "rotate-90")} />
      </button>
      {expanded === "details" ? <div className="animate-in pb-4 pt-1 fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none"><div className="space-y-4">
        <label className="block space-y-1.5 text-xs font-medium text-muted-foreground" htmlFor={`${prefix}-name`}>
          {t("workflows.steps.name")}<Input autoCapitalize="off" disabled={disabled} id={`${prefix}-name`} value={step.name ?? ""}
            placeholder={t("workflows.steps.nameExample")} onChange={(event) => {
            const next = { ...step }; if (event.target.value) next.name = event.target.value; else delete next.name; onUpdate(next);
          }} /></label>
        <label className="block space-y-1.5 text-xs font-medium text-muted-foreground" htmlFor={`${prefix}-id`}>
          {t("workflows.steps.id")}<Input autoCapitalize="off" disabled={disabled} id={`${prefix}-id`} value={step.id}
            placeholder={t("workflows.steps.idExample")} onChange={(event) => onUpdate({ ...step, id: event.target.value })} /></label>
        <p className="text-xs text-muted-foreground">{t("workflows.steps.reference")}</p>
      </div></div> : null}
    </div></section>
  </div>;
}
