// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/workflows/ui/WorkflowRunTrace.tsx::WorkflowRunTrace.
// The same facts as the original trace — each step's status, its native duration, its output and
// error, and the pending approval with its approver and expiry — presented as the DD-168 timeline
// (.design/20 §16.5(4)): a dot per step, the step and its status, the duration, then details.
// Output is a document for support, folded behind a disclosure (§16.5(6)); errors are read in words.
// desktop/src/features/workflows/ui/WorkflowApprovalCard.tsx: the pending approval's approver and
// expiry come from the existing approval read (ApprovalView roleRequirements/expiresAt), shown only
// when Core admits that read for this viewer; the card hides once the approval is no longer
// pending or has expired. Kailo keeps its step-approval entry (approval actions exist here).
import { useQuery } from "@tanstack/react-query";
import { ApprovalStatus, type AutomationRunView, type AutomationStepTrace, type TaskView } from "@client-kit/contracts";
import { ListChecks } from "lucide-react";
import { approvalSelectorMessages, enumLabel } from "../i18n";
import { useBffClient, useLocale, useReasonText, useT } from "./context";
import { TaskStatusBadge, WaitingReason } from "./governance";
import { RawData, type TagTone, Timeline, type TimelineItem } from "./key-value";
import { EmptyState } from "./state-views";
import { Badge, Button, type Tone } from "./ui";

function WorkflowApprovalCard({ task }: { task: TaskView }) {
  const client = useBffClient(); const t = useT(); const locale = useLocale();
  const workflowId = task.approvalWorkflowId;
  const approval = useQuery({ queryKey: ["platform", "approval", workflowId ?? ""], enabled: Boolean(workflowId),
    queryFn: () => client.approval(workflowId!), retry: false });
  const view = approval.isSuccess ? approval.data : undefined;
  if (!view || (view.status !== ApprovalStatus.Requested && view.status !== ApprovalStatus.Waiting)
    || new Date(view.expiresAt) < new Date()) return null;
  const approver = view.roleRequirements.map(requirement => enumLabel(locale, approvalSelectorMessages, requirement.selector)).join(", ");
  return <div className="flex flex-col gap-1" data-testid="workflow-approval-card">
    <p className="text-sm font-medium text-foreground">{t("workflows.approval.required")}</p>
    <p className="text-xs text-muted-foreground">{t("workflows.approval.approver", { approver })}</p>
    <p className="text-xs text-muted-foreground">{t("workflows.approval.expires", { time: new Date(view.expiresAt).toLocaleString(locale) })}</p>
  </div>;
}

const stepTone: Record<AutomationStepTrace["status"], Tone> = {
  completed: "positive", failed: "negative", running: "info", pending: "neutral",
  cancelled: "neutral", skipped: "neutral", waiting_approval: "warning", unknown: "neutral",
};

function StepStatusBadge({ status }: { status: AutomationStepTrace["status"] }) {
  const t = useT();
  return <Badge tone={stepTone[status] ?? "neutral"}>{status === "waiting_approval"
    ? t("workflows.trace.status.waitingApproval") : t(`workflows.trace.status.${status}`)}</Badge>;
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
    ? <div><Button onClick={() => onOpen(run.stepApprovalTask!.actionExecutionId)}>{t("workflows.stepApproval")}</Button></div>
    : null;
  if (!run.executionTrace?.length) {
    return <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-dashed border-border bg-card">
        <EmptyState compact icon={ListChecks} title={t("workflows.trace.empty")} />
      </div>
      {approvalNavigation}
    </div>;
  }
  const items: TimelineItem[] = run.executionTrace.map((step) => {
    const duration = formatDuration(step.startedAt, step.completedAt);
    const pendingApproval = step.status === "waiting_approval" && run.stepApprovalTask
      && step.output.actionExecutionId === run.stepApprovalTask.actionExecutionId
      ? run.stepApprovalTask : undefined;
    const unknown = step.status === "unknown";
    const hasOutput = Object.keys(step.output).length > 0;
    return {
      id: step.stepId,
      tone: (stepTone[step.status] ?? "neutral") as TagTone,
      title: <span className="inline-flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 truncate">{step.stepId}</span>
        <StepStatusBadge status={step.status} />
      </span>,
      time: duration ?? undefined,
      description: hasOutput || step.error || pendingApproval ? <div className="mt-1 flex flex-col gap-2">
        {step.error ? <p className={`text-sm ${unknown ? "text-muted-foreground" : "text-danger-text"}`} data-testid="workflow-step-error">
          <span className="font-medium">{t(unknown ? "tasks.waitingReason" : "workflows.trace.error")}</span>
          {" · "}{reasonText(step.error)}
        </p> : null}
        {pendingApproval ? <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3" data-testid="workflow-approval-trace">
          <p className="text-xs font-medium text-warning-text">{t("workflows.trace.approval")}</p>
          <WorkflowApprovalCard task={pendingApproval} />
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatusBadge task={pendingApproval} />
            {pendingApproval.waitingReason ? <span className="text-xs text-muted-foreground"><WaitingReason code={pendingApproval.waitingReason} /></span> : null}
          </div>
          <div><Button onClick={() => onOpen(pendingApproval.actionExecutionId)}>{t("workflows.stepApproval")}</Button></div>
        </div> : null}
        {hasOutput ? <RawData value={step.output} label={t("workflows.trace.output")} /> : null}
      </div> : undefined,
    };
  });
  return <div className="flex flex-col gap-3">
    <Timeline items={items} testId="workflow-run-trace" />
    {approvalNavigation}
  </div>;
}
