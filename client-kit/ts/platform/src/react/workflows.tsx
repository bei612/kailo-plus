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
	type AutomationRunView,
	type ActionSubmission,
} from "@client-kit/contracts";
import { useState } from "react";
import { ChevronRight, History as HistoryIcon } from "lucide-react";
import { relativeTime } from "../format";
import { TransportError } from "../transport";
import { AutomationManagement, type WorkflowRouteNavigation, type WorkspaceNavigation } from "./agents";
import { useBffClient, useLocale, useReasonText, useT } from "./context";
import { taskPhase } from "../governance";
import { TaskDetail, TaskStatusBadge, WaitingReason } from "./governance";
import { WorkflowRunTrace } from "./workflow-run-trace";
import { Button } from "./ui";
import { useLoad } from "./use-load";
import { type DataColumn, DataTable } from "./data-table";
import { IdText, KeyValueList } from "./key-value";
import { DetailHeader, PageSection, RefreshButton } from "./page-layout";
import { EmptyState, ErrorState, TableSkeleton } from "./state-views";
import type { WorkflowNavigation } from "./workflow-discard-dialog";
import { WorkflowMessageHostProvider, type WorkflowMessageHost } from "./workflow-message-host";
export { workflowBlocksNavigation, type WorkflowNavigation, type WorkflowNavigationState } from "./workflow-discard-dialog";
export type { WorkflowMessageHost } from "./workflow-message-host";
export type { WorkflowRoute, WorkflowRouteNavigation } from "./agents";

