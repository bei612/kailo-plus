// REQ-23 / .design/06 §9.1: one Workflows surface for both React hosts.
// Definitions reuse the existing governed Automation implementation. History is
// an exact, authorized BFF query, never a filtered copy of the global Tasks list.
import {
	ActionDispatchState,
	ActionGateState,
	ApprovalStatus,
	ReasonCode,
	TaskStatus,
	type AutomationRunPage,
} from "@client-kit/contracts";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { relativeTime } from "../format";
import { AutomationManagement, type WorkspaceNavigation } from "./agents";
import { useBffClient, useLocale, useT } from "./context";
import { TaskDetail, TaskStatusBadge, WaitingReason } from "./governance";
import { WorkflowRunTrace } from "./workflow-run-trace";
import { Button, Notice, ReadFailure } from "./ui";
import { useLoad } from "./use-load";
import type { WorkflowNavigation } from "./workflow-discard-dialog";
export { workflowBlocksNavigation, type WorkflowNavigation, type WorkflowNavigationState } from "./workflow-discard-dialog";

export function WorkflowsPage(navigation: WorkspaceNavigation & { workflowNavigation?: WorkflowNavigation } = {}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-7 sm:px-6 sm:py-8" data-testid="workflows-page" data-scroll-restoration-id="workflows-list">
			<AutomationManagement
				{...navigation}
				renderRunHistory={(resourceId, workspaceId) => (
					<AutomationRunHistory
						key={`${workspaceId}:${resourceId}`}
						resourceId={resourceId}
						workspaceId={workspaceId}
					/>
				)}
			/>
		</div>
	);
}

const nonempty = (value: unknown): value is string =>
	typeof value === "string" && !!value;

/** Generated TaskView enums and original taskPhase remain the state authority. */
export function validAutomationRuns(
	page: AutomationRunPage,
	resourceId: string,
	workspaceId: string,
	cursors: readonly (string | undefined)[],
): boolean {
	return (
		!!page &&
		page.automationResourceId === resourceId &&
		Array.isArray(page.runs) &&
		page.runs.every((run) => {
			const task = run?.task;
			const step = run?.stepApprovalTask;
			return (
				!!task &&
				task.actionKey === "automation.run" &&
				task.targetId === resourceId &&
				task.workspaceId === workspaceId &&
				nonempty(task.operationId) &&
				nonempty(task.actionExecutionId) &&
				Number.isSafeInteger(task.actionVersion) &&
				task.actionVersion > 0 &&
				typeof task.createdAt === "string" &&
				Number.isFinite(new Date(task.createdAt).getTime()) &&
				Object.values(ActionGateState).includes(task.gateState) &&
				Object.values(ActionDispatchState).includes(task.dispatchState) &&
				(task.reason === undefined ||
					Object.values(ReasonCode).includes(task.reason)) &&
				(task.observation === undefined ||
					Object.values(ReasonCode).includes(task.observation)) &&
				(task.approvalStatus === undefined ||
					Object.values(ApprovalStatus).includes(task.approvalStatus)) &&
				(task.approvalWorkflowId === undefined ||
					nonempty(task.approvalWorkflowId)) &&
				(task.workflowId === undefined
					? task.workflowKind === undefined && task.taskStatus === undefined
					: nonempty(task.workflowId) &&
						task.workflowKind === undefined &&
						(task.taskStatus === undefined ||
							Object.values(TaskStatus).includes(task.taskStatus))) &&
				(task.waitingReason === undefined ||
					typeof task.waitingReason === "string") &&
				(run.progress === undefined || typeof run.progress === "string") &&
				(step === undefined || (!!step &&
					step.actionExecutionId !== task.actionExecutionId &&
					step.operationId === task.operationId &&
					step.actionVersion === task.actionVersion &&
					nonempty(step.approvalWorkflowId) &&
					step.workflowId === undefined &&
					step.workflowKind === undefined &&
					step.taskStatus === undefined &&
					validAutomationRuns({ automationResourceId: resourceId,
						runs: [{ task: step, usageEventIds: [] }] }, resourceId, workspaceId, [])
				)) &&
				Array.isArray(run.usageEventIds) &&
				run.usageEventIds.every(nonempty) &&
				new Set(run.usageEventIds).size === run.usageEventIds.length
			);
		}) &&
		new Set(page.runs.map((run) => run.task.actionExecutionId)).size ===
			page.runs.length &&
		(page.nextCursor === undefined ||
			(nonempty(page.nextCursor) && !cursors.includes(page.nextCursor)))
	);
}

