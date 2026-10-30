// DD-170 (.design/20 §16.3, §16.5): structured data is read, not decoded. Facts are key–value
// rows with plain-language labels; identifiers are shortened with a copy affordance; lists of
// names are tags; histories are timelines. A JSON document is shown as nested key–value rows
// and its raw text only behind an explicit "Show raw data" disclosure.
import { type ReactNode, useState } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";
import { useT } from "./context";

export type KeyValueItem = {
  label: ReactNode;
  value: ReactNode;
  /** Key used for React only; defaults to the label when it is a string. */
  id?: string;
  /** Explains the label on hover. */
  hint?: string;
};

/**
 * A definition list in a card: label column in muted text, values aligned, rows divided by
 * hairlines. Items whose value is undefined, null or false are omitted (absence is absence,
 * not a dash); pass `emptyText` to show a muted placeholder instead.
 */
export function KeyValueList({ items, columns = 1, bordered = true, testId }: {
  items: readonly (KeyValueItem | undefined | null | false)[];
  /** Two columns on wide containers for short facts. */
  columns?: 1 | 2;
  bordered?: boolean;
  testId?: string;
}) {
  const rows = items.filter((item): item is KeyValueItem => !!item && item.value !== undefined && item.value !== null && item.value !== false);
  return <dl data-testid={testId ?? "key-value-list"}
    className={`grid min-w-0 text-sm ${columns === 2 ? "sm:grid-cols-2 sm:gap-x-8" : ""} ${bordered ? "rounded-xl border border-border bg-card px-4" : ""}`}>
    {rows.map((item, index) => <div key={item.id ?? (typeof item.label === "string" ? item.label : index)}
      className="grid min-w-0 grid-cols-[minmax(7rem,11rem)_minmax(0,1fr)] items-baseline gap-x-4 border-b border-border py-2.5 last:border-b-0">
      <dt className="text-muted-foreground" title={item.hint}>{item.label}</dt>
      <dd className="min-w-0 break-words text-foreground">{item.value}</dd>
    </div>)}
  </dl>;
}

/** Shortens a long identifier to its head and tail: 9997ef4b…f59f1581. */
export function shortId(value: string, head = 8, tail = 6): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/**
 * An identifier for people who need it (support, audit): shortened, monospace, full value on
 * hover and one click to copy. Never the main text of a row or card.
 */
export function IdText({ value, label, full }: { value: string; label?: string; full?: boolean }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return <span className="inline-flex min-w-0 max-w-full items-center gap-1 align-middle">
    <code className="truncate rounded-sm bg-muted px-1 py-px font-mono text-[0.75rem] text-muted-foreground" title={value}>{full ? value : shortId(value)}</code>
    <button type="button" aria-label={label ? t("kv.copyNamed", { name: label }) : t("kv.copy")} title={copied ? t("kv.copied") : t("kv.copy")}
      onClick={(event) => { event.stopPropagation(); void copyText(value).then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }); }}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
      {copied ? <Check aria-hidden className="h-3.5 w-3.5 text-success-text" strokeWidth={1.75} /> : <Copy aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />}
    </button>
  </span>;
}

export type TagTone = "neutral" | "brand" | "positive" | "warning" | "negative" | "info";
const tagTone: Record<TagTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  brand: "bg-brand-soft text-brand-soft-foreground",
  positive: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  negative: "bg-danger-soft text-danger-text",
  info: "bg-brand-soft text-brand-soft-foreground",
};

