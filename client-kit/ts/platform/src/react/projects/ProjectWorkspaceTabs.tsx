// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectWorkspaceTabs.tsx::WorkspaceTabs.
// Original repository Tasks/Reviews list structure. Other tabs require missing consumers.
import { CircleDot, GitPullRequest } from "lucide-react";
import type { ReactNode } from "react";
import { useUiT } from "../context";
import { Tabs, TabsContent } from "../profile/buzz/shared/ui/tabs";
import { ProjectTabsList } from "./ProjectWorkspaceTabList";
import { ProjectSectionHeader } from "./ProjectSectionHeader";

export function WorkspaceTabs({ tab, onTabChange, onBack, onCreateTask, children }: {
  tab: "issues" | "prs";
  onTabChange: (tab: "issues" | "prs") => void;
  onBack: () => void;
  onCreateTask?: () => void;
  children: ReactNode;
}) {
  const t = useUiT();
  return <Tabs className="flex min-w-0 flex-1 flex-col space-y-3" value={tab}
    onValueChange={value => { if (value === "issues" || value === "prs") onTabChange(value); }}>
    <div className="sticky top-0 z-30 -mx-4 flex h-13 min-w-0 items-center gap-1 px-4 bg-background/80 backdrop-blur-md supports-backdrop-filter:bg-background/70 dark:bg-background/70 dark:backdrop-blur-xl dark:supports-backdrop-filter:bg-background/55"
      data-testid="project-workspace-tab-menu"><ProjectTabsList onBack={onBack}/></div>
    <div className="-mx-4 flex flex-1 flex-col [&_[data-project-detail-panel]]:rounded-none [&_[data-project-detail-panel]]:border-0" data-testid="project-workspace-panel">
      <ProjectSectionHeader className="mx-4 mb-2 rounded-md bg-muted/40" icon={tab === "issues" ? CircleDot : GitPullRequest}
        title={t(tab === "issues" ? "projects.list.tasks" : "projects.list.reviews")}
        action={tab === "issues" && onCreateTask ? { label: t("projects.issue.create"), onClick: onCreateTask } : undefined}/>
      <TabsContent className="m-0 overflow-hidden rounded-xl border border-border/60 bg-transparent" data-project-detail-panel value={tab}>
        {children}
      </TabsContent>
    </div>
  </Tabs>;
}
