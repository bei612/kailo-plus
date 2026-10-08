// Original Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/ui/{DraftsPanel,DraftDetailPane}.tsx.
// The hosts resolve destinations and keep the existing scoped useDrafts store.
import * as React from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { AlertTriangle, ArrowLeft, FileText, Lock, Pencil, Send, Trash2 } from "lucide-react";
import type { DraftState } from "./composer/features/messages/lib/useDrafts";
import { MODAL_BACKDROP_BLUR_CLASS } from "./composer/shared/ui/modalBackdrop";
import { MODAL_CONTENT_MOTION_CLASS, MODAL_OVERLAY_MOTION_CLASS } from "./composer/shared/ui/modalMotion";
import { useUiT } from "./context";
import { cn } from "./profile/buzz/shared/lib/cn";
import { Button } from "./profile/buzz/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./sidebar/tooltip";
import { UserAvatar } from "./messages/UserAvatar";

export type DraftListEntry = { key: string; draft: DraftState };
/** Transient presentation of an existing entry; no storage or permissions authority. */
export type DraftSurfaceItem = {
  entry: DraftListEntry; channelLabel: string; createdAt: string; isPrivate: boolean;
  isOrphaned: boolean; canOpen: boolean; canSend: boolean;
};
type Actions = { onOpen: (entry: DraftListEntry) => void; onSend: (entry: DraftListEntry) => void; onDelete: (key: string) => void };
type Preview = (draft: DraftState, className: string) => React.ReactNode;

function DraftActionButton({ children, label, disabled = false, onClick, destructive = false }: {
  children: React.ReactNode; label: string; disabled?: boolean; onClick: () => void; destructive?: boolean;
}) {
  return <Tooltip><TooltipTrigger asChild><Button aria-label={label} className={cn("h-7 w-7 rounded-full p-0 text-muted-foreground hover:text-foreground", destructive && "text-destructive hover:text-destructive")}
    disabled={disabled} onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (!disabled) onClick(); }} size="icon" type="button" variant="ghost">{children}</Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