/** §9 tag: 20 px, soft tint with readable text, never a solid block. */
export function Tag({ tone = "neutral", children, title }: { tone?: TagTone; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex h-5 max-w-full items-center truncate rounded-sm px-1.5 text-xs font-medium ${tagTone[tone]}`}>{children}</span>;
}

/** A wrapped row of tags with a "+N more" overflow. */
export function TagList({ items, max = 6, tone }: { items: readonly ReactNode[]; max?: number; tone?: TagTone }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, max);
  return <span className="flex flex-wrap items-center gap-1">
    {shown.map((item, index) => <Tag key={index} tone={tone}>{item}</Tag>)}
    {!all && items.length > max ? <button type="button" className="text-xs text-brand-text hover:underline" onClick={() => setAll(true)}>
      {t("kv.more", { count: String(items.length - max) })}</button> : null}
  </span>;
}

const IDENTIFIER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^[0-9a-f]{32,}$|^sha256:[0-9a-f]{16,}$/i;

/** Turns a JSON key such as `maxTokens` or `max_tokens` into "Max tokens". */
export function humanizeKey(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ").trim().toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : key;
}

/**
 * A JSON value as something a person reads: objects become nested key–value rows, arrays of
 * scalars become tags, identifiers become IdText, booleans read as yes/no. Depth is bounded;
 * deeper structure collapses behind a disclosure.
 */
export function StructuredValue({ value, labels, depth = 0 }: { value: unknown; labels?: Readonly<Record<string, string>>; depth?: number }): ReactNode {
  const t = useT();
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground">{t("kv.notSet")}</span>;
  if (typeof value === "boolean") return <>{value ? t("kv.yes") : t("kv.no")}</>;
  if (typeof value === "number") return <span className="tabular-nums">{value.toLocaleString()}</span>;
  if (typeof value === "string") return IDENTIFIER.test(value) ? <IdText value={value} /> : <span className="whitespace-pre-wrap break-words">{value}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">{t("kv.none")}</span>;
    if (value.every((item) => typeof item !== "object" || item === null)) return <TagList items={value.map((item) => String(item))} />;
    return <ol className="flex flex-col gap-2">{value.map((item, index) => <li key={index} className="rounded-lg border border-border p-2">
      <StructuredValue value={item} labels={labels} depth={depth + 1} /></li>)}</ol>;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-muted-foreground">{t("kv.none")}</span>;
    if (depth >= 2) return <RawData value={value} />;
    return <KeyValueList bordered={depth === 0} items={entries.map(([key, item]) => ({
      id: key, label: labels?.[key] ?? humanizeKey(key), value: <StructuredValue value={item} labels={labels} depth={depth + 1} />,
    }))} />;
  }
  return <>{String(value)}</>;
}

/** The raw text of a document, collapsed by default (for support and copying, not reading). */
export function RawData({ value, label }: { value: unknown; label?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <div className="flex min-w-0 flex-col gap-1.5">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
      className="inline-flex w-fit items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
      <ChevronRight aria-hidden className={`h-3.5 w-3.5 transition-transform duration-[140ms] ${open ? "rotate-90" : ""}`} strokeWidth={1.75} />
      {label ?? (open ? t("kv.hideRaw") : t("kv.showRaw"))}
    </button>
    {open ? <div className="relative">
      <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-muted/50 p-3 font-mono text-xs leading-5 text-foreground">{text}</pre>
      <span className="absolute right-2 top-2"><IdCopy text={text} /></span>
    </div> : null}
  </div>;
}

function IdCopy({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return <button type="button" aria-label={t("kv.copy")} title={copied ? t("kv.copied") : t("kv.copy")}
    onClick={() => void copyText(text).then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); } })}
    className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-background text-muted-foreground shadow-xs hover:text-foreground">
    {copied ? <Check aria-hidden className="h-3.5 w-3.5 text-success-text" strokeWidth={1.75} /> : <Copy aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />}
  </button>;
}

export type TimelineItem = {
  id: string;
  title: ReactNode;
  /** RFC3339 or a preformatted time node. */
  time?: ReactNode;
  description?: ReactNode;
  tone?: TagTone;
};

const dotTone: Record<TagTone, string> = {
  neutral: "bg-muted-foreground", brand: "bg-primary", positive: "bg-success-text", warning: "bg-warning", negative: "bg-destructive", info: "bg-primary",
};

/** A vertical history: a dot per event, the title, its time and an optional line of detail. */
export function Timeline({ items, testId }: { items: readonly TimelineItem[]; testId?: string }) {
  return <ol className="relative flex flex-col" data-testid={testId ?? "timeline"}>
    {items.map((item, index) => <li key={item.id} className="relative grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 pb-4 last:pb-0">
      {index < items.length - 1 ? <span aria-hidden className="absolute left-[0.4375rem] top-4 h-[calc(100%-0.75rem)] w-px bg-border" /> : null}
      <span aria-hidden className={`mt-1.5 h-2 w-2 justify-self-center rounded-full ring-4 ring-background ${dotTone[item.tone ?? "neutral"]}`} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-sm font-medium text-foreground">{item.title}</span>
          {item.time ? <span className="text-xs tabular-nums text-muted-foreground">{item.time}</span> : null}
        </div>
        {item.description ? <div className="text-sm text-muted-foreground">{item.description}</div> : null}
      </div>
    </li>)}
  </ol>;
}
