// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectWorkspaceTabs.tsx::WorkspaceTabs.
// Original repository tab menu and panel structure. Tasks/Reviews always; Overview/Files/Commits
// (DD-118) when the host offers Git reads. Other tabs require missing consumers.
import { CircleDot, GitPullRequest } from "lucide-react";
import type { ReactNode } from "react";
import { useUiT } from "../context";
import { Tabs, TabsContent } from "../profile/buzz/shared/ui/tabs";
import { ProjectTabsList } from "./ProjectWorkspaceTabList";
import { ProjectSectionHeader } from "./ProjectSectionHeader";

export type ProjectWorkspaceTab = "overview" | "files" | "activity" | "issues" | "prs";

export function isProjectGitWorkspaceTab(tab: ProjectWorkspaceTab): tab is "overview" | "files" | "activity" {
  return tab === "overview" || tab === "files" || tab === "activity";
}

export function WorkspaceTabs({ tab, onTabChange, onBack, onCreateTask, git = false, detailSelected = false, sectionHeader, children }: {
  tab: ProjectWorkspaceTab;
  onTabChange: (tab: ProjectWorkspaceTab) => void;
  onBack: () => void;
  onCreateTask?: () => void;
  /** The host offers DD-118 Git reads, so the original Git tabs exist. */
  git?: boolean;
  /** Original: a selected commit hides the tab menu. */
  detailSelected?: boolean;
  /** Section header of a Git tab (the original Files/Commits headers). */
  sectionHeader?: ReactNode;
  children: ReactNode;
}) {
  const t = useUiT();
  const gitTab = isProjectGitWorkspaceTab(tab);
  return <Tabs className="flex min-w-0 flex-1 flex-col space-y-3" value={tab}
    onValueChange={value => {
      if (value === "issues" || value === "prs") onTabChange(value);
      else if (git && (value === "overview" || value === "files" || value === "activity")) onTabChange(value);
    }}>
    {!detailSelected ? <div className="sticky top-0 z-30 -mx-4 flex h-13 min-w-0 items-center gap-1 px-4 bg-background/80 backdrop-blur-md supports-backdrop-filter:bg-background/70 dark:bg-background/70 dark:backdrop-blur-xl dark:supports-backdrop-filter:bg-background/55"
      data-testid="project-workspace-tab-menu"><ProjectTabsList onBack={onBack} git={git}/></div> : null}
    <div className="-mx-4 flex flex-1 flex-col [&_[data-project-detail-panel]]:rounded-none [&_[data-project-detail-panel]]:border-0" data-testid="project-workspace-panel">
      {gitTab ? sectionHeader : <ProjectSectionHeader className="mx-4 mb-2 rounded-md bg-muted/40" icon={tab === "issues" ? CircleDot : GitPullRequest}
        title={t(tab === "issues" ? "projects.list.tasks" : "projects.list.reviews")}
        action={tab === "issues" && onCreateTask ? { label: t("projects.issue.create"), onClick: onCreateTask } : undefined}/>}
      {gitTab ? <TabsContent className={tab === "files" ? "m-0" : "m-0 min-h-0 flex-1 flex-col data-[state=active]:flex"} value={tab}>
        {children}
      </TabsContent> : <TabsContent className="m-0 overflow-hidden rounded-xl border border-border/60 bg-transparent" data-project-detail-panel value={tab}>
        {children}
      </TabsContent>}
    </div>
  </Tabs>;
}
