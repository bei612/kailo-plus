// DD-170 (.design/20 §16.3, §16.5, §16.6): the pieces the Agent area (definitions, installations,
// Skills, tools, connectors, memory) shares on top of the platform presentation kit. Details read
// as a header, facts, sections and a collapsed technical block; secondary actions sit in one
// "More" menu; owners are people's names, never Principal IDs; long text is collapsible.
import { Fragment, type ReactNode, useState } from "react";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import { ErrorClass, type ConversationParticipantPage } from "@client-kit/contracts";
import { BffError } from "../../transport";
import type { BffClient } from "../../client";
import { useBffClient, useCurrentPrincipalId, useT } from "../context";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../sidebar/dropdown-menu";
import { IdText, KeyValueList } from "../key-value";
import { useLoad } from "../use-load";

export type MoreItem = {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  /** Destructive entries are drawn in the danger colour after a separator (§16.6(4)). */
  danger?: boolean;
  disabled?: boolean;
  testId?: string;
};

/** The "More" menu of a detail header or a table row. Renders nothing without entries. */
export function MoreMenu({ items, label, disabled, testId }: {
  items: readonly (MoreItem | false | null | undefined)[];
  label?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const t = useT();
  const shown = items.filter((item): item is MoreItem => !!item);
  if (shown.length === 0) return null;
  const safe = shown.filter((item) => !item.danger);
  const danger = shown.filter((item) => item.danger);
  const text = label ?? t("agents.ui.more");
  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <button type="button" aria-label={text} title={text} disabled={disabled} data-testid={testId}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-input bg-background text-muted-foreground shadow-xs hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50">
        <MoreHorizontal aria-hidden className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-44">
      {[...safe, ...danger].map((item, index) => <Fragment key={item.key}>
        {item.danger && index === safe.length && safe.length > 0 ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem disabled={item.disabled} data-testid={item.testId}
          className={item.danger ? "text-destructive focus:text-destructive" : undefined}
          onSelect={() => item.onSelect()}>{item.label}</DropdownMenuItem>
      </Fragment>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

/**
 * §16.3(2): identifiers, digests and wire values for support, collapsed by default and copyable.
 * Rows without a value are omitted.
 */
export function TechnicalDetails({ items, testId }: {
  items: readonly ({ label: ReactNode; value: string | undefined | null; id?: string } | false | null | undefined)[];
  testId?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rows = items.filter((item): item is { label: ReactNode; value: string; id?: string } => !!item && !!item.value);
  if (rows.length === 0) return null;
  return <div className="flex min-w-0 flex-col gap-2" data-testid={testId ?? "technical-details"}>
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
      className="inline-flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
      <ChevronRight aria-hidden className={`h-4 w-4 transition-transform duration-[140ms] ${open ? "rotate-90" : ""}`} strokeWidth={1.75} />
      {t("agents.ui.technical")}
    </button>
    {open ? <KeyValueList items={rows.map((row, index) => ({
      id: row.id ?? String(index), label: row.label,
      value: <IdText value={row.value} label={typeof row.label === "string" ? row.label : undefined} />,
    }))} /> : null}
  </div>;
}

/** Long free text (instructions, Skill content) clamped to a few lines with "Show full text". */
export function ExpandableText({ text, testId }: { text: string; testId?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const long = text.length > 280 || text.split("\n").length > 6;
  return <div className="flex min-w-0 flex-col gap-1.5" data-testid={testId}>
    <pre className={`whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 p-3 font-sans text-sm leading-6 text-foreground ${long && !open ? "max-h-36 overflow-hidden" : ""}`}>{text}</pre>
    {long ? <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
      className="w-fit text-sm text-brand-text hover:underline">{t(open ? "agents.ui.collapse" : "agents.ui.expand")}</button> : null}
  </div>;
}

// The organization's people directory (the same authorized read the author pickers use),
// read once per client and reused briefly so several cards do not each read it.
const directories = new WeakMap<BffClient, { at: number; names: Promise<Map<string, string>> }>();
const DIRECTORY_TTL_MS = 60_000;

async function readDirectory(client: BffClient): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result: ConversationParticipantPage = await client.conversationParticipants(cursor);
    if (!result || !Array.isArray(result.items)) break;
    for (const person of result.items) {
      if (person && typeof person.principalId === "string" && typeof person.displayName === "string" && person.displayName.trim())
        names.set(person.principalId, person.displayName.trim());
    }
    const next = result.nextCursor;
    if (typeof next !== "string" || !next || seen.has(next)) break;
    seen.add(next);
    cursor = next;
  }
  return names;
}

function directory(client: BffClient): Promise<Map<string, string>> {
  const cached = directories.get(client);
  if (cached && Date.now() - cached.at < DIRECTORY_TTL_MS) return cached.names;
  const names = readDirectory(client).catch(() => new Map<string, string>());
  directories.set(client, { at: Date.now(), names });
  return names;
}

/**
 * §16.3(3): a principal as a person's name. The current person reads as "You"; a principal the
 * directory cannot name reads as "Unknown member" — the ID itself only appears in technical details.
 */
export function usePrincipalName(principalId: string | undefined, known?: string): { name: string; pending: boolean } {
  const client = useBffClient();
  const t = useT();
  const self = useCurrentPrincipalId();
  const needed = !!principalId && !known?.trim() && principalId !== self;
  const [state] = useLoad(`principal-name:${needed ? principalId : ""}`, () => needed ? directory(client) : Promise.resolve(null));
  if (known?.trim()) return { name: known.trim(), pending: false };
  if (!principalId) return { name: t("agents.ui.unknownMember"), pending: false };
  if (principalId === self) return { name: t("agents.ui.you"), pending: false };
  if (state.status === "pending") return { name: "", pending: true };
  const name = state.status === "ok" ? state.data?.get(principalId) : undefined;
  return { name: name ?? t("agents.ui.unknownMember"), pending: false };
}

/** Inline name of a principal for key–value rows and subtitles. */
export function PrincipalName({ principalId, known }: { principalId: string | undefined; known?: string }) {
  const { name, pending } = usePrincipalName(principalId, known);
  return pending ? <span aria-hidden className="inline-block h-3 w-20 animate-pulse rounded bg-muted align-middle motion-reduce:animate-none" /> : <>{name}</>;
}

/** A card-like block for a section body (white card, hairline, padding). */
export function SectionCard({ children, testId }: { children: ReactNode; testId?: string }) {
  return <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4" data-testid={testId}>{children}</div>;
}

/**
 * A read failure as ErrorState should classify it: an UNKNOWN reply, or one whose error class this
 * client does not know, proves nothing — it is shown as "could not load" (retry), never as "no
 * access" and never with a reason that reads like a decision.
 */
export function classifiedError(error: unknown): unknown {
  return error instanceof BffError && error.errorClass !== undefined
    && (error.errorClass === ErrorClass.Unknown || !Object.values(ErrorClass).includes(error.errorClass)) ? undefined : error;
}
