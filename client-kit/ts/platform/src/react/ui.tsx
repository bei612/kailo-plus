// 平台页的最小外观。两端宿主都是 Tailwind 加同一套语义色（border、muted-foreground、
// secondary、destructive……），这里只用这些类名，不依赖任一宿主的组件库；宿主把本包
// 登记为 Tailwind 的扫描源（@source），类名就按宿主自己的主题生成。

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AlertCircle, type LucideIcon } from "lucide-react";
import { ErrorClass, ReasonCode } from "@client-kit/contracts";
import { BffError } from "../transport";
import { platformMessages, type PlatformMessageKey } from "../i18n";
import { useReasonText, useT } from "./context";

/** The catalog label of a governed action key (the same encoding the Dart catalog uses). */
export function useActionLabel(): (actionKey: string) => string {
  const t = useT();
  return (actionKey: string) => {
    // The shared Dart catalog permits hyphens, not underscores, in message keys.
    // Round-trip the encoding so a different wire action never aliases a label.
    const key = `actions.${actionKey.replaceAll("_", "-")}`;
    return key.slice("actions.".length).replaceAll("-", "_") === actionKey
      && Object.hasOwn(platformMessages, key) ? t(key as PlatformMessageKey)
      : actionKey.startsWith("task.cancel.") ? t("tasks.cancelRequest")
      : actionKey.startsWith("task.rerun.") ? t("tasks.rerunRequest") : t("actions.unknown");
  };
}

/** Presentation only: unknown extension actions retain their exact wire key.
 * This catalog does not register, authorize or enable an action. The `plain` variant
 * (DD-170 §16.5) shows only the label; the wire key stays available on hover. */
export function ActionLabel({ actionKey, variant = "stacked" }: { actionKey: string; variant?: "stacked" | "plain" }) {
  const label = useActionLabel()(actionKey);
  if (variant === "plain") return <span className="truncate" title={actionKey}>{label}</span>;
  return <span className="inline-flex flex-col" title={actionKey}>
    <span>{label}</span><code className="text-xs text-muted-foreground">{actionKey}</code>
  </span>;
}

/** A definitive GET refusal is not an unknown external write outcome. */
export function ReadFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  const reasonText = useReasonText();
  const response = error instanceof BffError ? error : null;
  const knownClass = response?.errorClass !== undefined
    && Object.values(ErrorClass).includes(response.errorClass);
  const refusal = response && (response.errorClass === undefined || knownClass)
    && response.errorClass !== ErrorClass.Unknown
    && (knownClass || response.status === 403 || response.status === 404) ? response : null;
  const reason = refusal?.reason;
  const text = !refusal ? t("platform.loadFailed")
    : reason !== undefined && Object.values(ReasonCode).includes(reason) ? reasonText(reason)
    : refusal.status === 403 ? t("tasks.status.denied")
    : refusal.status === 404 ? t("native.unavailable.title")
    : t("workspace.lifecycle.rejected", { reason: String(refusal.status) });
  // DD-141 §9 / 20 §13.4(7): inline error — AlertCircle in danger, the reason, a secondary retry.
  return <Notice role={refusal ? "alert" : "status"}>
    <span className="inline-flex items-center gap-2 font-medium text-foreground">
      <AlertCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-danger-text" strokeWidth={1.75} />{text}
    </span>
    <Button onClick={onRetry}>{t("platform.retry")}</Button>
  </Notice>;
}

/** Centered page notice. With `icon` it is the §9 empty state: a 48px single-colour
 * Lucide line glyph (1.5 stroke, brand) above the message. */
export function Notice({ children, role, icon: Icon }: { children: ReactNode; role?: "alert" | "status"; icon?: LucideIcon }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground" role={role}>
      {Icon ? <Icon aria-hidden="true" className="mb-1 h-12 w-12 text-brand-text opacity-80" strokeWidth={1.5} /> : null}
      {children}
    </div>
  );
}

export type Tone = "neutral" | "positive" | "negative" | "warning" | "info" | "brand";

// DD-141 §9: soft status pairs (tint + readable text), never solid blocks. DD-168 §16.2: a
// status never wraps inside a table cell.
const toneClass: Record<Tone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  positive: "border-transparent bg-success-soft text-success-text",
  negative: "border-transparent bg-danger-soft text-danger-text",
  warning: "border-transparent bg-warning-soft text-warning-text",
  info: "border-transparent bg-info-soft text-info-text",
  brand: "border-transparent bg-brand-soft text-brand-soft-foreground",
};

export function Badge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-sm border px-1.5 text-xs font-medium ${toneClass[tone]}`}>
      {children}
    </span>
  );
}

export function Button({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { className?: string }) {
  return (
    <button
      type="button"
      className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-input bg-background px-3.5 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px disabled:pointer-events-none disabled:opacity-50 ${className ?? ""}`}
      {...props}
    />
  );
}

/**
 * A simple bounded table (DD-168 §16.2 layout: Overline header, 40 px rows, hairline rows,
 * hover tint, horizontal scroll instead of squeezed columns). Lists that can grow use
 * DataTable, which adds the total, paging, sorting and filtering.
 */
export function Table({ head, children, label }: { head: ReactNode[]; children: ReactNode; label?: string }) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <table aria-label={label} className="w-full border-separate border-spacing-0 text-left text-sm">
        <thead className="text-muted-foreground">
          <tr>
            {head.map((cell, i) => (
              // 表头是固定列，位置即身份
              // biome-ignore lint/suspicious/noArrayIndexKey: 见上
              <th key={i} scope="col" className="h-9 whitespace-nowrap border-b border-border px-3 text-[0.6875rem] font-semibold uppercase tracking-[0.04em]">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:hover]:bg-accent/40 [&>tr:last-child>td]:border-b-0">{children}</tbody>
      </table>
    </div>
  );
}

export function Cell({ children, mono, title, nowrap }: { children?: ReactNode; mono?: boolean; title?: string; nowrap?: boolean }) {
  return (
    <td className={`h-10 border-b border-border px-3 py-1.5 align-middle ${mono ? "font-mono text-xs" : ""} ${nowrap ? "whitespace-nowrap" : ""}`} title={title}>
      {children}
    </td>
  );
}

export { DataTable, Pagination, CellStack, usePaged, CARD_PAGE_SIZES, type DataColumn } from "./data-table";
export { EmptyState, ErrorState, PermissionState, TableSkeleton, DetailSkeleton, CardGridSkeleton } from "./state-views";
export { KeyValueList, IdText, Tag, TagList, StructuredValue, RawData, Timeline, shortId, type KeyValueItem, type TimelineItem } from "./key-value";
export { ConfirmDialog } from "./confirm-dialog";
export { PageBody, PageSection, DetailHeader, RefreshButton, FilterChips } from "./page-layout";