function AutomationRunHistory({
	resourceId,
	workspaceId,
}: {
	resourceId: string;
	workspaceId: string;
}) {
	const client = useBffClient();
	const t = useT();
	const locale = useLocale();
	const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
	const [index, setIndex] = useState(0);
	const [open, setOpen] = useState<string | null>(null);
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const cursor = cursors[index];
	const [state, reload] = useLoad(
		`automation-runs:${workspaceId}:${resourceId}:${cursor ?? ""}`,
		() => client.automationRuns(resourceId, cursor),
	);
	const value = state.status === "ok" ? state.data : null;
	const page =
		value &&
		validAutomationRuns(
			value,
			resourceId,
			workspaceId,
			cursors.slice(0, index + 1),
		)
			? value
			: null;

	return (
		<section
			className="flex flex-col gap-3 border-t pt-4"
			data-testid="workflow-runs"
		>
			<h3 className="font-medium">{t("workflows.history")}</h3>
			{open ? (
				<TaskDetail
					key={open}
					actionExecutionId={open}
					onBack={() => setOpen(null)}
					onOpen={setOpen}
				/>
			) : (
				<>
					<Button className="w-fit" onClick={reload}>
						{t("platform.refresh")}
					</Button>
					{state.status === "pending" ? (
						<Notice role="status">{t("platform.loading")}</Notice>
					) : !page ? (
						<ReadFailure
							error={state.status === "error" ? state.error : undefined}
							onRetry={reload}
						/>
					) : (
						<>
							{page.runs.length === 0 ? (
								<Notice>{t("workflows.noRuns")}</Notice>
							) : (
								<div className="space-y-2">
									{/* Buzz 779af8886caae1317b4de962082429867ab61503:
									    desktop/src/features/workflows/ui/WorkflowDetailPanel.tsx
									    WorkflowDetailPanel run cards. Temporal TaskView replaces
									    Relay WorkflowRun; no fabricated step trace or duration. */}
									{page.runs.map((run) => {
										const id = run.task.actionExecutionId;
										const isSelected = selectedRunId === id;
										return (
											<div
												className={`overflow-hidden rounded-xl border bg-card/70 transition-colors ${isSelected
													? "border-primary/40 bg-primary/5 shadow-xs"
													: "border-border/70 hover:bg-muted/20"}`}
												key={id}
											>
												<button
													aria-expanded={isSelected}
													aria-label={id}
													className="w-full px-4 py-3 text-left"
													data-testid={isSelected ? "workflow-selected-run" : undefined}
													onClick={() => setSelectedRunId(isSelected ? null : id)}
													type="button"
												>
													<div className="flex items-start justify-between gap-3">
														<div className="min-w-0 flex-1">
															<div className="flex items-center gap-2">
																{isSelected ? <ChevronDown aria-hidden className="h-4 w-4 text-muted-foreground" />
																	: <ChevronRight aria-hidden className="h-4 w-4 text-muted-foreground" />}
																<span className="truncate font-mono text-xs font-medium" title={id}>{id}</span>
																<TaskStatusBadge task={run.task} />
															</div>
															<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-2xs text-muted-foreground">
																<time dateTime={run.task.createdAt} title={run.task.createdAt}>{relativeTime(locale, run.task.createdAt)}</time>
																{run.progress ? <span>{t("workflows.progress")}: {run.progress}</span> : null}
																{run.stepApprovalTask ? <TaskStatusBadge task={run.stepApprovalTask} /> : null}
															</div>
															{run.task.waitingReason ? <p className="mt-2 break-words pl-6 text-xs text-muted-foreground"><WaitingReason code={run.task.waitingReason} /></p> : null}
														</div>
													</div>
												</button>
												{isSelected ? (
													<div className="border-t border-border/60 bg-background/60 px-4 py-4">
														<div className="mb-3 flex items-center gap-2 text-2xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
															<span>{t("tasks.execution")}</span>
														</div>
														<WorkflowRunTrace run={run} onOpen={setOpen} />
														<dl className="mt-3 space-y-3 text-xs">
															<div><dt className="text-muted-foreground">{t("workflows.usage")}</dt>
																<dd className="mt-1 break-all font-mono">{run.usageEventIds.join(", ") || "—"}</dd></div>
														</dl>
													</div>
												) : null}
											</div>
										);
									})}
								</div>
							)}
							<div className="flex gap-2">
								{index > 0 ? (
									<Button onClick={() => setIndex(index - 1)}>
										{t("roles.previous")}
									</Button>
								) : null}
								{page.nextCursor !== undefined ? (
									<Button
										onClick={() => {
											setCursors((old) => [
												...old.slice(0, index + 1),
												page.nextCursor,
											]);
											setIndex(index + 1);
										}}
									>
										{t("roles.next")}
									</Button>
								) : null}
							</div>
						</>
					)}
				</>
			)}
		</section>
	);
}