// DraftDetailPane uses its original 32px controls, not the 28px list controls.
function DraftDetailActionButton({ children, label, disabled = false, onClick, destructive = false }: {
  children: React.ReactNode; label: string; disabled?: boolean; onClick: () => void; destructive?: boolean;
}) {
  return <Tooltip><TooltipTrigger asChild><Button aria-label={label}
    className={destructive ? "h-8 w-8 rounded-full p-0 text-destructive hover:text-destructive" : "h-8 w-8 rounded-full p-0"}
    disabled={disabled} onClick={onClick} size="sm" type="button" variant="ghost">{children}</Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

function DraftDetailActionBar({ canOpen, canSend, canDelete, onOpen, onSend, onDelete }: {
  canOpen: boolean; canSend: boolean; canDelete: boolean; onOpen: () => void; onSend: () => void; onDelete: () => void;
}) {
  const t = useUiT();
  return <div className="absolute right-2 top-1 z-10"><div
    className="-m-1 p-1 opacity-100 transition-opacity duration-150 ease-out sm:pointer-events-none sm:opacity-0 sm:group-hover/message:pointer-events-auto sm:group-hover/message:opacity-100 sm:group-focus-within/message:pointer-events-auto sm:group-focus-within/message:opacity-100"
    data-testid="home-inbox-draft-action-bar"><div className="overflow-hidden rounded-full border border-border/70 bg-background/95 shadow-xs backdrop-blur-sm supports-[backdrop-filter]:bg-background/85"><div className="flex items-center gap-0.5 p-1">
      <DraftDetailActionButton disabled={!canOpen} label={t("drafts.open")} onClick={onOpen}><Pencil className="h-4 w-4" /></DraftDetailActionButton>
      <DraftDetailActionButton disabled={!canSend} label={t("drafts.send")} onClick={onSend}><Send className="h-4 w-4" /></DraftDetailActionButton>
      <DraftDetailActionButton destructive disabled={!canDelete} label={t("drafts.delete")} onClick={onDelete}><Trash2 className="h-4 w-4" /></DraftDetailActionButton>
    </div></div></div></div>;
}

export function DraftSendConfirm({ destination, onCancel, onConfirm }: { destination: string; onCancel: () => void; onConfirm: () => void }) {
  const t = useUiT();
  // Exact default AlertDialog surface used by the original SendConfirmDialog;
  // no textured variant is introduced without a caller.
  return <AlertDialog.Root open onOpenChange={(open) => { if (!open) onCancel(); }}><AlertDialog.Portal>
    <AlertDialog.Overlay className={cn("fixed inset-0 z-50 bg-black/60", MODAL_OVERLAY_MOTION_CLASS, MODAL_BACKDROP_BLUR_CLASS)} />
    <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
      <AlertDialog.Content className={cn("pointer-events-auto grid w-[calc(100vw-2rem)] max-w-md gap-4 outline-hidden rounded-3xl bg-background p-6 shadow-2xl", MODAL_CONTENT_MOTION_CLASS)}>
        <div className="flex flex-col space-y-2 text-left"><AlertDialog.Title className="text-xl font-semibold tracking-tight">{t("drafts.send")}</AlertDialog.Title><AlertDialog.Description className="text-sm text-muted-foreground">{t("drafts.confirm", { destination })}</AlertDialog.Description></div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button onClick={onCancel} size="sm" type="button" variant="outline">{t("platform.cancel")}</Button><Button onClick={onConfirm} size="sm" type="button">{t("drafts.send")}</Button></div>
      </AlertDialog.Content>
    </div>
  </AlertDialog.Portal></AlertDialog.Root>;
}

function DraftRow({ item, selected, onSelect, onOpen, onSend, onDelete, renderPreview }: Actions & {
  item: DraftSurfaceItem; selected: boolean; onSelect: () => void; renderPreview: Preview;
}) {
  const t = useUiT(); const { entry, channelLabel, isPrivate, isOrphaned, canOpen, canSend, createdAt } = item;
  return <div className={cn("group/draft-row relative rounded-md border border-border/70 bg-background transition-colors hover:bg-muted/40 focus-within:bg-muted/40", selected && "border-primary/30 bg-muted/60", isOrphaned && "opacity-50")} data-testid={`home-draft-item-${entry.key}`}>
    <button aria-label={t("drafts.view", { channel: channelLabel })} className="block w-full min-w-0 px-3 py-3 text-left disabled:cursor-default" onClick={onSelect} type="button">
      <div className="min-w-0 pr-0 transition-[padding] group-hover/draft-row:pr-20 group-focus-within/draft-row:pr-20"><div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        {isPrivate ? <Lock className="h-3.5 w-3.5 shrink-0" /> : null}<span className={cn("truncate font-medium", canOpen ? "text-foreground" : "text-muted-foreground", isOrphaned && "text-muted-foreground")}>{channelLabel}</span>
        <span className="shrink-0 text-muted-foreground/70">{createdAt}</span>{isOrphaned ? <span className="shrink-0 rounded px-1 py-0.5 text-2xs font-medium text-destructive/70 ring-1 ring-destructive/30" data-testid={`home-draft-orphaned-label-${entry.key}`}>{t("drafts.threadDeleted")}</span> : null}
      </div><div className="mt-1 max-h-10 overflow-hidden text-sm font-medium leading-5 text-foreground">{renderPreview(entry.draft, "inbox-preview-markdown text-inherit leading-5")}</div></div>
    </button>
    <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-0.5 rounded-full bg-background/95 p-0.5 opacity-0 shadow-xs ring-1 ring-border/70 transition-opacity group-hover/draft-row:pointer-events-auto group-hover/draft-row:opacity-100 group-focus-within/draft-row:pointer-events-auto group-focus-within/draft-row:opacity-100">
      {entry.draft.status === "sent" ? null : <><DraftActionButton disabled={!canOpen} label={t(canOpen ? "drafts.open" : isOrphaned ? "drafts.threadDeleted" : "drafts.noChannel")} onClick={() => onOpen(entry)}><Pencil className="h-4 w-4" /></DraftActionButton><DraftActionButton disabled={!canSend} label={t(canSend ? "drafts.send" : isOrphaned ? "drafts.threadDeleted" : "drafts.noChannel")} onClick={() => onSend(entry)}><Send className="h-4 w-4" /></DraftActionButton></>}
      <DraftActionButton disabled={Boolean(entry.draft.sendIntent)} label={t("drafts.delete")} onClick={() => onDelete(entry.key)}><Trash2 className="h-4 w-4" /></DraftActionButton>
    </div>
  </div>;
}

export function DraftListSurface({ items, selectedKey, onSelect, onOpen, onSend, onDelete, renderPreview }: Actions & {
  items: DraftSurfaceItem[]; selectedKey: string | null; onSelect: (key: string) => void; renderPreview: Preview;
}) {
  const t = useUiT(); const [sendKey, setSendKey] = React.useState<string | null>(null);
  const target = items.find((item) => item.entry.key === sendKey && item.canSend);
  if (!items.length) return <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center"><FileText className="h-8 w-8 text-muted-foreground/50" /><p className="text-sm text-muted-foreground">{t("drafts.empty")}</p></div>;
  return <><div className="flex-1 space-y-2 overflow-y-auto p-4" data-testid="home-inbox-drafts-list"><h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("inbox.drafts")}</h3>
    {items.map((item) => <DraftRow key={item.entry.key} item={item} selected={item.entry.key === selectedKey} onSelect={() => onSelect(item.entry.key)} onOpen={onOpen} onSend={(entry) => setSendKey(entry.key)} onDelete={onDelete} renderPreview={renderPreview} />)}
  </div>{target ? <DraftSendConfirm destination={target.channelLabel} onCancel={() => setSendKey(null)} onConfirm={() => { setSendKey(null); onSend(target.entry); }} /> : null}</>;
}

