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
import { relativeTime } from "../format";
import { AutomationManagement } from "./agents";
import { useBffClient, useLocale, useT } from "./context";
import { TaskDetail, TaskStatusBadge } from "./governance";
import { Button, Cell, Notice, ReadFailure, Table } from "./ui";
import { useLoad } from "./use-load";

export function WorkflowsPage() {
	const t = useT();
	return (
		<div className="flex flex-col gap-4" data-testid="workflows-page">
			<h2 className="font-medium">{t("platform.tab.workflows")}</h2>
			<AutomationManagement
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
								<Table
									head={[
										t("tasks.created"),
										t("tasks.execution"),
										t("platform.state"),
										t("tasks.waitingReason"),
										t("workflows.progress"),
										t("workflows.usage"),
										t("workflows.stepApproval"),
									]}
								>
									{page.runs.map((run) => (
										<tr key={run.task.actionExecutionId}>
											<Cell title={run.task.createdAt}>
												{relativeTime(locale, run.task.createdAt)}
											</Cell>
											<Cell>
												<Button
													onClick={() => setOpen(run.task.actionExecutionId)}
												>
													{run.task.actionExecutionId}
												</Button>
											</Cell>
											<Cell>
												<TaskStatusBadge task={run.task} />
											</Cell>
											<Cell>{run.task.waitingReason ?? "—"}</Cell>
											<Cell>{run.progress ?? "—"}</Cell>
											<Cell mono>{run.usageEventIds.join(", ") || "—"}</Cell>
											<Cell>{run.stepApprovalTask ? <div className="flex flex-col gap-1">
												<TaskStatusBadge task={run.stepApprovalTask} />
												<Button onClick={() => setOpen(run.stepApprovalTask!.actionExecutionId)}>
													{t("workflows.stepApproval")}
												</Button>
											</div> : "—"}</Cell>
										</tr>
									))}
								</Table>
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
