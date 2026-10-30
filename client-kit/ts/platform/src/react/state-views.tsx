// DD-170 (.design/20 §16.4): the four page states every list, detail and section designs —
// empty, loading, error and no access. "Could not load" is never drawn as "nothing here"
// (use-load.ts): a refusal says the person lacks access, an unknown failure offers a retry,
// an empty result invites the one next step. Loading keeps the page's shape with skeletons.
import type { ReactNode } from "react";
import { AlertCircle, Inbox, Lock, type LucideIcon, SearchX } from "lucide-react";
import { ErrorClass, ReasonCode } from "@client-kit/contracts";
import { BffError } from "../transport";
import { useReasonText, useT } from "./context";

/** §9 empty state: a 64 px brand tile with a line glyph, a Title 2 heading, a muted line and one action. */
export function EmptyState({ icon: Icon = Inbox, title, description, action, compact, testId }: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  /** At most one primary action. */
  action?: ReactNode;
  /** Inside a card or section: smaller tile, less padding. */
  compact?: boolean;
  testId?: string;
}) {
  return <div role="status" data-testid={testId ?? "empty-state"}
    className={`flex flex-col items-center justify-center text-center ${compact ? "gap-2 px-4 py-8" : "min-h-56 gap-3 px-6 py-12"}`}>
    <span aria-hidden className={`relative grid place-items-center overflow-hidden rounded-2xl bg-brand-soft text-brand-text ${compact ? "h-12 w-12" : "h-16 w-16"}`}>
      <span className="absolute inset-0 opacity-[0.14] [background:var(--k-gradient-brand)]" />
      <Icon className={`relative ${compact ? "h-6 w-6" : "h-7 w-7"}`} strokeWidth={1.5} />
    </span>
    <p className={`font-semibold text-foreground ${compact ? "text-sm" : "text-[1.0625rem] leading-6 tracking-[-0.012em]"}`}>{title}</p>
    {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
    {action ? <div className="mt-1 flex items-center gap-2">{action}</div> : null}
  </div>;
}

/** No results for the current filter (the list itself is not empty). */
export function NoMatchState({ onClear }: { onClear?: () => void }) {
  const t = useT();
  return <EmptyState compact icon={SearchX} title={t("list.noMatch")}
    action={onClear ? <button type="button" className="text-sm text-brand-text hover:underline" onClick={onClear}>{t("list.clearSearch")}</button> : undefined} />;
}

/** The refusal class of a failed read, if it is a definitive refusal rather than an unknown outcome. */
export function readRefusal(error: unknown): "denied" | "missing" | null {
  if (!(error instanceof BffError)) return null;
  if (error.errorClass === ErrorClass.Unknown) return null;
  if (error.status === 403) return "denied";
  if (error.status === 404) return "missing";
  return null;
}

/** A section or page the person may not see. Says why and whom to ask; never a blank pane. */
export function PermissionState({ title, description, compact }: { title?: ReactNode; description?: ReactNode; compact?: boolean }) {
  const t = useT();
  return <div role="status" data-testid="permission-state"
    className={`flex flex-col items-center justify-center text-center ${compact ? "gap-2 px-4 py-8" : "min-h-56 gap-3 px-6 py-12"}`}>
    <span aria-hidden className={`grid place-items-center rounded-2xl bg-muted text-muted-foreground ${compact ? "h-12 w-12" : "h-16 w-16"}`}>
      <Lock className={compact ? "h-6 w-6" : "h-7 w-7"} strokeWidth={1.5} />
    </span>
    <p className={`font-semibold text-foreground ${compact ? "text-sm" : "text-[1.0625rem] leading-6 tracking-[-0.012em]"}`}>{title ?? t("state.deniedTitle")}</p>
    <p className="max-w-md text-sm text-muted-foreground">{description ?? t("state.deniedBody")}</p>
  </div>;
}

/**
 * §13.4(8) inline error: "Couldn't load …", the reason in plain words and a retry. A known
 * reason code is translated; the raw code is never the message.
 */
export function ErrorState({ error, onRetry, title, compact }: { error?: unknown; onRetry?: () => void; title?: ReactNode; compact?: boolean }) {
  const t = useT();
  const reasonText = useReasonText();
  const refusal = readRefusal(error);
  if (refusal === "denied") return <PermissionState compact={compact} />;
  const reason = error instanceof BffError && error.reason !== undefined && Object.values(ReasonCode).includes(error.reason)
    ? reasonText(error.reason) : undefined;
  return <div role="alert" data-testid="error-state"
    className={`flex flex-col items-center justify-center text-center ${compact ? "gap-2 px-4 py-8" : "min-h-56 gap-3 px-6 py-12"}`}>
    <span aria-hidden className={`grid place-items-center rounded-2xl bg-danger-soft text-danger-text ${compact ? "h-12 w-12" : "h-16 w-16"}`}>
      <AlertCircle className={compact ? "h-6 w-6" : "h-7 w-7"} strokeWidth={1.5} />
    </span>
    <p className={`font-semibold text-foreground ${compact ? "text-sm" : "text-[1.0625rem] leading-6 tracking-[-0.012em]"}`}>
      {title ?? (refusal === "missing" ? t("state.missingTitle") : t("state.loadFailedTitle"))}
    </p>
    <p className="max-w-md text-sm text-muted-foreground">{reason ?? (refusal === "missing" ? t("state.missingBody") : t("state.loadFailedBody"))}</p>
    {onRetry && refusal !== "missing" ? <button type="button" onClick={onRetry}
      className="mt-1 inline-flex h-8 items-center rounded-lg border border-input bg-background px-3.5 text-sm font-medium shadow-xs hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
      {t("platform.retry")}
    </button> : null}
  </div>;
}

function Bar({ className }: { className: string }) {
  return <span aria-hidden className={`block animate-pulse rounded-md bg-muted motion-reduce:animate-none ${className}`} />;
}

/** Page-level loading for a table: the table's frame with shimmering rows, not a spinner. */
export function TableSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  const t = useT();
  return <div role="status" aria-label={t("platform.loading")} data-testid="table-skeleton"
    className="overflow-hidden rounded-xl border border-border bg-card">
    <div className="flex h-9 items-center gap-6 border-b border-border bg-muted/40 px-3">
      {Array.from({ length: columns }, (_, i) => <Bar key={i} className="h-2.5 w-16" />)}
    </div>
    {Array.from({ length: rows }, (_, r) => <div key={r} className="flex h-10 items-center gap-6 border-b border-border px-3 last:border-b-0">
      {Array.from({ length: columns }, (_, c) => <Bar key={c} className={`h-3 ${c === 0 ? "w-40" : c === columns - 1 ? "w-14" : "w-24"}`} />)}
    </div>)}
  </div>;
}

/** Loading for a detail: a title bar and key–value lines. */
export function DetailSkeleton({ lines = 5 }: { lines?: number }) {
  const t = useT();
  return <div role="status" aria-label={t("platform.loading")} data-testid="detail-skeleton" className="flex flex-col gap-4">
    <Bar className="h-5 w-56" />
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      {Array.from({ length: lines }, (_, i) => <div key={i} className="flex items-center gap-6"><Bar className="h-3 w-24" /><Bar className="h-3 w-64" /></div>)}
    </div>
  </div>;
}

/** Loading for a card grid. */
export function CardGridSkeleton({ cards = 6 }: { cards?: number }) {
  const t = useT();
  return <div role="status" aria-label={t("platform.loading")} data-testid="card-skeleton"
    className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-4">
    {Array.from({ length: cards }, (_, i) => <div key={i} className="flex h-28 flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <Bar className="h-4 w-32" /><Bar className="h-3 w-48" /><Bar className="h-3 w-20" />
    </div>)}
  </div>;
}
