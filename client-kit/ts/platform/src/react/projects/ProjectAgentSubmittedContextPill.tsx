// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectAgentSubmittedContextPill.tsx.
import { ChevronDown, Info } from "lucide-react";
import * as React from "react";

import { useUiT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";

export const ProjectAgentSubmittedContextPill = React.memo(
  function ProjectAgentSubmittedContextPill({ payload }: { payload: string }) {
    const t = useUiT();
    const [open, setOpen] = React.useState(false);

    return (
      <div className="pb-1 pl-11 pr-2" data-testid="project-agent-sent-context">
        <button
          aria-expanded={open}
          aria-label={t(open ? "projects.agentChat.hideSentContext" : "projects.agentChat.showSentContext")}
          className="inline-flex h-6 items-center gap-1 rounded-full border border-border/45 bg-muted/20 px-2 text-2xs text-muted-foreground transition-colors hover:border-border/70 hover:bg-muted/35 hover:text-foreground"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          <Info className="h-3 w-3" />
          <span>{t("projects.agentChat.sentContext")}</span>
          <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
        </button>
        {open ? (
          <section
            aria-label={t("projects.agentChat.sentContextRegion")}
            className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/25 p-2 font-mono text-xs text-muted-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            data-testid="project-agent-sent-context-payload"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the scrollable disclosure must receive keyboard focus
            tabIndex={0}
          >
            {payload}
          </section>
        ) : null}
      </div>
    );
  },
);
