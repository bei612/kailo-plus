// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/projects/ui/ProjectChannelRequestDialog.tsx::{ProjectChannelRequestDetails,
// ProjectChannelRequestDialog} and useProjectChannelRequests.ts (queue one request at a time,
// accept only the viewer's own project home channels — classifyAgentManagementOrigin).
// DD-140: the source is the viewer's pending approvals carrying a frozen project channel request
// (Agent tool proposal bound to workspace.create, initiator = Installation owner). Cancel is the
// existing DENY decision, Create channel the existing APPROVE decision; once the approved
// workspace.create completes, the new channel joins the project through the existing owner project
// publication (useProjectChannelLinking, the original useAddProjectChannelMutation order).
import * as React from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActionDispatchState, ActionGateState, ApprovalDecision, ApprovalStatus,
  type ActionSubmission, type ApprovalView, type ProjectChannelRequest,
} from "@client-kit/contracts";
import { isOutcomeUnknown } from "../../transport";
import { useBffClient, useFailureText, useUiT } from "../context";
import { formatTtlDuration } from "../channel-type-settings";
import { Button } from "../profile/buzz/shared/ui/button";
import { cn } from "../profile/buzz/shared/lib/cn";
import { MODAL_BACKDROP_BLUR_CLASS } from "../composer/shared/ui/modalBackdrop";
import { MODAL_CONTENT_MOTION_CLASS, MODAL_OVERLAY_MOTION_CLASS } from "../composer/shared/ui/modalMotion";
import { loadProjectDirectory, type ProjectsHost } from "./projectEnumeration";
import type { Project } from "./projectModels";
import { useProjectChannelLinking } from "./ProjectChannelManagement";

/** Details an owner reviews before approving an agent-requested project channel. */
export function ProjectChannelRequestDetails({ request }: { request: ProjectChannelRequest }) {
  const t = useUiT();
  const row = (label: string, value: React.ReactNode) => <div className="flex gap-3">
    <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words text-foreground">{value}</dd>
  </div>;
  return <dl className="space-y-2 rounded-xl border border-border/60 bg-muted/25 p-3 text-sm">
    {row(t("projects.channelRequest.name"), `#${request.name}`)}
    {request.description ? row(t("projects.channelRequest.description"), request.description) : null}
    {row(t("projects.channelRequest.visibility"), t(request.visibility === "open" ? "projects.channelRequest.open" : "projects.channelRequest.private"))}
    {request.ttlSeconds ? row(t("projects.channelRequest.lifetime"), t("projects.channelRequest.temporary", { duration: formatTtlDuration(request.ttlSeconds) })) : null}
    {request.templateName ? row(t("projects.channelRequest.template"), request.templateName) : null}
  </dl>;
}

type PendingRequest = { approval: ApprovalView; request: ProjectChannelRequest; project: Project };
const isPending = (approval: ApprovalView) =>
  (approval.status === ApprovalStatus.Requested || approval.status === ApprovalStatus.Waiting)
  && new Date(approval.expiresAt) > new Date();

/** Original useProjectChannelRequests over the viewer's pending DD-140 approvals. */
export function useProjectChannelRequests(host: ProjectsHost) {
  const client = useBffClient();
  const query = useQuery({
    queryKey: ["platform", "project-channel-requests", host.scopeKey],
    refetchOnWindowFocus: "always", retry: false,
    queryFn: async ({ signal }): Promise<PendingRequest[]> => {
      const approvals = (await client.pendingApprovals()).filter(approval => approval.projectChannelRequest && isPending(approval));
      if (approvals.length === 0) return [];
      // Original classifyAgentManagementOrigin: only a home channel of one of the viewer's own projects.
      const directory = await loadProjectDirectory(host, signal);
      return approvals.flatMap(approval => {
        const request = approval.projectChannelRequest!.request;
        const project = directory.projects.find(candidate => candidate.owner.toLowerCase() === directory.viewerPubkey
          && (candidate.channelId === request.homeChannelId || candidate.relatedChannelIds.includes(request.homeChannelId)));
        return project ? [{ approval, request, project }] : [];
      });
    },
  });
  return query;
}

