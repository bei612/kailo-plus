// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectWorkspaceTabList.tsx.
// Same order and pills: Overview/Files/Commits and Contributors read the repository through DD-118
// and appear only when the host offers Git reads; Channels appears when the host offers the
// discussion search it lists; Tasks/Review always.
import { ArrowLeft } from "lucide-react";
import { useUiT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import { TabsList, TabsTrigger } from "../profile/buzz/shared/ui/tabs";

export const PROJECT_TAB_TRIGGER_CLASS =
  "h-7 shrink-0 rounded-full bg-muted/30 px-3 text-xs font-medium leading-5 tracking-tight text-muted-foreground shadow-none transition-colors hover:bg-muted/55 hover:text-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none";

export const PROJECT_TAB_SELECTED_CLASS = "bg-muted text-foreground";
const PROJECT_TAB_ICON_BUTTON_CLASS =
  "h-7 w-7 shrink-0 rounded-full bg-muted/30 p-1.5 text-muted-foreground shadow-none transition-colors hover:bg-muted/55 hover:text-foreground";

export function ProjectTabsList({ onBack, git = false, channels = false, prsActive }: {
  onBack: () => void;
  git?: boolean;
  channels?: boolean;
  prsActive?: boolean;
}) {
  const t = useUiT();
  return <div className="flex h-full min-w-0 max-w-full flex-none items-center gap-1.5 overflow-x-auto scrollbar-none">
    <button aria-label={t("platform.back")} className={PROJECT_TAB_ICON_BUTTON_CLASS}
      data-testid="project-workspace-back" onClick={onBack} title={t("platform.back")} type="button">
      <ArrowLeft className="h-full w-full" strokeWidth={2}/>
    </button>
    <TabsList className="h-full min-w-0 max-w-full flex-none justify-start gap-1.5 overflow-x-auto bg-transparent p-0 scrollbar-none">
      {git ? <>
        <TabsTrigger className={PROJECT_TAB_TRIGGER_CLASS} value="overview"><span>{t("projects.home.overview")}</span></TabsTrigger>
        <TabsTrigger className={PROJECT_TAB_TRIGGER_CLASS} value="files"><span>{t("projects.git.files")}</span></TabsTrigger>
        <TabsTrigger className={PROJECT_TAB_TRIGGER_CLASS} value="activity"><span>{t("projects.workItem.commits")}</span></TabsTrigger>
      </> : null}
      <TabsTrigger className={PROJECT_TAB_TRIGGER_CLASS} value="issues"><span>{t("projects.list.tasks")}</span></TabsTrigger>
      <TabsTrigger aria-current={prsActive ? "page" : undefined}
        className={cn(PROJECT_TAB_TRIGGER_CLASS, prsActive && PROJECT_TAB_SELECTED_CLASS)} value="prs">
        <span>{t("projects.workspace.reviewTab")}</span>
      </TabsTrigger>
      {channels ? <TabsTrigger className={PROJECT_TAB_TRIGGER_CLASS} value="channels"><span>{t("projects.workspace.channelsTab")}</span></TabsTrigger> : null}
      {git ? <TabsTrigger className={PROJECT_TAB_TRIGGER_CLASS} value="contributors"><span>{t("projects.workspace.contributorsTab")}</span></TabsTrigger> : null}
    </TabsList>
  </div>;
}