export function DraftDetailSurface({ item, onBack, onOpen, onSend, onDelete, renderPreview }: Actions & {
  item: DraftSurfaceItem | null; onBack?: () => void; renderPreview: Preview;
}) {
  const t = useUiT(); const [sendOpen, setSendOpen] = React.useState(false);
  React.useEffect(() => setSendOpen(false), [item?.entry.key]);
  if (!item) return <section className="flex min-h-0 min-w-0 items-center justify-center bg-background/60 px-6 py-10 pt-20 text-center" data-testid="home-inbox-draft-detail-empty"><div className="max-w-sm"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground"><FileText className="h-6 w-6" /></div><p className="mt-4 text-base font-semibold">{t("drafts.select")}</p><p className="mt-1 text-sm text-muted-foreground">{t("drafts.selectHint")}</p></div></section>;
  const { entry, isPrivate, isOrphaned, canOpen, canSend, channelLabel, createdAt } = item;
  return <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background/60" data-testid="home-inbox-draft-detail">
    <div className="relative z-40 shrink-0"><div className="px-5 py-2"><div className="flex min-h-9 min-w-0 items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-1">
      {onBack ? <Button aria-label={t("drafts.back")} className="rounded-full text-muted-foreground hover:bg-muted/60 hover:text-foreground" onClick={onBack} size="icon" type="button" variant="ghost"><ArrowLeft /></Button> : null}
      <div className="flex min-w-0 items-center gap-1.5">{isPrivate ? <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}<h2 className="truncate text-sm font-semibold leading-5 tracking-tight text-foreground">{channelLabel}</h2></div>
    </div></div></div></div>
    <div className="-mt-13 min-h-0 flex-1 overflow-y-auto pb-8 pt-15">
      {isOrphaned ? <div className="mx-5 mb-3 flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive" data-testid="home-inbox-draft-orphaned-notice"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{t("drafts.orphaned")}</span></div> : null}
      <div className="relative px-2"><article className="group/message relative z-10 mx-1 flex items-start gap-2.5 rounded-2xl px-2 py-1 transition-colors hover:bg-muted/50 focus-within:bg-muted/50">
        <DraftDetailActionBar canOpen={canOpen} canSend={canSend} canDelete={!entry.draft.sendIntent}
          onOpen={() => onOpen(entry)} onSend={() => setSendOpen(true)} onDelete={() => onDelete(entry.key)} />
        <UserAvatar avatarUrl={null} className="h-9 w-9 shrink-0" displayName={t("drafts.you")} size="md" />
        <div className="min-w-0 flex-1"><div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0"><span className="text-sm font-semibold text-foreground">{t("drafts.you")}</span><span className="text-xs font-medium text-muted-foreground">{t("drafts.draft")}</span><span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground/55">{createdAt}</span></div>
          <div className="mt-0.5 text-base leading-6 text-foreground">{renderPreview(entry.draft, "inbox-preview-markdown text-inherit leading-6")}{entry.draft.pendingImeta.length > 0 && entry.draft.content.trim() ? <p className="mt-2 text-sm text-muted-foreground">{t("drafts.attachments", { count: entry.draft.pendingImeta.length })}</p> : null}</div>
        </div>
      </article></div>
    </div>
    {sendOpen && canSend ? <DraftSendConfirm destination={channelLabel} onCancel={() => setSendOpen(false)} onConfirm={() => { setSendOpen(false); onSend(entry); }} /> : null}
  </section>;
}
