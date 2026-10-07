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
import { WorkflowDurationField } from "./workflow-duration-field";
import { parseDurationSeconds } from "./workflow-duration";
import { WorkflowTemplateTextarea } from "./workflow-template-textarea";

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

export function supportedSteps(value: unknown): value is AutomationStep[] {
  if (!Array.isArray(value) || value.length < 1) return false;
  const ids = new Set<string>();
  let approval = false;
  return value.every((step: unknown, index) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) return false;
    const row = step as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id.trim() || ids.has(row.id)
      || (row.name !== undefined && (typeof row.name !== "string" || !row.name.trim()))) return false;
    ids.add(row.id);
    if (index === value.length - 1) return row.action === "add_reaction"
      ? Object.keys(row).every((key) => ["id", "name", "action", "emoji"].includes(key))
        && typeof row.emoji === "string" && !!row.emoji.trim()
      : row.action === "set_channel_topic"
        ? Object.keys(row).every((key) => ["id", "name", "action", "topic"].includes(key)) && typeof row.topic === "string"
      : Object.keys(row).every((key) => ["id", "name", "action", "text"].includes(key))
        && row.action === "send_message" && typeof row.text === "string" && !!row.text.trim();
    if (row.action === "request_approval") {
      if (approval) return false;
      approval = true;
      return Object.keys(row).every((key) => ["id", "name", "action", "approvalPolicy", "message"].includes(key))
        && validApprovalPolicy(row.approvalPolicy) && typeof row.message === "string" && !!row.message.trim();
    }
    return Object.keys(row).every((key) => ["id", "name", "action", "duration"].includes(key))
      && row.action === "delay" && typeof row.duration === "string"
      && parseDurationSeconds(row.duration) !== null && parseDurationSeconds(row.duration)! <= 9223372036;
  });
}

export type WorkflowActionKind = ActionKind | ActionEnum.AddReaction | ActionEnum.SetChannelTopic;
export function workflowAction(content: AutomationVersionContent): {kind: WorkflowActionKind; template: string} | undefined {
  return content.formatVersion === 2
    ? content.steps?.at(-1)?.action === ActionEnum.AddReaction
      ? {kind: ActionEnum.AddReaction, template: content.steps.at(-1)?.emoji ?? ""}
      : content.steps?.at(-1)?.action === ActionEnum.SetChannelTopic
        ? {kind: ActionEnum.SetChannelTopic, template: content.steps.at(-1)?.topic ?? ""}
      : { kind: ActionKind.PostMessage, template: content.steps?.at(-1)?.text ?? "" }
    : content.action;
}

export function WorkflowStepCard({ step, index, onUpdate, onRemove, policies, trigger }: {
  step: AutomationStep; index: number; onUpdate: (step: AutomationStep) => void; onRemove?: () => void;
  policies?: NonNullable<AutomationVersionContent["approvalPolicy"]>[] | null;
  trigger: TriggerKind;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const prefix = `wf-step-${index}`;
  return <div className="space-y-0 rounded-lg border border-border/70 bg-muted/10 p-3">
    <div className="mb-3 flex items-center justify-between gap-2">
      <span className="text-xs font-medium text-muted-foreground">{t("workflows.steps.number", {number: index + 1})}</span>
      {onRemove ? <Button aria-label={t("workflows.steps.remove")} className="h-7 w-7" onClick={onRemove} size="icon" type="button" variant="ghost">
        <Trash2 className="h-4 w-4 text-muted-foreground" />
      </Button> : null}
    </div>
    <section className="space-y-4 pb-5">
      {step.action === "delay" ? <WorkflowDurationField id={`${prefix}-duration`} value={step.duration ?? ""}
        onChange={(duration) => onUpdate({ ...step, duration })} />
        : step.action === "request_approval" ? <div className="space-y-2">
          <label className="block space-y-1.5 text-xs font-medium text-muted-foreground" htmlFor={`${prefix}-policy`}>
            {t("agents.automation.approvalPolicy")}
            <select id={`${prefix}-policy`} className="h-8 w-full rounded-md border border-input bg-background px-2"
              value={step.approvalPolicy ? `${step.approvalPolicy.id}:${step.approvalPolicy.version}` : ""}
              disabled={!policies} onChange={(event) => {
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
            {t("workflows.steps.message")}<Input id={`${prefix}-message`} value={step.message ?? ""}
              onChange={(event) => onUpdate({ ...step, message: event.target.value })} />
          </label>
        </div>
        : step.action === "add_reaction" ? <label className="block space-y-1.5 text-xs font-medium text-muted-foreground" htmlFor={`${prefix}-emoji`}>
          {t("workflows.steps.emoji")}<Input autoCapitalize="off" id={`${prefix}-emoji`} value={step.emoji ?? ""}
            onChange={(event) => onUpdate({ ...step, emoji: event.target.value })} />
          <span className="block font-normal">{t("workflows.steps.reactionTarget")}</span>
        </label>
        : step.action === "set_channel_topic" ? <label className="block space-y-1.5 text-xs font-medium text-muted-foreground" htmlFor={`${prefix}-topic`}>
          {t("workflows.steps.topic")}<Input autoCapitalize="off" id={`${prefix}-topic`} value={step.topic ?? ""}
            onChange={(event) => onUpdate({ ...step, topic: event.target.value })} />
          <span className="block font-normal">{t("workflows.steps.topicTarget")}</span>
        </label>
        : <label className="block space-y-1.5 text-xs font-medium text-muted-foreground" htmlFor={`${prefix}-text`}>
          {t("workflows.steps.message")}<WorkflowTemplateTextarea id={`${prefix}-text`} value={step.text ?? ""}
            triggerType={trigger} onValueChange={(text) => onUpdate({ ...step, text })}
            className="min-h-[60px] w-full resize-y rounded-md border border-input bg-transparent p-2 text-xs" />
        </label>}
    </section>
    <section className="divide-y divide-border/50 border-t border-border/50"><div>
      <button aria-expanded={expanded}
        className="flex min-h-12 w-full items-center gap-3 py-3 text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => setExpanded((value) => !value)} type="button">
        <span className="min-w-0 flex-1 truncate text-base font-medium">{t("workflows.steps.details")}</span>
        <span className="max-w-40 truncate text-sm text-muted-foreground">{step.name?.trim() || step.id}</span>
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform duration-150 motion-reduce:transition-none", expanded && "rotate-90")} />
      </button>
      {expanded ? <div className="animate-in pb-4 pt-1 fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none"><div className="space-y-4">
        <label className="block space-y-1.5 text-xs font-medium text-muted-foreground" htmlFor={`${prefix}-name`}>
          {t("workflows.steps.name")}<Input id={`${prefix}-name`} value={step.name ?? ""} onChange={(event) => {
            const next = { ...step }; if (event.target.value) next.name = event.target.value; else delete next.name; onUpdate(next);
          }} /></label>
        <label className="block space-y-1.5 text-xs font-medium text-muted-foreground" htmlFor={`${prefix}-id`}>
          {t("workflows.steps.id")}<Input id={`${prefix}-id`} value={step.id} onChange={(event) => onUpdate({ ...step, id: event.target.value })} /></label>
        <p className="text-xs text-muted-foreground">{t("workflows.steps.reference")}</p>
      </div></div> : null}
    </div></section>
  </div>;
}
