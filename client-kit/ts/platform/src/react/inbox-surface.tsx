// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/home/ui/{HomeView,InboxListPane,InboxFilterMenu,InboxDetailPane}.tsx.
// Presentation only. Each host retains its real message/read/transport authority.
import * as React from "react";
import { ArrowLeft, ChevronDown, Ellipsis, ExternalLink, Mail } from "lucide-react";
import { useUiT } from "./context";
import { cn } from "./profile/buzz/shared/lib/cn";
import { Popover, PopoverContent, PopoverTrigger } from "./conversations/popover";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./sidebar/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./sidebar/tooltip";
import { Switch } from "./switch";

export type InboxFilter = "all" | "mention" | "thread" | "agent_activity" | "drafts";
const iconButton = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-muted/70 data-[state=open]:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";

export function InboxFilterMenu({ filter, onFilterChange, activeDraftCount }: {
  filter: InboxFilter; onFilterChange: (filter: InboxFilter) => void; activeDraftCount?: number;
}) {
  const t = useUiT();
  const filterLabel = (value: InboxFilter) => t(value === "agent_activity" ? "inbox.agentActivity" : `inbox.${value}`);
  const options: InboxFilter[] = activeDraftCount === undefined ? ["all", "mention", "thread", "agent_activity"] : ["all", "mention", "thread", "agent_activity", "drafts"];
  return <DropdownMenu><DropdownMenuTrigger asChild>
    <button aria-label={t("inbox.filterLabel", { filter: filterLabel(filter) })} className={cn(iconButton, "relative -ml-2 w-auto gap-1 px-2 text-sm font-medium text-foreground")} data-testid="inbox-filter-trigger" type="button">
      <span>{filterLabel(filter)}</span><ChevronDown className="text-muted-foreground" />
    </button>
  </DropdownMenuTrigger><DropdownMenuContent align="start" className="w-52">
    <DropdownMenuRadioGroup value={filter} onValueChange={(value) => { if (options.includes(value as InboxFilter)) onFilterChange(value as InboxFilter); }}>
      {options.map((option) => <div key={option}>
        {option === "drafts" ? <DropdownMenuSeparator className="my-2 bg-border/60" /> : null}
        <DropdownMenuRadioItem value={option}><span className="flex flex-1 items-center gap-2"><span>{filterLabel(option)}</span>
          {option === "drafts" && (activeDraftCount ?? 0) > 0 ? <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-2xs font-semibold leading-none text-primary-foreground" data-testid="inbox-draft-badge-option">{activeDraftCount}</span> : null}
        </span></DropdownMenuRadioItem>
      </div>)}
    </DropdownMenuRadioGroup>
  </DropdownMenuContent></DropdownMenu>;
}

export function InboxListHeader({ filter, onFilterChange, activeDraftCount, unreadOnly, onUnreadOnlyChange, unreadCount, onMarkAllRead, pending = false }: {
  filter: InboxFilter; onFilterChange: (filter: InboxFilter) => void; activeDraftCount?: number;
  unreadOnly: boolean; onUnreadOnlyChange: (value: boolean) => void; unreadCount: number; onMarkAllRead: () => void; pending?: boolean;
}) {
  const t = useUiT(); const id = React.useId();
  return <div className="relative z-40 shrink-0"><div className="px-5 py-2"><div className="flex min-h-9 w-full min-w-0 items-center justify-between gap-3">
    <div className="order-2 ml-auto flex shrink-0 items-center justify-end"><Popover><PopoverTrigger asChild>
      <button aria-label={t("inbox.options")} className={cn(iconButton, "-mr-4")} data-testid="inbox-options-trigger" type="button"><Ellipsis className="h-4 w-4" /></button>
    </PopoverTrigger><PopoverContent align="end" className="w-60 p-2">
      <div className={cn("flex min-h-9 items-center justify-between gap-3 rounded-lg px-2 py-1.5", filter === "drafts" && "opacity-50")}>
        <label className="text-sm font-medium text-foreground" htmlFor={id}>{t("inbox.unreadOnly")}</label>
        <Switch id={id} checked={unreadOnly} onCheckedChange={onUnreadOnlyChange} disabled={filter === "drafts"} className="shadow-none [&>span]:shadow-none" data-testid="inbox-unread-only-toggle" />
      </div><div role="separator" className="my-1 h-px bg-muted" />
      <button className="flex min-h-9 w-full items-center rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-muted/50 disabled:pointer-events-none disabled:opacity-50" disabled={!unreadCount || pending} onClick={onMarkAllRead} type="button">
        <span>{t("inbox.markAllRead")}</span>{unreadCount > 0 ? <span className="ml-auto text-xs text-muted-foreground">{unreadCount}</span> : null}
      </button>
    </PopoverContent></Popover></div>
    <div className="order-1 flex shrink-0 items-center justify-start"><InboxFilterMenu filter={filter} onFilterChange={onFilterChange} activeDraftCount={activeDraftCount} /></div>
  </div></div></div>;
}

export function InboxLayout({ children, containerRef, listWidth, auxiliaryWidth, showList, showDetail, hasAuxiliary = false, singleAuxiliary = false, onResize, onReset }: {
  children: React.ReactNode; containerRef?: React.Ref<HTMLDivElement>; listWidth: number; auxiliaryWidth?: number;
  showList: boolean; showDetail: boolean; hasAuxiliary?: boolean; singleAuxiliary?: boolean;
  onResize: React.PointerEventHandler<HTMLButtonElement>; onReset?: () => void;
}) {
  const t = useUiT();
  return <div className={cn("relative grid min-h-0 w-full flex-1", singleAuxiliary ? "grid-cols-1" : showList && showDetail && hasAuxiliary ? "grid-cols-[var(--home-inbox-list-width)_minmax(0,1fr)_var(--home-auxiliary-width)]" : showList && showDetail ? "grid-cols-[var(--home-inbox-list-width)_minmax(0,1fr)]" : hasAuxiliary ? "grid-cols-[minmax(0,1fr)_var(--home-auxiliary-width)]" : "grid-cols-1")}
    data-testid="home-inbox" ref={containerRef} style={{ "--home-inbox-list-width": `${listWidth}px`, "--home-auxiliary-width": `${auxiliaryWidth ?? 0}px` } as React.CSSProperties}>
    {showList || showDetail ? <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-30 h-13 bg-background/80 backdrop-blur-md supports-backdrop-filter:bg-background/70 dark:bg-background/70 dark:backdrop-blur-xl dark:supports-backdrop-filter:bg-background/55" data-testid="home-inbox-shared-header-backdrop" /> : null}
    {children}
    <button aria-label={t("inbox.resize")} className={cn("group absolute bottom-0 top-13 z-40 w-3 -translate-x-1/2 cursor-col-resize", showList && showDetail ? "block" : "hidden")} data-testid="home-inbox-list-resize-handle" onDoubleClick={onReset} onPointerDown={onResize} style={{ left: `${listWidth}px` }} title={t("inbox.resizeHint")} type="button"><span className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-border/80 group-focus-visible:bg-border/80" /></button>
  </div>;
}

export function InboxEmptyDetail() {
  const t = useUiT();
  return <section className="flex min-h-0 min-w-0 items-center justify-center bg-background/60 px-6 py-10 pt-20 text-center" data-testid="home-inbox-detail-empty"><div className="max-w-sm">
    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground"><Mail className="h-6 w-6" /></div>
    <p className="mt-4 text-base font-semibold">{t("inbox.selectMessage")}</p><p className="mt-1 text-sm text-muted-foreground">{t("inbox.selectMessageHint")}</p>
  </div></section>;
}

export function InboxDetailHeader({ title, onBack, onOpen, openLabel, fallbackTitle }: {
  title: string; onBack?: () => void; onOpen?: () => void; openLabel: string; fallbackTitle?: string;
}) {
  const t = useUiT();
  return <div className="relative z-40 shrink-0"><div className="px-5 py-2"><div className="flex min-h-9 min-w-0 items-center justify-between gap-3">
    <div className={cn("flex min-w-0 items-center", onBack ? "gap-[4px]" : "gap-1")}>
      {onBack ? <button aria-label={t("inbox.back")} className={cn(iconButton, "rounded-full hover:bg-muted/60")} onClick={onBack} type="button"><ArrowLeft /></button> : null}
      <div className="min-w-0"><h2 className="min-w-0 text-sm font-semibold leading-5 tracking-tight text-foreground" title={fallbackTitle}>
        {onOpen ? <button className="block min-w-0 max-w-full text-left text-sm font-semibold leading-5 tracking-tight text-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" data-testid="home-inbox-context-title" onClick={onOpen} title={openLabel} type="button"><span className="block min-w-0 translate-y-px truncate">{title}</span></button> : <span className="block min-w-0 translate-y-px truncate">{title}</span>}
      </h2></div>
    </div><div className="flex shrink-0 items-center gap-1">{onOpen ? <InboxRowActionButton label={openLabel} onClick={onOpen}><ExternalLink /></InboxRowActionButton> : null}</div>
  </div></div></div>;
}

export function InboxRowActionButton({ children, disabled = false, label, onClick, active = false }: {
  children: React.ReactNode; disabled?: boolean; label: string; onClick: () => void; active?: boolean;
}) {
  return <Tooltip><TooltipTrigger asChild><button aria-label={label} className={cn("flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40", active && "bg-blue-500/10 text-blue-500 hover:text-blue-500")} disabled={disabled} onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (!disabled) onClick(); }} type="button">{children}</button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}
