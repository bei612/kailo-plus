// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectAgentSelectionComposerBanner.tsx.
import { ChevronDown } from "lucide-react";
import * as React from "react";

import { useUiT } from "../context";
import type { PlatformMessageKey } from "../../i18n";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../sidebar/dropdown-menu";
import type { ProjectDetailAgentContext } from "./lib/projectDetailAgentContext";

type SelectionItem = NonNullable<ProjectDetailAgentContext["selection"]>[number];

const MAX_VISIBLE_ITEMS = 4;

const KIND_KEYS: Record<SelectionItem["kind"], PlatformMessageKey> = {
  channel: "projects.selection.kind.channel",
  commit: "projects.selection.kind.commit",
  project: "projects.selection.kind.project",
  repository: "projects.selection.kind.repository",
  review: "projects.selection.kind.review",
  task: "projects.selection.kind.task",
};

function SelectionItemRow({ item, overflow = false }: { item: SelectionItem; overflow?: boolean }) {
  const t = useUiT();
  return (
    <div
      className="flex min-w-0 items-baseline gap-2 text-xs"
      data-testid={overflow ? "projects-agent-selection-overflow-item" : "projects-agent-selection-item"}
    >
      <span className="shrink-0 text-muted-foreground">{t(KIND_KEYS[item.kind])}</span>
      <span className="min-w-0 truncate text-foreground" title={item.title}>{item.title}</span>
    </div>
  );
}

export function ProjectAgentSelectionComposerBanner({
  items,
}: {
  items: NonNullable<ProjectDetailAgentContext["selection"]>;
}) {
  const t = useUiT();
  const [expanded, setExpanded] = React.useState(true);
  const visibleItems = items.slice(0, MAX_VISIBLE_ITEMS);
  const overflowItems = items.slice(MAX_VISIBLE_ITEMS);
  const summary = items.length === 1
    ? t("projects.agentChat.selectedOne")
    : t("projects.agentChat.selectedMany", { count: items.length });

  return (
    <div className="px-3" data-testid="projects-agent-selection-context">
      <section className="relative z-0 -mb-4 rounded-t-2xl border border-b-0 border-border/60 bg-muted/55 px-3 pb-6 pt-2.5 text-muted-foreground backdrop-blur-sm">
        <button
          aria-expanded={expanded}
          className="flex w-full min-w-0 items-center gap-2 text-left text-xs font-medium text-foreground"
          data-testid="projects-agent-selection-toggle"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          <ChevronDown
            className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", !expanded && "-rotate-90")}
          />
          <span className="truncate">{summary}</span>
        </button>
        {expanded ? (
          <div className="mt-2 space-y-1.5 pl-5.5">
            {visibleItems.map((item) => <SelectionItemRow item={item} key={item.id} />)}
            {overflowItems.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="h-6 px-2 text-xs text-muted-foreground"
                    data-testid="projects-agent-selection-more"
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {t("projects.agentChat.more", { count: overflowItems.length })}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-64 min-w-64 overflow-y-auto" side="top">
                  {overflowItems.map((item) => (
                    <DropdownMenuItem disabled key={item.id}>
                      <SelectionItemRow item={item} overflow />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