/** Global owner-review surface for project-channel requests from managed agents. */
export function ProjectChannelRequestDialog({ host }: { host: ProjectsHost }) {
  const t = useUiT();
  const client = useBffClient();
  const failureText = useFailureText();
  const cache = useQueryClient();
  const requests = useProjectChannelRequests(host);
  const [dismissed, setDismissed] = React.useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Approved requests keep their link runner mounted until this host unmounts; an interrupted link
  // resumes from the same retained creation slot when the project's channel management mounts.
  const [approved, setApproved] = React.useState<readonly { project: Project; submission: ActionSubmission; name: string }[]>([]);
  const current = (requests.data ?? []).find(item => !dismissed.has(item.approval.workflowId)) ?? null;
  const settle = (workflowId: string) => {
    setDismissed(previous => new Set(previous).add(workflowId));
    setError(null);
    void cache.invalidateQueries({ queryKey: ["platform", "project-channel-requests", host.scopeKey] });
    void cache.invalidateQueries({ queryKey: ["platform", "inbox-needs-action"] });
  };
  const decide = async (decision: ApprovalDecision) => {
    if (!current || busy) return;
    setBusy(true); setError(null);
    try {
      await client.decide(current.approval.workflowId, decision);
      if (decision === ApprovalDecision.Approve) {
        const task = await client.task(current.approval.actionExecutionId);
        setApproved(previous => [...previous, { project: current.project, name: current.request.name, submission: {
          actionExecutionId: task.actionExecutionId, actionKey: task.actionKey, operationId: task.operationId,
          gateState: ActionGateState.Allowed, dispatchState: task.dispatchState ?? ActionDispatchState.NotDispatched,
          approvalWorkflowId: current.approval.workflowId } }]);
      }
      settle(current.approval.workflowId);
    } catch (cause) {
      // An unknown decision outcome keeps the request open: the same decision is resent as is.
      setError(isOutcomeUnknown(cause) ? t("projects.channelRequest.unknown") : failureText(cause));
    } finally { setBusy(false); }
  };
  return <>
    {approved.map(item => <ApprovedProjectChannelLink key={item.submission.actionExecutionId} host={host} {...item} />)}
    <AlertDialog.Root open={current !== null} onOpenChange={open => { if (!open && !busy) void decide(ApprovalDecision.Deny); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={cn("fixed inset-0 z-50 bg-black/60", MODAL_OVERLAY_MOTION_CLASS, MODAL_BACKDROP_BLUR_CLASS)} />
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
          <AlertDialog.Content data-testid="project-channel-request-dialog"
            className={cn("pointer-events-auto grid w-[calc(100vw-2rem)] max-w-md gap-4 outline-hidden rounded-3xl bg-background p-6 shadow-2xl", MODAL_CONTENT_MOTION_CLASS)}>
            <div className="flex flex-col space-y-2 text-left">
              <AlertDialog.Title className="text-xl font-semibold tracking-tight">{t("projects.channelRequest.title")}</AlertDialog.Title>
              <AlertDialog.Description className="text-sm text-muted-foreground">
                {t("projects.channelRequest.description.text", { project: current?.project.name ?? t("projects.channelRequest.thisProject") })}
              </AlertDialog.Description>
            </div>
            {current ? <ProjectChannelRequestDetails request={current.request} /> : null}
            {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialog.Cancel asChild><Button disabled={busy} type="button" variant="outline">{t("projects.channelRequest.cancel")}</Button></AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button data-testid="project-channel-request-approve" disabled={busy} type="button"
                  onClick={event => { event.preventDefault(); void decide(ApprovalDecision.Approve); }}>
                  {t(busy ? "projects.channelRequest.creating" : "projects.channelRequest.create")}
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  </>;
}

/** After APPROVE: the existing create→link runner (waits for the governed workspace.create task). */
function ApprovedProjectChannelLink({ host, project, submission, name }: {
  host: ProjectsHost; project: Project; submission: ActionSubmission; name: string;
}) {
  const linking = useProjectChannelLinking(host, project);
  const recorded = React.useRef(false);
  React.useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    linking.record(submission, name);
  }, [linking, name, submission]);
  return null;
}
