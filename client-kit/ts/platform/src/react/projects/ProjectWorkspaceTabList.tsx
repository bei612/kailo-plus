// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectWorkspaceTabList.tsx.
// Overview/Files/Commits appear only when the host offers DD-118 Git reads; Tasks/Reviews always.
// Channels and Contributors consumers are not restored and their tabs remain absent.
import { ArrowLeft } from "lucide-react";
import { useUiT } from "../context";
import { TabsList, TabsTrigger } from "../profile/buzz/shared/ui/tabs";

export const PROJECT_TAB_TRIGGER_CLASS =
  "h-7 shrink-0 rounded-full bg-muted/30 px-3 text-xs font-medium leading-5 tracking-tight text-muted-foreground shadow-none transition-colors hover:bg-muted/55 hover:text-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none";
const PROJECT_TAB_ICON_BUTTON_CLASS =
  "h-7 w-7 shrink-0 rounded-full bg-muted/30 p-1.5 text-muted-foreground shadow-none transition-colors hover:bg-muted/55 hover:text-foreground";

export function ProjectTabsList({ onBack, git = false }: { onBack: () => void; git?: boolean }) {
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
      <TabsTrigger className={PROJECT_TAB_TRIGGER_CLASS} value="prs"><span>{t("projects.workspace.reviewTab")}</span></TabsTrigger>
    </TabsList>
  </div>;
}
