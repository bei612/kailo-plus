// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectAgentContextStrip.tsx.
import { X } from "lucide-react";

import { useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import type { ProjectDetailAgentContext } from "./lib/projectDetailAgentContext";

// Original projectPanelStyles.ts::PROJECT_COLUMN_HEADER_BACKDROP_CLASS.
const PROJECT_COLUMN_HEADER_BACKDROP_CLASS =
  "bg-background/80 backdrop-blur-md supports-backdrop-filter:bg-background/70 dark:bg-background/70 dark:backdrop-blur-xl dark:supports-backdrop-filter:bg-background/55";

function contextLabel(context: ProjectDetailAgentContext, selectionLabel: string) {
  if (context.selection?.length) return selectionLabel;
  if (context.workItem) return context.workItem.title;
  if (context.file?.path) return context.file.path.split("/").filter(Boolean).at(-1) ?? context.view;
  return context.view;
}

export function ProjectAgentContextStrip({
  context,
  onClose,
  sharedBackdrop = false,
}: {
  context: ProjectDetailAgentContext;
  onClose?: () => void;
  sharedBackdrop?: boolean;
}) {
  const t = useUiT();
  const label = contextLabel(context, t("projects.agentChat.selectionLabel"));

  return (
    <div
      className={`absolute inset-x-0 top-0 z-30 flex h-13 shrink-0 items-center px-4 ${
        sharedBackdrop ? "" : PROJECT_COLUMN_HEADER_BACKDROP_CLASS
      }`}
      data-testid="project-agent-context"
      title={label}
    >
      <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{label}</p>
      {onClose ? (
        <Button
          aria-label={t("projects.agentChat.close")}
          className="h-7 w-7 shrink-0"
          onClick={onClose}
          size="icon"
          title={t("projects.agentChat.close")}
          type="button"
          variant="ghost"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  );
}
