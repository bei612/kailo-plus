// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectsSelectionCountMenu.tsx::ProjectsSelectionCountMenu: the
// context pod for the current Projects selection — summary, Chat with an agent (DD-130 chat with
// the selection as context), Discuss in a channel (the existing governed draft handoff), Create
// review(s) for commits (the existing create-review dialog), Copy link(s) and Clear selection.
// Actions appear only when the host supplies their existing consumer.
import {
  Bot, CircleDot, FolderGit2, Folders, GitCommitHorizontal, GitPullRequest, Hash, Link2, ListChecks, X,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useUiT } from "../context";
import { useOptionalPulseHost } from "../pulse/host";
import { Button } from "../profile/buzz/shared/ui/button";
import {
  projectSelectionShareLinks,
  type ProjectSelectionAction, type ProjectSelectionItem, type ProjectSelectionPresentation,
} from "./lib/projectSelection";
import { useProjectSelection } from "./lib/useProjectSelection";
import { ProjectSelectionDiscussAction } from "./ProjectSelectionDiscussAction";
import { useProjectDiscussInChannel, type ProjectDiscussInChannel } from "./useProjectDiscussInChannel";

const ACTION_CLASS =
  "-mx-2 h-7 w-[calc(100%+1rem)] justify-start gap-3 rounded-md px-2 text-left text-sm font-normal hover:bg-muted/70 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

function selectionActionIcon(id: ProjectSelectionAction["id"]) {
  if (id === "chat-agent") return Bot;
  if (id === "create-review") return GitPullRequest;
  return Link2;
}

function selectionKindIcon(kind: ProjectSelectionItem["kind"] | undefined) {
  if (kind === "channel") return Hash;
  if (kind === "commit") return GitCommitHorizontal;
  if (kind === "project") return Folders;
  if (kind === "repository") return FolderGit2;
  if (kind === "review") return GitPullRequest;
  if (kind === "task") return CircleDot;
  return ListChecks;
}

export function ProjectsSelectionCountMenu({ onChatWithAgent, onCreatePullRequest, onDiscussInChannel, presentation, scopeKey, selectionItems }: {
  onChatWithAgent?: (items: ProjectSelectionItem[]) => void;
  onCreatePullRequest?: () => void;
  onDiscussInChannel?: ProjectDiscussInChannel;
  presentation: ProjectSelectionPresentation;
  scopeKey: string;
  selectionItems: ProjectSelectionItem[];
}) {
  const t = useUiT();
  const selection = useProjectSelection();
  const host = useOptionalPulseHost();
  const SelectionIcon = selectionKindIcon(presentation.kind);
  const noun = t(`projects.selection.noun.${presentation.kind}.${presentation.count === 1 ? "one" : "other"}`);
  const handleAction = (actionId: ProjectSelectionAction["id"]) => {
    if (actionId === "chat-agent") {
      onChatWithAgent?.(selectionItems);
      selection?.clear();
      return;
    }
    if (actionId === "copy") {
      const links = projectSelectionShareLinks(selectionItems);
      if (links.length === 0 || !host) return;
      void host.copy(links.join("\n")).then(
        () => toast.success(t(links.length === 1 ? "buzz.copiedLink" : "projects.selection.linksCopied")),
        () => toast.error(t("buzz.copyFailed")));
      return;
    }
    if (actionId === "create-review") onCreatePullRequest?.();
  };
  const available = (action: ProjectSelectionAction) => action.id === "chat-agent" ? Boolean(onChatWithAgent)
    : action.id === "create-review" ? Boolean(onCreatePullRequest)
    : action.id === "discuss" ? Boolean(onDiscussInChannel)
    : Boolean(host);
  return (
    <div className="w-full" data-testid="projects-selection-actions">
      <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/60 bg-muted/35 px-2.5 py-1.5"
        data-testid="projects-selection-summary">
        <SelectionIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" data-testid={`projects-selection-kind-${presentation.kind}`} />
        <h2 className="truncate text-sm font-medium text-foreground" data-testid="projects-overview-context-title">
          {t("projects.selection.title", { count: presentation.count, noun })}
        </h2>
      </div>
      <div className="space-y-2.5 pt-3">
        {presentation.actions.filter(available).map((action) => {
          if (action.id === "discuss") {
            return <SelectionDiscuss items={selectionItems} key={action.id} onDiscuss={onDiscussInChannel!} scopeKey={scopeKey}
              onDiscussed={() => selection?.clear()} />;
          }
          const Icon = selectionActionIcon(action.id);
          return (
            <Button className={ACTION_CLASS} data-testid={action.testId} key={action.id} onClick={() => handleAction(action.id)}
              size="sm" type="button" variant="ghost">
              <Icon className="h-3.5 w-3.5" />
              {t(action.labelKey)}
            </Button>
          );
        })}
        <Button className={ACTION_CLASS} data-testid="projects-selection-clear" onClick={() => selection?.clear()} size="sm" type="button" variant="ghost">
          <X className="h-3.5 w-3.5" />
          {t("projects.selection.clear")}
        </Button>
      </div>
    </div>
  );
}

function SelectionDiscuss({ items, onDiscuss, scopeKey, onDiscussed }: {
  items: ProjectSelectionItem[]; onDiscuss: ProjectDiscussInChannel; scopeKey: string; onDiscussed: () => void;
}) {
  const discussInChannel = useProjectDiscussInChannel(items, onDiscuss);
  const discussAndClear = React.useCallback(async (...args: Parameters<typeof discussInChannel>) => {
    await discussInChannel(...args);
    onDiscussed();
  }, [discussInChannel, onDiscussed]);
  return <ProjectSelectionDiscussAction items={items} onSelectChannel={discussAndClear} scopeKey={scopeKey} />;
}
