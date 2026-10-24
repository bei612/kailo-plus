// DD-152 (.design/20 §13, 07 §4.8.7): the Kailo shell of a component page. Kailo draws
// the page header (product, breadcrumbs, title, actions), the section tabs, the
// first-paint skeleton and the confirmation dialog; the component draws only its
// content. Everything the component supplied is display text, rendered as React
// text and never stored or sent anywhere.
import type { ComponentType, ReactNode } from "react";
import {
  ChevronRight, Database, Download, Filter, Folder, FolderPlus, Library, MessageSquarePlus, MoreHorizontal, Pencil,
  Play, Plus, RefreshCw, Rocket, Search, Settings, Share2, Trash2, Upload, AppWindow, type LucideProps,
} from "lucide-react";
import { Button } from "./profile/buzz/shared/ui/button";
import { AgentAlertDialog, AlertDialogAction, AlertDialogCancel } from "./agent-library/AgentAlertDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./sidebar/dropdown-menu";
import { useT } from "./context";
import type { EmbedActionIcon, EmbedConfirm, EmbedPage } from "./native-embed-host";

export type NativePageCategoryKey = "files" | "knowledge" | "data" | null;

const ACTION_ICONS: Record<EmbedActionIcon, ComponentType<LucideProps>> = {
  upload: Upload, plus: Plus, "folder-plus": FolderPlus, share: Share2, download: Download, rocket: Rocket,
  refresh: RefreshCw, settings: Settings, "message-square-plus": MessageSquarePlus, play: Play, trash: Trash2,
  pencil: Pencil, filter: Filter, search: Search, more: MoreHorizontal,
};

const CATEGORY_ICONS: Record<Exclude<NativePageCategoryKey, null>, ComponentType<LucideProps>> = {
  files: Folder, knowledge: Library, data: Database,
};

function Spinner() {
  return <span aria-hidden className="size-3.5 animate-spin rounded-full border-[1.5px] border-current border-r-transparent" />;
}

/**
 * Page header 52 + optional tab strip 40 (20 §13.2). `productTitle` is the presentation
 * category name (云盘/知识库/问数); `page` is the component's latest header, or null
 * while it has none (the product title alone, never a blank bar).
 */
