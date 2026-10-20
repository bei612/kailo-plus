// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectRepositoryActionsPanel.tsx.
// Selected Task/Review branches (ProjectRepositoryActionsPanel) and the repository branch-scoped /
// repository-scoped context card (ProjectRepositoryContextPanel): repository management, the branch
// picker, Fetch, Create task / Create review and the original Details rows. The local source toggle,
// Clone/Pull/Push, Open folder and Terminal are Desktop-local checkout actions, and selection-to-Agent
// is the project Agent chat; none has a governed consumer here and none is rendered as an empty control.
import type { ComponentProps,ReactNode } from "react";
import { CheckCircle2, CircleDot, FileCode2, GitCommitHorizontal, GitMerge, GitPullRequest, Loader2, Plus, RefreshCw, Users } from "lucide-react";
import { useUiT } from "../context";
import { RightAuxiliaryPane } from "../messages/thread/RightAuxiliaryPane";
import { Button } from "../profile/buzz/shared/ui/button";
import { PROJECT_CONTEXT_ACTION_BUTTON_CLASS } from "./projectContextActionStyles";
import { ProjectWorkItemContextDetails, type ProjectWorkItemContext } from "./ProjectWorkItemContextDetails";
import type { ProjectsHost } from "./projectEnumeration";
import type { ProjectRepoSnapshot } from "./projectGit";
import type { ProjectIssue } from "./projectIssues.mjs";
import type { Project, Repository } from "./projectModels";
import type { ProjectPullRequest } from "./projectPullRequests.mjs";
import { projectReviewActivity, projectRightPanelScope, projectTaskActivity } from "./projectRightPanelContext";
import { ProjectRepositoryManagement } from "./ProjectRepositoryManagement";
import { RepositoryBranchDropdown, type RepoBranchHeaderControls } from "./ProjectRepositorySource";
import type { RepositoryFetchControls } from "./ProjectRepositoryGitTabs";

type PaneProps = Pick<ComponentProps<typeof RightAuxiliaryPane>,"widthPx"|"onResizeStart"|"canResetWidth"|"onResetWidth">;
export type ProjectRepositoryActionsPanelProps=ProjectWorkItemContext&{
  actions:ReactNode;onCreateTask?:()=>void;
}&PaneProps;
export function ProjectRepositoryActionsPanel({issue,pullRequest,repository,actions,onCreateTask,...pane}:ProjectRepositoryActionsPanelProps){
  const t=useUiT();
  return <RightAuxiliaryPane {...pane} detached constrainToAvailableSpace={false} testId="project-repository-actions-panel">
    <div className="relative z-30 min-h-0 flex-1 overflow-y-auto">
      <div className="rounded-2xl bg-background" data-testid="project-context-card">
        <div className="flex min-w-0 items-center justify-between gap-2 px-4 pt-3">
          <h2 className="min-w-0 truncate text-sm font-normal text-muted-foreground/70">{issue?issue.title:pullRequest.title}</h2>
        </div>
        <div className="space-y-0.5 px-4 pb-3 pt-2">
          <section className="space-y-0.5" data-testid="project-context-actions">
            {actions}
            {onCreateTask?<Button className={PROJECT_CONTEXT_ACTION_BUTTON_CLASS} onClick={onCreateTask} size="sm" type="button" variant="ghost">
              <Plus className="h-3.5 w-3.5"/>{t("projects.issue.create")}
            </Button>:null}
          </section>
          <section className="!mt-2 space-y-0.5 pt-2" data-testid="project-context-details">
            <h3 className="flex h-7 min-w-0 items-center truncate text-sm font-normal text-muted-foreground/70">{t("projects.context.details")}</h3>
            <dl className="text-sm [&>div]:h-7 [&_dd]:ml-auto [&_dd]:tabular-nums [&_dt]:gap-3 [&_dt]:text-foreground [&_dt_svg]:h-4 [&_dt_svg]:w-4 [&_dt_svg]:shrink-0 [&_dt_svg]:text-muted-foreground">
              {issue?<ProjectWorkItemContextDetails issue={issue}/>:<ProjectWorkItemContextDetails pullRequest={pullRequest} repository={repository}/>}
            </dl>
          </section>
        </div>
      </div>
    </div>
  </RightAuxiliaryPane>;
}

