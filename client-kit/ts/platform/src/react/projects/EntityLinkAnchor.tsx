// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/shared/ui/markdown/entityLinks.tsx: Issue/PR presentation and tooltip.
// The host supplies its current admitted reader and navigation, never URL identity.
import * as React from "react";
import { useUiT } from "../context";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../sidebar/tooltip";
import { BuzzInlineLink, BuzzLinkChip } from "../messages/message-link/BuzzLinkChip";
import { useInlineTooltipPosition } from "../messages/message-link/useInlineTooltipPosition";
import { parseEntityLink, type ParsedEntityLink } from "./entityLink";
import { openProjectEntity, readProjectEntity } from "./projectEntityNavigation";
import type { ProjectsHost } from "./projectEnumeration";
import type { ProjectWorkItemTarget } from "./projectWorkItems";

export type EntityLinkRuntime = {
  host: ProjectsHost | null;
  onOpen: (projectId: string, target: ProjectWorkItemTarget) => Promise<unknown>;
  copyLink: (href: string) => void;
  onError: (error: unknown) => void;
};

export function EntityLinkAnchor({ children, href, interactive = true, asChip = true, runtime }: {
  children?: React.ReactNode; href: string; interactive?: boolean; asChip?: boolean; runtime?: EntityLinkRuntime;
}) {
  const parsed = parseEntityLink(href);
  if (!parsed.ok || (parsed.value.type !== "issue" && parsed.value.type !== "pr")) {
    return <span data-entity-link="">{children ?? href}</span>;
  }
  return <ProjectEntityAnchor key={`${runtime?.host?.scopeKey}:${href}`} href={href} link={parsed.value}
    interactive={interactive} asChip={asChip} runtime={runtime}>{children}</ProjectEntityAnchor>;
}

function ProjectEntityAnchor({ children, href, link, interactive, asChip, runtime }: {
  children?: React.ReactNode; href: string; link: Extract<ParsedEntityLink, { type: "issue" | "pr" }>;
  interactive: boolean; asChip: boolean; runtime?: EntityLinkRuntime;
}) {
  const t = useUiT();
  const { contentRef, onPointerMove } = useInlineTooltipPosition();
  const [title, setTitle] = React.useState<string | null>();
  const host = runtime?.host;
  const lifetime = React.useMemo(() => ({ controller: new AbortController() }), [host, href]);
  const opening = React.useRef(false);
  React.useEffect(() => {
    const controller = new AbortController();
    lifetime.controller = controller;
    if (interactive && host) {
      void readProjectEntity(host, link, controller.signal).then(item => {
        if (!controller.signal.aborted) setTitle(item.type === "issue" ? item.issue.title : item.pullRequest.title);
      }, () => { if (!controller.signal.aborted) setTitle(null); });
    }
    return () => controller.abort();
  }, [host, href, interactive, lifetime]);
  const presentation = {
    ariaLabel: t(link.type === "issue" ? "projects.share.openIssue" : "projects.share.openPr", { id: link.id.slice(0, 8), repository: link.dtag }),
    footer: t(link.type === "issue" ? "projects.share.issue" : "projects.share.pr", { repository: link.dtag }),
  };
  const onOpenLink = () => {
    const signal = lifetime.controller.signal;
    if (!interactive || !host || !runtime || opening.current || signal.aborted) return;
    opening.current = true;
    // Tooltip data is display-only. Every click re-reads the current scope.
    void openProjectEntity(host, link, signal, runtime.onOpen)
      .catch(error => { if (!signal.aborted) { setTitle(null); runtime.onError(error); } })
      .finally(() => { opening.current = false; });
  };
  const openable = interactive && !!host;
  const copyLink = (value:string) => runtime?.copyLink(value);
  const element = asChip ? <BuzzLinkChip copyLink={copyLink} data-buzz-link-kind={link.type}
    href={href} icon={link.type} aria-label={title ? `${presentation.ariaLabel}: ${link.dtag} · ${title}` : presentation.ariaLabel}
    interactive={openable} onOpenLink={onOpenLink} wrapping>{link.dtag}</BuzzLinkChip>
    : <BuzzInlineLink copyLink={copyLink} href={href} title={href}
      aria-label={title ? `${presentation.ariaLabel}: ${title}` : presentation.ariaLabel}
      interactive={openable} onOpenLink={onOpenLink}>{children}</BuzzInlineLink>;
  if (!openable) return element;
  const context = title === undefined ? `${link.dtag} · ${link.id.slice(0, 8)}` : title;
  return <TooltipProvider delayDuration={500} skipDelayDuration={0}><Tooltip>
    <TooltipTrigger asChild onPointerMove={onPointerMove}>{element}</TooltipTrigger>
    <TooltipContent ref={contentRef} className="max-w-72 p-2 text-left" side="top">
      {context ? <span className="line-clamp-3 [overflow-wrap:anywhere] whitespace-normal" data-buzz-tooltip-metadata-content="">{context}</span> : null}
      <span className={`${context ? "mt-1 " : ""}line-clamp-2 max-w-full [overflow-wrap:anywhere] whitespace-normal text-2xs text-secondary-foreground/80`}
        data-buzz-tooltip-metadata-type="">{presentation.footer}</span>
    </TooltipContent>
  </Tooltip></TooltipProvider>;
}