export function NativePageHeader({ productTitle, category, page, onNavigate, onAction }: {
  productTitle: string;
  category: NativePageCategoryKey;
  page: EmbedPage | null;
  onNavigate: (kind: "tab" | "breadcrumb", id: string) => void;
  onAction: (id: string) => void;
}) {
  const t = useT();
  const Glyph = category ? CATEGORY_ICONS[category] : AppWindow;
  const crumbs = page?.breadcrumbs ?? [];
  const title = page?.title ?? null;
  const visible = (page?.actions ?? []).filter((action) => action.variant !== "menu");
  const menu = (page?.actions ?? []).filter((action) => action.variant === "menu");
  // Secondary actions first, the one primary action rightmost (20 §9 dialog/footer order).
  const ordered = [...visible.filter((action) => action.variant !== "primary"), ...visible.filter((action) => action.variant === "primary")];
  return <>
    <header data-kailo-page-header data-testid="native-page-header"
      className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-5">
      <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md bg-brand-soft text-brand-soft-foreground">
        <Glyph className="size-4" strokeWidth={1.75} />
      </span>
      <nav aria-label={t("platform.nativePage.breadcrumb")} className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1 text-control">
          <li className={`shrink-0 ${title ? "text-muted-foreground" : "text-headline font-semibold tracking-[-0.006em] text-foreground"}`}
            aria-current={title ? undefined : "page"}>{productTitle}</li>
          {crumbs.map((crumb) => <li key={crumb.id} className="flex min-w-0 items-center gap-1">
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/60" strokeWidth={1.75} />
            <button type="button" onClick={() => onNavigate("breadcrumb", crumb.id)}
              className="max-w-[16rem] truncate rounded-md px-1 py-0.5 text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-foreground">
              {crumb.label}</button>
          </li>)}
          {title ? <li className="flex min-w-0 items-center gap-1" aria-current="page">
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/60" strokeWidth={1.75} />
            <span className="truncate px-1 text-headline font-semibold tracking-[-0.006em] text-foreground" title={title}>{title}</span>
          </li> : null}
        </ol>
      </nav>
      {ordered.length || menu.length ? <div className="flex shrink-0 items-center gap-2" data-testid="native-page-actions">
        {ordered.map((action) => {
          const Icon = action.icon ? ACTION_ICONS[action.icon] : null;
          return <Button key={action.id} type="button" variant={action.variant === "primary" ? "default" : "outline"}
            disabled={action.disabled || action.busy} aria-busy={action.busy || undefined} onClick={() => onAction(action.id)}>
            {action.busy ? <Spinner /> : Icon ? <Icon strokeWidth={1.75} /> : null}{action.label}</Button>;
        })}
        {menu.length ? <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label={t("platform.nativePage.more")}>
              <MoreHorizontal strokeWidth={1.75} /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menu.map((action) => {
              const Icon = action.icon ? ACTION_ICONS[action.icon] : null;
              return <DropdownMenuItem key={action.id} disabled={action.disabled || action.busy} onSelect={() => onAction(action.id)}>
                {Icon ? <Icon className="size-4 text-muted-foreground" strokeWidth={1.75} /> : null}{action.label}</DropdownMenuItem>;
            })}
          </DropdownMenuContent>
        </DropdownMenu> : null}
      </div> : null}
    </header>
    {page && page.tabs.length ? <div role="tablist" aria-label={productTitle} data-testid="native-page-tabs"
      className="flex h-10 shrink-0 items-stretch gap-5 border-b border-border px-5">
      {page.tabs.map((tab) => {
        const selected = tab.id === page.activeTab;
        return <button key={tab.id} type="button" role="tab" aria-selected={selected}
          onClick={() => { if (!selected) onNavigate("tab", tab.id); }}
          className={`relative -mb-px border-b-2 text-control transition-colors duration-100 ${selected
            ? "border-brand font-semibold text-foreground" : "border-transparent font-medium text-muted-foreground hover:text-foreground"}`}>
          {tab.label}</button>;
      })}
    </div> : null}
  </>;
}

/** First paint until the component's first header arrives: the same header and a quiet content skeleton. */
export function NativePageSkeleton() {
  return <div aria-hidden data-testid="native-page-skeleton" className="absolute inset-0 flex flex-col gap-3 bg-background p-6">
    {[56, 72, 64, 80, 48, 68].map((width, index) => <div key={index} className="flex items-center gap-3">
      <div className="kailo-embed-skeleton size-5 rounded-md" />
      <div className="kailo-embed-skeleton h-3.5 rounded" style={{ width: `${width * 4}px` }} />
    </div>)}
  </div>;
}

/** The component's confirmation, in Kailo's dialog (20 §9); focus returns to the frame on close. */
export function NativeConfirmDialog({ confirm, onDone }: { confirm: EmbedConfirm | null; onDone: (confirmed: boolean) => void }) {
  const t = useT();
  return <AgentAlertDialog open={confirm !== null} onOpenChange={(open) => { if (!open) onDone(false); }}
    testId="native-confirm-dialog" title={confirm?.title ?? ""} description={confirm?.description ?? ""}
    footer={<>
      <AlertDialogCancel asChild><Button variant="outline">{confirm?.cancelLabel ?? t("platform.cancel")}</Button></AlertDialogCancel>
      <AlertDialogAction asChild>
        <Button variant={confirm?.tone === "danger" ? "destructive" : "default"} onClick={(event) => { event.preventDefault(); onDone(true); }}>
          {confirm?.confirmLabel ?? t("platform.nativePage.confirm")}</Button>
      </AlertDialogAction>
    </>} />;
}

export function NativePageFrame({ children }: { children: ReactNode }) {
  return <div className="relative flex min-h-0 w-full flex-1 flex-col bg-background">{children}</div>;
}