const DETAILS_LIST_CLASS = "text-sm [&>div]:h-7 [&_dd]:ml-auto [&_dd]:tabular-nums [&_dt]:gap-3 [&_dt]:text-foreground [&_dt_svg]:h-4 [&_dt_svg]:w-4 [&_dt_svg]:shrink-0 [&_dt_svg]:text-muted-foreground";

function DetailRow({ count, icon: Icon, label, testId }: { count: ReactNode; icon: typeof CircleDot; label: string; testId?: string }) {
  return <div className="flex items-center justify-between gap-3">
    <dt className="flex items-center gap-3 text-muted-foreground"><Icon className="h-3.5 w-3.5"/>{label}</dt>
    <dd className="font-medium text-foreground" data-testid={testId}>{count}</dd>
  </div>;
}

/** Original ProjectRepositoryActionsPanel without a selected item: the repository context card. */
export function ProjectRepositoryContextPanel({ activeTab, fetch, host, identityPubkey, issues, onCreatePullRequest, onCreateTask,
  onRepositoryChange, project, projects, pullRequests, repository, snapshot, sourceControls, ...pane }: {
  activeTab: string;
  fetch?: RepositoryFetchControls;
  host: ProjectsHost;
  identityPubkey?: string;
  issues: ProjectIssue[];
  onCreatePullRequest?: () => void;
  onCreateTask?: () => void;
  onRepositoryChange: (repositoryId: string) => void;
  project: Project;
  projects: Project[];
  pullRequests: ProjectPullRequest[];
  repository: Repository;
  snapshot: ProjectRepoSnapshot | null | undefined;
  sourceControls?: RepoBranchHeaderControls;
} & PaneProps) {
  const t = useUiT();
  const branchScoped = projectRightPanelScope(activeTab) === "branch";
  const taskActivity = projectTaskActivity(issues);
  const reviewActivity = projectReviewActivity(pullRequests);
  const latestCommit = snapshot?.latestCommit ?? null;
  const fetchAction = branchScoped ? fetch : undefined;
  const showCreateTask = activeTab === "issues" && Boolean(onCreateTask);
  const showCreateReview = activeTab === "prs" && Boolean(onCreatePullRequest);
  const showActions = (branchScoped && Boolean(sourceControls || fetchAction)) || showCreateTask || showCreateReview;
  return <RightAuxiliaryPane {...pane} detached constrainToAvailableSpace={false} testId="project-repository-actions-panel">
    <div className="relative z-30 min-h-0 flex-1 overflow-y-auto">
      <div className="rounded-2xl bg-background" data-testid="project-context-card">
        <div className="flex min-w-0 items-center justify-between gap-2 px-4 pt-3">
          <h2 className="min-w-0 truncate text-sm font-normal text-muted-foreground/70">{repository.name}</h2>
          {branchScoped ? <div className="flex shrink-0 items-center" data-testid="project-repository-management-actions">
            <ProjectRepositoryManagement compact host={host} identityPubkey={identityPubkey} onChange={onRepositoryChange}
              project={project} projects={projects} repository={repository}/>
          </div> : null}
        </div>
        <div className="space-y-0.5 px-4 pb-3 pt-2">
          {showActions ? <section className="space-y-0.5" data-testid="project-context-actions">
            {branchScoped && sourceControls ? <div
              className="grid gap-0.5 [&_button]:-mx-2 [&_button]:h-7 [&_button]:w-[calc(100%+1rem)] [&_button]:max-w-none [&_button]:justify-start [&_button]:gap-3 [&_button]:rounded-md [&_button]:border-0 [&_button]:bg-transparent [&_button]:px-2 [&_button]:text-left [&_button]:text-sm [&_button]:font-normal [&_button]:shadow-none [&_button]:hover:bg-muted/70 [&_button>svg:last-child]:ml-auto"
              data-testid="project-context-source-controls">
              <RepositoryBranchDropdown {...sourceControls}/>
            </div> : null}
            {fetchAction ? <div className="grid gap-0.5" data-testid="project-context-repository-actions">
              <Button className={PROJECT_CONTEXT_ACTION_BUTTON_CLASS} disabled={fetchAction.fetchPending} onClick={fetchAction.onFetch}
                size="sm" title={t("projects.repository.fetchTitle")} type="button" variant="ghost">
                {fetchAction.fetchPending ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : <RefreshCw className="h-3.5 w-3.5"/>}
                {t("projects.repository.fetch")}
              </Button>
            </div> : null}
            {showCreateTask && onCreateTask ? <Button className={PROJECT_CONTEXT_ACTION_BUTTON_CLASS} onClick={onCreateTask} size="sm" type="button" variant="ghost">
              <Plus className="h-3.5 w-3.5"/>{t("projects.issue.create")}
            </Button> : null}
            {showCreateReview && onCreatePullRequest ? <Button className={PROJECT_CONTEXT_ACTION_BUTTON_CLASS} onClick={onCreatePullRequest} size="sm"
              title={t("projects.review.createTitle")} type="button" variant="ghost">
              <Plus className="h-3.5 w-3.5"/>{t("projects.review.create")}
            </Button> : null}
          </section> : null}
          <section className={showActions ? "!mt-2 space-y-0.5 pt-2" : "space-y-0.5"} data-testid="project-context-details">
            <h3 className="flex h-7 min-w-0 items-center truncate text-sm font-normal text-muted-foreground/70">{t("projects.context.details")}</h3>
            {branchScoped ? <dl className={DETAILS_LIST_CLASS}>
              <DetailRow icon={GitCommitHorizontal} label={t("projects.context.latest")}
                count={<span className="font-mono text-xs text-foreground">{latestCommit ? latestCommit.hash.slice(0, 7) : "—"}</span>}/>
              <DetailRow icon={FileCode2} label={t("projects.git.files")} count={snapshot ? snapshot.files.length : "—"} testId="project-repository-file-count"/>
              <DetailRow icon={Users} label={t("projects.workspace.contributorsTab")} count={snapshot ? snapshot.contributors.length : "—"}/>
            </dl> : <dl className={DETAILS_LIST_CLASS}>
              {activeTab !== "prs" ? <>
                <DetailRow icon={CircleDot} label={t(activeTab === "issues" ? "projects.list.tasks" : "projects.overview.activeTasks")}
                  count={activeTab === "issues" ? taskActivity.total : taskActivity.active}/>
                {activeTab === "issues" ? <>
                  <DetailRow icon={CircleDot} label={t("projects.overview.active")} count={taskActivity.active}/>
                  <DetailRow icon={CheckCircle2} label={t("projects.overview.completed")} count={taskActivity.completed}/>
                </> : null}
              </> : null}
              {activeTab !== "issues" ? <>
                <DetailRow icon={GitPullRequest} label={t(activeTab === "prs" ? "projects.list.reviews" : "projects.overview.openReviews")}
                  count={activeTab === "prs" ? reviewActivity.total : reviewActivity.open}/>
                {activeTab === "prs" ? <>
                  <DetailRow icon={GitPullRequest} label={t("projects.status.open")} count={reviewActivity.open}/>
                  <DetailRow icon={GitMerge} label={t("projects.status.merged")} count={reviewActivity.merged}/>
                </> : null}
              </> : null}
            </dl>}
          </section>
        </div>
      </div>
    </div>
  </RightAuxiliaryPane>;
}
