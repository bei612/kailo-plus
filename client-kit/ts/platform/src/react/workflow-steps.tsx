// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/workflows/ui/WorkflowStepCard.tsx::WorkflowStepCard/StepSettingAccordion.
// The original card/detail affordances; only the actually executed actions enter its model.
import { ChevronRight, Trash2 } from "lucide-react";
import { useState } from "react";
import { ActionKind, type AutomationStep, type AutomationVersionContent } from "@client-kit/contracts";
import { Button } from "./profile/buzz/shared/ui/button";
import { Input } from "./composer/shared/ui/input";
import { useT } from "./context";
import { cn } from "./profile/buzz/shared/lib/cn";
import { WorkflowDurationField } from "./workflow-duration-field";
import { parseDurationSeconds } from "./workflow-duration";

export function supportedSteps(value: unknown): value is AutomationStep[] {
  if (!Array.isArray(value) || value.length < 1) return false;
  const ids = new Set<string>();
  return value.every((step: unknown, index) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) return false;
    const row = step as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id.trim() || ids.has(row.id)
      || (row.name !== undefined && (typeof row.name !== "string" || !row.name.trim()))) return false;
    ids.add(row.id);
    if (index === value.length - 1) return Object.keys(row).every((key) => ["id", "name", "action", "text"].includes(key))
      && row.action === "send_message" && typeof row.text === "string" && !!row.text.trim();
    return Object.keys(row).every((key) => ["id", "name", "action", "duration"].includes(key))
      && row.action === "delay" && typeof row.duration === "string"
      && parseDurationSeconds(row.duration) !== null && parseDurationSeconds(row.duration)! <= 9223372036;
  });
}

export function workflowAction(content: AutomationVersionContent) {
  return content.formatVersion === 2
    ? { kind: ActionKind.PostMessage, template: content.steps?.at(-1)?.text ?? "" }
    : content.action;
}

export function WorkflowStepCard({ step, index, onUpdate, onRemove }: {
  step: AutomationStep; index: number; onUpdate: (step: AutomationStep) => void; onRemove?: () => void;
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
        : <label className="block space-y-1.5 text-xs font-medium text-muted-foreground" htmlFor={`${prefix}-text`}>
          {t("workflows.steps.message")}<textarea id={`${prefix}-text`} value={step.text ?? ""}
            onChange={(event) => onUpdate({ ...step, text: event.target.value })}
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