export function WorkflowsPage({ messageHost, ...navigation }: WorkspaceNavigation & WorkflowRouteNavigation & {
	workflowNavigation?: WorkflowNavigation;
	/** Host channel reads for the original trigger message picker. */
	messageHost?: WorkflowMessageHost;
} = {}) {
	return (
		<WorkflowMessageHostProvider value={messageHost}>
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-7 sm:px-6 sm:py-8" data-testid="workflows-page" data-scroll-restoration-id="workflows-list">
			<AutomationManagement
				{...navigation}
				renderRunHistory={(resourceId, workspaceId, receipt) => (
					<AutomationRunHistory
						key={`${workspaceId}:${resourceId}`}
						resourceId={resourceId}
						workspaceId={workspaceId}
						receipt={receipt}
					/>
				)}
			/>
		</div>
		</WorkflowMessageHostProvider>
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

// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/workflows/ui/WorkflowDetailPanel.tsx::{formatRunDuration, WorkflowDetailPanel}
// run-card facts, derived only from the governed step trace: "N steps", the run duration when every
// step carries native start/completion times and none is still open, and "Current step N" for the
// step still running or waiting for approval. Absent native facts are omitted, never inferred.
export function automationRunSummary(run: AutomationRunView): {
	steps: number; duration: string | null; currentStep: number | null;
} {
	const trace = run.executionTrace ?? [];
	const open = trace.findIndex((step) => step.status === "running" || step.status === "waiting_approval");
	const settled = trace.length > 0 && trace.every((step) => step.status !== "pending" && step.status !== "running"
		&& step.status !== "waiting_approval" && step.status !== "unknown");
	const starts = trace.map((step) => step.startedAt ? Date.parse(step.startedAt) : Number.NaN);
	const ends = trace.map((step) => step.completedAt ? Date.parse(step.completedAt) : Number.NaN);
	let duration: string | null = null;
	if (settled && starts.some(Number.isFinite) && ends.every(Number.isFinite)) {
		const seconds = (Math.max(...ends) - Math.min(...starts.filter(Number.isFinite))) / 1000;
		if (Number.isFinite(seconds) && seconds >= 0)
			duration = seconds < 1 ? `${Math.round(seconds * 1000)}ms` : `${seconds.toFixed(1)}s`;
	}
	return { steps: trace.length, duration, currentStep: open >= 0 ? open + 1 : null };
}

/** Pages of run history read per round (DD-168 §16.2(3)); "Load more" reads the next round. */
const RUN_PAGES = 10;

type RunCollection = { runs: AutomationRunView[]; complete: boolean };

function absoluteTime(locale: string, value: string): string {
	const at = new Date(value);
	return Number.isNaN(at.getTime()) ? value : at.toLocaleString(locale);
}

/** The one line that says what a run is doing or why it stopped (failure reason, wait, progress). */
function RunNote({ run }: { run: AutomationRunView }) {
	const t = useT();
	const reasonText = useReasonText();
	// Original workflowRunFailureReason: a denied/expired/aborted/failed run shows its reason in
	// red; an unknown outcome stays neutral (never a failure or success).
	const phase = taskPhase(run.task);
	const reasonTone = run.task.reason === undefined ? null
		: phase.tone === "negative" ? "text-destructive"
		: phase.label === "tasks.status.unknown" ? "text-muted-foreground" : null;
	if (run.task.reason !== undefined && reasonTone)
		return <span className={`truncate ${reasonTone}`} data-testid="workflow-run-failure-reason">{reasonText(run.task.reason)}</span>;
	if (run.task.waitingReason)
		return <span className="truncate text-muted-foreground"><WaitingReason code={run.task.waitingReason} /></span>;
	if (run.progress) return <span className="truncate text-muted-foreground">{t("workflows.progress")}: {run.progress}</span>;
	return null;
}

function RunTechnicalDetails({ run }: { run: AutomationRunView }) {
	const t = useT();
	const [open, setOpen] = useState(false);
	return <section className="flex flex-col gap-2" data-testid="workflow-run-technical">
		<button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
			className="inline-flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
			<ChevronRight aria-hidden className={`h-4 w-4 transition-transform duration-[140ms] ${open ? "rotate-90" : ""}`} strokeWidth={1.75} />
			{t("workflows.run.technical")}
		</button>
		{open ? <KeyValueList items={[
			{ id: "execution", label: t("workflows.run.executionId"), value: <IdText value={run.task.actionExecutionId} /> },
			{ id: "operation", label: t("workflows.run.operationId"), value: <IdText value={run.task.operationId} /> },
			run.task.workflowId ? { id: "workflow", label: t("workflows.run.workflowId"), value: <IdText value={run.task.workflowId} /> } : undefined,
			run.stepApprovalTask ? { id: "approval", label: t("workflows.run.approvalExecutionId"), value: <IdText value={run.stepApprovalTask.actionExecutionId} /> } : undefined,
			{ id: "usage", label: t("workflows.usage"), value: run.usageEventIds.length === 0 ? t("kv.none")
				: <span className="flex flex-col gap-1">{run.usageEventIds.map((id) => <IdText key={id} value={id} />)}</span> },
		]} /> : null}
	</section>;
}

/** One run: its status and facts, the step timeline, the task reader and the technical references. */
function AutomationRunDetail({ run, onBack, onOpen }: {
	run: AutomationRunView;
	onBack: () => void;
	onOpen: (actionExecutionId: string) => void;
}) {
	const t = useT();
	const locale = useLocale();
	const summary = automationRunSummary(run);
	const facts = [
		run.executionTrace ? t(summary.steps === 1 ? "workflows.run.step" : "workflows.run.steps", { count: summary.steps }) : null,
		summary.duration,
		summary.currentStep !== null ? t("workflows.run.currentStep", { step: summary.currentStep }) : null,
	].filter(Boolean).join(" · ");
	return <div className="flex flex-col gap-5" data-testid="workflow-selected-run" data-run-id={run.task.actionExecutionId}>
		<DetailHeader onBack={onBack}
			title={t("workflows.run.title", { time: absoluteTime(locale, run.task.createdAt) })}
			status={<TaskStatusBadge task={run.task} />}
			subtitle={facts || undefined}
			actions={<Button onClick={() => onOpen(run.task.actionExecutionId)}>{t("workflows.run.openTask")}</Button>} />
		<KeyValueList columns={2} items={[
			{ id: "started", label: t("workflows.run.startedAt"), value: <time dateTime={run.task.createdAt} title={run.task.createdAt}>{absoluteTime(locale, run.task.createdAt)}</time> },
			{ id: "status", label: t("workflows.run.status"), value: <TaskStatusBadge task={run.task} /> },
			run.executionTrace ? { id: "steps", label: t("workflows.run.stepsLabel"), value: t(summary.steps === 1 ? "workflows.run.step" : "workflows.run.steps", { count: summary.steps }) } : undefined,
			summary.duration ? { id: "duration", label: t("workflows.run.duration"), value: summary.duration } : undefined,
			summary.currentStep !== null ? { id: "current", label: t("workflows.run.current"), value: t("workflows.run.currentStep", { step: summary.currentStep }) } : undefined,
			run.progress ? { id: "progress", label: t("workflows.progress"), value: run.progress } : undefined,
			run.stepApprovalTask ? { id: "approval", label: t("workflows.stepApproval"), value: <TaskStatusBadge task={run.stepApprovalTask} /> } : undefined,
			run.task.reason !== undefined || run.task.waitingReason || run.progress
				? { id: "note", label: t("workflows.run.note"), value: <RunNote run={run} /> } : undefined,
		]} />
		<PageSection title={t("workflows.run.stepsTitle")}>
			<WorkflowRunTrace run={run} onOpen={onOpen} />
		</PageSection>
		<RunTechnicalDetails run={run} />
	</div>;
}

function AutomationRunHistory({
	resourceId,
	workspaceId,
	receipt,
}: {
	resourceId: string;
	workspaceId: string;
	receipt?: ActionSubmission;
}) {
	const client = useBffClient();
	const t = useT();
	const locale = useLocale();
	const reasonText = useReasonText();
	const [budget, setBudget] = useState(RUN_PAGES);
	const [open, setOpen] = useState<string | null>(null);
	const [selectedRunId, setSelectedRunId] = useState<string | null>(receipt?.actionExecutionId ?? null);
	// DD-168 §16.2(3): the history is cursor-paged without a total, so it is read to its end
	// (bounded) and paged locally. Every page passes the same validation as before; one page that
	// cannot be proven (association, enums, a repeated cursor, a receipt paired with another
	// operation) fails the whole read rather than showing a partial or substituted history.
	const [state, reload] = useLoad(
		`automation-runs:${workspaceId}:${resourceId}:${budget}`,
		async (): Promise<RunCollection> => {
			const runs: AutomationRunView[] = [];
			const cursors: (string | undefined)[] = [undefined];
			const seen = new Set<string>();
			for (let i = 0; i < budget; i++) {
				const value = await client.automationRuns(resourceId, cursors[cursors.length - 1]);
				if (!validAutomationRuns(value, resourceId, workspaceId, cursors)
					|| (receipt && value.runs.some((run) => run.task.actionExecutionId === receipt.actionExecutionId
						&& run.task.operationId !== receipt.operationId))
					|| value.runs.some((run) => seen.has(run.task.actionExecutionId)))
					throw new TransportError("Unprovable automation run history");
				for (const run of value.runs) { seen.add(run.task.actionExecutionId); runs.push(run); }
				if (value.nextCursor === undefined) return { runs, complete: true };
				cursors.push(value.nextCursor);
			}
			return { runs, complete: false };
		},
		{ keepWhileRevalidating: true },
	);
	const collection = state.status === "ok" ? state.data : null;
	// The collection shown when Refresh was pressed; the button spins until a newer answer arrives.
	const [stale, setStale] = useState<RunCollection | null>(null);
	const refreshing = stale !== null && collection === stale;
	const refresh = () => { setStale(collection); reload(); };
	const selected = collection && selectedRunId ? collection.runs.find((run) => run.task.actionExecutionId === selectedRunId) : undefined;
	const columns: DataColumn<AutomationRunView>[] = [
		{ key: "started", header: t("workflows.run.startedAt"), width: "11rem", sortValue: (run) => Date.parse(run.task.createdAt),
			cell: (run) => <time dateTime={run.task.createdAt} title={absoluteTime(locale, run.task.createdAt)}
				className="whitespace-nowrap font-medium text-foreground">{relativeTime(locale, run.task.createdAt)}</time> },
		{ key: "status", header: t("workflows.run.status"), width: "11rem", sortValue: (run) => t(taskPhase(run.task).label),
			cell: (run) => <TaskStatusBadge task={run.task} /> },
		{ key: "steps", header: t("workflows.run.stepsLabel"), width: "8rem", secondary: true, truncate: true,
			cell: (run) => {
				const summary = automationRunSummary(run);
				return summary.currentStep !== null ? t("workflows.run.currentStep", { step: summary.currentStep })
					: run.executionTrace ? t(summary.steps === 1 ? "workflows.run.step" : "workflows.run.steps", { count: summary.steps }) : null;
			} },
		{ key: "duration", header: t("workflows.run.duration"), width: "6rem", align: "end", secondary: true,
			cell: (run) => automationRunSummary(run).duration },
		{ key: "note", header: t("workflows.run.note"), truncate: true, cell: (run) => <RunNote run={run} /> },
	];

	return (
		<section
			className="flex flex-col gap-3 border-t pt-4"
			data-testid="workflow-runs"
		>
			{open ? (
				<TaskDetail
					key={open}
					actionExecutionId={open}
					onBack={() => setOpen(null)}
					onOpen={setOpen}
				/>
			) : (
				<>
					<header className="flex items-center justify-between gap-3">
						<h3 className="text-[1.0625rem] font-semibold leading-6 tracking-[-0.012em] text-foreground">{t("workflows.history")}</h3>
						<RefreshButton onClick={refresh} pending={refreshing || state.status === "pending"} />
					</header>
					{state.status === "pending" ? (
						<TableSkeleton rows={3} columns={4} />
					) : !collection ? (
						<ErrorState compact error={state.status === "error" ? state.error : undefined} onRetry={reload} />
					) : (
						<>
							{/* Buzz 779af8886caae1317b4de962082429867ab61503:
							    desktop/src/features/workflows/ui/WorkflowDetailPanel.tsx::WorkflowDetailPanel
							    retains the returned run reference until its authorized history arrives.
							    Admission is not execution completion; never invent a TaskView. */}
							{receipt && !collection.runs.some((run) => run.task.actionExecutionId === receipt.actionExecutionId) ? (
								<div className="flex flex-col gap-1.5 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm"
									data-testid="workflow-run-created" role="status">
									<p className="font-medium text-foreground">{t("workflows.run.recorded")}</p>
									<p className="text-muted-foreground">{t("tasks.status.delayed")}</p>
									<p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
										<span className="inline-flex items-center gap-1">{t("workflows.run.executionId")} <IdText value={receipt.actionExecutionId} /></span>
										<span className="inline-flex items-center gap-1">{t("workflows.run.operationId")} <IdText value={receipt.operationId} /></span>
									</p>
								</div>
							) : null}
							{selected ? <AutomationRunDetail run={selected} onBack={() => setSelectedRunId(null)} onOpen={setOpen} /> : null}
							<div hidden={selected !== undefined}>
								<DataTable testId="workflow-run-table" label={t("workflows.history")} rows={collection.runs} columns={columns}
									rowKey={(run) => run.task.actionExecutionId}
									onRowClick={(run) => setSelectedRunId(run.task.actionExecutionId)}
									search={{ placeholder: t("workflows.run.search"), text: (run) => [
										t(taskPhase(run.task).label),
										run.task.reason !== undefined ? reasonText(run.task.reason) : "",
										run.progress ?? "",
									].join(" ") }}
									empty={receipt ? null : <EmptyState compact icon={HistoryIcon} title={t("workflows.run.none")}
										description={t("workflows.run.noneHint")} />}
									partial={collection.complete ? undefined : <span className="inline-flex flex-wrap items-center gap-2">
										{t("list.partial", { count: String(collection.runs.length) })}
										<button type="button" className="font-medium text-brand-text hover:underline"
											onClick={() => setBudget((value) => value + RUN_PAGES)}>{t("list.loadMore")}</button>
									</span>} />
							</div>
						</>
					)}
				</>
			)}
		</section>
	);
}
