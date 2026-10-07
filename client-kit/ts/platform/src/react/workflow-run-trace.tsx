// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/workflows/ui/WorkflowRunTrace.tsx::WorkflowRunTrace.
// Only existing governed execution references are rendered. TaskProjection is
// not a native arbitrary-step trace, and no missing step/timing is invented.
import { Check, Clock, X } from "lucide-react";
import type { AutomationRunView, TaskView } from "@client-kit/contracts";
import { taskPhase } from "../governance";
import { useReasonText, useT } from "./context";
import { TaskStatusBadge, WaitingReason } from "./governance";
import { Button } from "./ui";

export function WorkflowRunTrace({ run, onOpen }: {
  run: AutomationRunView;
  onOpen: (actionExecutionId: string) => void;
}) {
  const t = useT();
  const reasonText = useReasonText();
  const execution = (task: TaskView, approval: boolean) => {
    const phase = taskPhase(task);
    const Icon = phase.tone === "positive" ? Check : phase.tone === "negative" ? X : Clock;
    const label = t(approval ? "workflows.stepApproval" : "tasks.execution");
    return <div className="rounded-xl border border-border/60 bg-background/80 p-3 shadow-xs"
      key={task.actionExecutionId} data-testid={approval ? "workflow-approval-trace" : "workflow-execution-trace"}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Icon aria-hidden className="h-4 w-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{label}</span>
        <TaskStatusBadge task={task} />
      </div>
      <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{task.actionExecutionId}</p>
      {task.observation ? <p className="mt-3 text-xs text-muted-foreground" role="status">{reasonText(task.observation)}</p> : null}
      {task.waitingReason ? <div className="mt-3 text-xs text-muted-foreground">
        <p className="mb-1 font-medium">{t("tasks.waitingReason")}</p><WaitingReason code={task.waitingReason} />
      </div> : null}
      <div className="mt-3"><Button onClick={() => onOpen(task.actionExecutionId)}>{label}</Button></div>
    </div>;
  };
  return <div className="space-y-3" data-testid="workflow-run-trace">
    {run.stepApprovalTask ? execution(run.stepApprovalTask, true) : null}
    {execution(run.task, false)}
  </div>;
}
