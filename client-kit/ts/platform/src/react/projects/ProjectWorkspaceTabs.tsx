// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectWorkspaceTabs.tsx::WorkspaceTabs.
// Original repository tab menu and panel structure. Tasks/Reviews always; Overview/Files/Commits and
// Contributors (DD-118) when the host offers Git reads; Channels when it offers the discussion
// search. The Tasks/Reviews headers carry the original Create task / Create review actions when the
// caller has the writer; Channels/Contributors keep their original section headers.
import { CircleDot, GitPullRequest, Hash, Users } from "lucide-react";
import type { ReactNode } from "react";
import { useUiT } from "../context";
import { Tabs, TabsContent } from "../profile/buzz/shared/ui/tabs";
import { ProjectTabsList } from "./ProjectWorkspaceTabList";
import { ProjectSectionHeader } from "./ProjectSectionHeader";
import { PROJECT_SECTION_HEADER_CLASS } from "./projectPanelStyles";

export type ProjectWorkspaceTab = "overview" | "files" | "activity" | "issues" | "prs" | "channels" | "contributors";

export function isProjectGitWorkspaceTab(tab: ProjectWorkspaceTab): tab is "overview" | "files" | "activity" {
  return tab === "overview" || tab === "files" || tab === "activity";
}

/** Tabs whose content reads the repository through the DD-118 Git seam. */
export function projectWorkspaceTabNeedsGit(tab: ProjectWorkspaceTab) {
  return isProjectGitWorkspaceTab(tab) || tab === "contributors";
}

export function WorkspaceTabs({ tab, onTabChange, onBack, onCreateTask, onCreatePullRequest, git = false, channels = false, detailSelected = false, sectionHeader, children }: {
  tab: ProjectWorkspaceTab;
  onTabChange: (tab: ProjectWorkspaceTab) => void;
  onBack: () => void;
  onCreateTask?: () => void;
  /** Original "Create review" header action (DD-118); absent without the review writer. */
  onCreatePullRequest?: () => void;
  /** The host offers DD-118 Git reads, so the original Git tabs exist. */
  git?: boolean;
  /** The host offers the discussion search, so the original Channels tab exists. */
  channels?: boolean;
  /** Original: a selected commit hides the tab menu. */
  detailSelected?: boolean;
  /** Section header of a Git tab (the original Files/Commits headers). */
  sectionHeader?: ReactNode;
  children: ReactNode;
}) {
  const t = useUiT();
  const gitTab = isProjectGitWorkspaceTab(tab);
  const header = gitTab ? sectionHeader
    : tab === "channels" ? <ProjectSectionHeader className={PROJECT_SECTION_HEADER_CLASS} icon={Hash} title={t("projects.workspace.channelsTab")}/>
    : tab === "contributors" ? <ProjectSectionHeader className={PROJECT_SECTION_HEADER_CLASS} icon={Users} title={t("projects.workspace.contributorsTab")}/>
    : <ProjectSectionHeader className={PROJECT_SECTION_HEADER_CLASS} icon={tab === "issues" ? CircleDot : GitPullRequest}
      title={t(tab === "issues" ? "projects.list.tasks" : "projects.list.reviews")}
      action={tab === "issues" && onCreateTask ? { label: t("projects.issue.create"), onClick: onCreateTask }
        : tab === "prs" && onCreatePullRequest ? { label: t("projects.review.create"), onClick: onCreatePullRequest, title: t("projects.review.createTitle") }
        : undefined}/>;
  return <Tabs className="flex min-w-0 flex-1 flex-col space-y-3" value={tab}
    onValueChange={value => {
      if (value === "issues" || value === "prs") onTabChange(value);
      else if (channels && value === "channels") onTabChange(value);
      else if (git && (value === "overview" || value === "files" || value === "activity" || value === "contributors")) onTabChange(value);
    }}>
    {!detailSelected ? <div className="sticky top-0 z-30 -mx-4 flex h-13 min-w-0 items-center gap-1 px-4 bg-background/80 backdrop-blur-md supports-backdrop-filter:bg-background/70 dark:bg-background/70 dark:backdrop-blur-xl dark:supports-backdrop-filter:bg-background/55"
      data-testid="project-workspace-tab-menu"><ProjectTabsList onBack={onBack} git={git} channels={channels}/></div> : null}
    <div className="-mx-4 flex flex-1 flex-col [&_[data-project-detail-panel]]:rounded-none [&_[data-project-detail-panel]]:border-0" data-testid="project-workspace-panel">
      {header}
      {gitTab ? <TabsContent className={tab === "files" ? "m-0" : "m-0 min-h-0 flex-1 flex-col data-[state=active]:flex"} value={tab}>
        {children}
      </TabsContent> : tab === "channels" || tab === "contributors" ? <TabsContent className="m-0" value={tab}>
        {children}
      </TabsContent> : <TabsContent className="m-0 overflow-hidden rounded-xl border border-border/60 bg-transparent" data-project-detail-panel value={tab}>
        {children}
      </TabsContent>}
    </div>
  </Tabs>;
}
