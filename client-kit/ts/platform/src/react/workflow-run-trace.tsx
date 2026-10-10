// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/workflows/ui/WorkflowRunTrace.tsx::WorkflowRunTrace.
// Original cards, timing and output/error layout over governed step evidence.
import { Check, Clock, SkipForward, X } from "lucide-react";
import type { AutomationRunView, AutomationStepTrace } from "@client-kit/contracts";
import { useReasonText, useT } from "./context";
import { TaskStatusBadge, WaitingReason } from "./governance";
import { Badge, type BadgeProps } from "./channel-browser/badge";
import { Button } from "./ui";

function StepStatusBadge({ status }: { status: AutomationStepTrace["status"] }) {
  const t = useT();
  const variants: Record<AutomationStepTrace["status"], BadgeProps["variant"]> = {
    completed: "success", failed: "destructive", running: "info", pending: "secondary",
    cancelled: "secondary", skipped: "secondary", waiting_approval: "warning", unknown: "secondary",
  };
  return <Badge variant={variants[status] ?? "secondary"}>{status === "waiting_approval"
    ? t("workflows.trace.status.waitingApproval") : t(`workflows.trace.status.${status}`)}</Badge>;
}

function StepStatusIcon({ status }: { status: AutomationStepTrace["status"] }) {
  switch (status) {
    case "completed": return <Check className="h-4 w-4 text-green-500" />;
    case "failed": return <X className="h-4 w-4 text-red-500" />;
    case "skipped": return <SkipForward className="h-4 w-4 text-muted-foreground" />;
    case "waiting_approval": return <Clock className="h-4 w-4 text-amber-500" />;
    default: return <Clock className="h-4 w-4 text-blue-500" />;
  }
}

function formatDuration(startedAt?: string, completedAt?: string) {
  if (!startedAt || !completedAt) return null;
  const seconds = (Date.parse(completedAt) - Date.parse(startedAt)) / 1000;
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  return `${seconds.toFixed(1)}s`;
}

export function WorkflowRunTrace({ run, onOpen }: {
  run: AutomationRunView;
  onOpen: (actionExecutionId: string) => void;
}) {
  const t = useT();
  const reasonText = useReasonText();
  const approvalNavigation = run.stepApprovalTask && !run.executionTrace?.some(step =>
    step.status === "waiting_approval" && step.output.actionExecutionId === run.stepApprovalTask?.actionExecutionId)
    ? <Button onClick={() => onOpen(run.stepApprovalTask!.actionExecutionId)}>{t("workflows.stepApproval")}</Button>
    : null;
  if (!run.executionTrace?.length) {
    return <><p className="rounded-xl border border-dashed border-border/70 bg-background/60 px-4 py-6 text-center text-sm text-muted-foreground">
      {t("workflows.trace.empty")}
    </p>{approvalNavigation}</>;
  }
  return <div className="space-y-3" data-testid="workflow-run-trace">
    {run.executionTrace.map((step) => {
      const duration = formatDuration(step.startedAt, step.completedAt);
      const pendingApproval = step.status === "waiting_approval" && run.stepApprovalTask
        && step.output.actionExecutionId === run.stepApprovalTask.actionExecutionId
        ? run.stepApprovalTask : undefined;
      return <div className="rounded-xl border border-border/60 bg-background/80 p-3 shadow-xs" key={step.stepId}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StepStatusIcon status={step.status} />
          <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">{step.stepId}</span>
          <StepStatusBadge status={step.status} />
          {duration ? <span className="text-xs text-muted-foreground">{duration}</span> : null}
        </div>
        {Object.keys(step.output).length > 0 ? <div className="mt-3">
          <p className="mb-1 text-2xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{t("workflows.trace.output")}</p>
          <pre className="max-h-32 overflow-auto rounded-lg bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">{JSON.stringify(step.output, null, 2)}</pre>
        </div> : null}
        {step.error ? <div className="mt-3">
          <p className={`mb-1 text-2xs font-medium uppercase tracking-[0.16em] ${step.status === "unknown" ? "text-muted-foreground" : "text-red-400"}`}>{t(step.status === "unknown" ? "tasks.waitingReason" : "workflows.trace.error")}</p>
          <pre className={`max-h-32 overflow-auto rounded-lg px-3 py-2 font-mono text-xs ${step.status === "unknown" ? "bg-muted/40 text-muted-foreground" : "bg-red-500/10 text-red-400"}`}>{reasonText(step.error)}</pre>
        </div> : null}
        {pendingApproval ? <div className="mt-3">
          <p className="mb-2 text-2xs font-medium uppercase tracking-[0.16em] text-amber-600">{t("workflows.trace.approval")}</p>
          <div className="rounded-xl border border-border/60 bg-background/80 p-3 shadow-xs" data-testid="workflow-approval-trace">
            <TaskStatusBadge task={pendingApproval} />
            {pendingApproval.waitingReason ? <WaitingReason code={pendingApproval.waitingReason} /> : null}
            <div className="mt-3"><Button onClick={() => onOpen(pendingApproval.actionExecutionId)}>{t("workflows.stepApproval")}</Button></div>
          </div>
        </div> : null}
      </div>;
    })}
    {approvalNavigation}
  </div>;
}
