// DD-158(2): the deployment operator reads and triages Core-owned private submissions.
// DD-170 (.design/20 §16): a filtered table with total and paging (the offset-paged read is
// collected to its end, bounded), a detail view with facts, the message, structured
// diagnostics and the attachment; refusal, failure and loading each have their own state.
import { FeedbackCategory, FeedbackClient, FeedbackState, type PlatformFeedbackView } from "@client-kit/contracts";
import { type ReactNode, useEffect, useState } from "react";
import { relativeTime } from "../../format";
import type { PlatformMessageKey } from "../../i18n";
import { TransportError } from "../../transport";
import { useBffClient, useLocale, useT } from "../context";
import { Badge, Button, type Tone } from "../ui";
import { CellStack, DataTable, type DataColumn } from "../data-table";
import { EmptyState, ErrorState, PermissionState, readRefusal, TableSkeleton } from "../state-views";
import { IdText, KeyValueList, RawData, StructuredValue, Tag } from "../key-value";
import { DetailHeader, FilterChips, PageSection, RefreshButton } from "../page-layout";
import { useOffsetCollection } from "../use-offset-collection";
import { OutcomeNotice, PRIMARY_ACTION_CLASS } from "../roles";

type Filter = "all" | FeedbackState;

const stateLabel: Record<FeedbackState, PlatformMessageKey> = {
  [FeedbackState.New]: "platform.feedback.new",
  [FeedbackState.Triaged]: "platform.feedback.triaged",
  [FeedbackState.Closed]: "platform.feedback.closed",
};
const stateTone: Record<FeedbackState, Tone> = {
  [FeedbackState.New]: "info", [FeedbackState.Triaged]: "warning", [FeedbackState.Closed]: "neutral",
};
const categoryLabel: Record<FeedbackCategory, PlatformMessageKey> = {
  [FeedbackCategory.Bug]: "platform.feedback.bug",
  [FeedbackCategory.Praise]: "platform.feedback.praise",
  [FeedbackCategory.NeedsWork]: "platform.feedback.needsWork",
};
const clientLabel: Record<FeedbackClient, PlatformMessageKey> = {
  [FeedbackClient.Web]: "adminArea.feedback.client.web",
  [FeedbackClient.Desktop]: "adminArea.feedback.client.desktop",
  [FeedbackClient.Mobile]: "adminArea.feedback.client.mobile",
};

function validRow(row: PlatformFeedbackView): boolean {
  return !!row && typeof row.feedbackId === "string" && typeof row.message === "string"
    && Number.isSafeInteger(row.version) && Object.values(FeedbackState).includes(row.state);
}

/** Diagnostics are a JSON document when they parse as one; otherwise their raw text. */
function Diagnostics({ text }: { text: string }) {
  let value: unknown = null;
  try { value = JSON.parse(text); } catch { value = null; }
  return value !== null && typeof value === "object"
    ? <div className="flex flex-col gap-2"><StructuredValue value={value} /><RawData value={text} /></div>
    : <RawData value={text} />;
}

export function PlatformFeedback() {
  const api = useBffClient(), t = useT(), locale = useLocale();
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string>();
  const [failed, setFailed] = useState(false), [images, setImages] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const { state: loaded, reload, loadMore } = useOffsetCollection(`platform-feedback:${filter}`, async (offset) => {
    const page = await api.platformFeedback(offset, filter === "all" ? undefined : (filter as `${FeedbackState}`));
    if (!page || !Array.isArray(page.items) || page.items.some((row) => !validRow(row))) throw new TransportError("Invalid feedback page");
    return { items: page.items, nextOffset: page.nextOffset };
  });
  useEffect(() => { setFailed(false); }, [filter]);
  const refresh = () => { setFailed(false); reload(); };

  const section = (body: ReactNode) => <PageSection id="admin-feedback" title={t("platform.feedback.operatorTitle")}
    description={t("adminArea.feedback.description")} testId="platform-feedback">{body}</PageSection>;
  if (loaded.status === "pending") return section(<TableSkeleton rows={5} columns={5} />);
  if (loaded.status === "error") {
    const refusal = readRefusal(loaded.error);
    if (refusal === "denied") return <PermissionState description={t("adminArea.feedback.deniedBody")} />;
    if (refusal === "missing") return <EmptyState title={t("adminArea.unavailableTitle")} description={t("adminArea.unavailableBody")} />;
    return section(<ErrorState error={loaded.error} onRetry={reload} />);
  }
  const rows = loaded.data.items;

  async function triage(id: string, version: number, state: FeedbackState) {
    setBusy(id); setFailed(false);
    try {
      const result = await api.triageFeedback(id, { version, state });
      if (result.feedbackId !== id || result.state !== state || result.version !== version + 1) throw new TransportError("Invalid feedback state");
      reload();
    } catch { setFailed(true); } finally { setBusy(undefined); }
  }
  async function image(id: string) {
    setBusy(id); setFailed(false);
    try {
      const result = await api.feedbackAttachment(id);
      if (!["image/png","image/jpeg","image/webp"].includes(result.mimeType) || !/^[a-f0-9]{64}$/.test(result.sha256)
          || typeof result.dataBase64 !== "string" || result.dataBase64.length > 2_796_204) throw new TransportError("Invalid feedback attachment");
      setImages(current => ({ ...current, [id]: `data:${result.mimeType};base64,${result.dataBase64}` }));
    } catch { setFailed(true); } finally { setBusy(undefined); }
  }

  const category = (row: PlatformFeedbackView) => row.category ? t(categoryLabel[row.category]) : t("adminArea.feedback.uncategorized");
  const source = (row: PlatformFeedbackView) => clientLabel[row.client] ? t(clientLabel[row.client]) : row.client;
  const columns: DataColumn<PlatformFeedbackView>[] = [
    { key: "message", header: t("adminArea.feedback.message"), truncate: true, title: (row) => row.message,
      cell: (row) => <CellStack primary={row.message.split("\n")[0]} secondary={row.tenantName} /> },
    { key: "category", header: t("adminArea.feedback.category"), width: "7.5rem", sortValue: category, cell: (row) => <Tag>{category(row)}</Tag> },
    { key: "client", header: t("adminArea.feedback.client"), width: "6.5rem", secondary: true, sortValue: source,
      cell: (row) => <span className="whitespace-nowrap text-muted-foreground">{source(row)}</span> },
    { key: "state", header: t("platform.state"), width: "7rem", sortValue: (row) => t(stateLabel[row.state]),
      cell: (row) => <Badge tone={stateTone[row.state]}>{t(stateLabel[row.state])}</Badge> },
    { key: "created", header: t("adminArea.feedback.submitted"), width: "8rem", align: "end", sortValue: (row) => Date.parse(row.createdAt),
      title: (row) => new Date(row.createdAt).toLocaleString(locale),
      cell: (row) => <span className="whitespace-nowrap text-muted-foreground">{relativeTime(locale, row.createdAt)}</span> },
  ];
  const options = [
    { value: "all" as const, label: t("adminArea.filterAll") },
    ...[FeedbackState.New, FeedbackState.Triaged, FeedbackState.Closed].map((value) => ({ value, label: t(stateLabel[value]) })),
  ];
  const open = openId ? rows.find((row) => row.feedbackId === openId) : undefined;
  const failure = failed ? <OutcomeNotice tone="alert">{t("platform.feedback.operatorFailed")}</OutcomeNotice> : null;

  return <>
    {open ? <div className="flex min-w-0 flex-col gap-6" data-testid="platform-feedback-detail">
      <DetailHeader onBack={() => setOpenId(null)} title={t("adminArea.feedback.detailTitle", { organization: open.tenantName })}
        status={<Badge tone={stateTone[open.state]}>{t(stateLabel[open.state])}</Badge>}
        subtitle={`${source(open)} · ${relativeTime(locale, open.createdAt)}`}
        actions={open.state !== FeedbackState.Closed ? <Button className={PRIMARY_ACTION_CLASS} disabled={Boolean(busy) || failed}
          onClick={() => void triage(open.feedbackId, open.version, open.state === FeedbackState.New ? FeedbackState.Triaged : FeedbackState.Closed)}>
          {t(open.state === FeedbackState.New ? "platform.feedback.markTriaged" : "platform.feedback.markClosed")}</Button> : undefined} />
      {failure}
      <KeyValueList columns={2} items={[
        { id: "org", label: t("adminArea.feedback.organization"), value: open.tenantName },
        { id: "category", label: t("adminArea.feedback.category"), value: category(open) },
        { id: "client", label: t("adminArea.feedback.client"), value: source(open) },
        { id: "created", label: t("adminArea.feedback.submitted"), value: new Date(open.createdAt).toLocaleString(locale) },
        { id: "id", label: t("adminArea.feedback.id"), value: <IdText value={open.feedbackId} label={t("adminArea.feedback.id")} /> },
      ]} />
      <PageSection title={t("adminArea.feedback.message")}>
        <p className="whitespace-pre-wrap break-words rounded-xl border border-border bg-card p-4 text-sm leading-6">{open.message}</p>
      </PageSection>
      {open.diagnostics ? <PageSection title={t("platform.feedback.diagnostics")}><Diagnostics text={open.diagnostics} /></PageSection> : null}
      {open.attachment ? <PageSection title={t("adminArea.feedback.attachment")}>
        {images[open.feedbackId] ? <img src={images[open.feedbackId]} alt={t("platform.feedback.image")} className="max-h-96 max-w-full rounded-xl border border-border object-contain"/>
          : <Button className="w-fit" disabled={Boolean(busy)} onClick={() => void image(open.feedbackId)}>{t("platform.feedback.image")}</Button>}
      </PageSection> : null}
    </div> : null}
    <div hidden={!!open}>
      {section(<>
        {open ? null : failure}
        {rows.length === 0 && filter === "all" ? <EmptyState title={t("adminArea.feedback.emptyTitle")} description={t("adminArea.feedback.emptyBody")} />
          : <DataTable label={t("adminArea.feedback.listLabel")} rows={rows} columns={columns} rowKey={(row) => row.feedbackId}
            onRowClick={(row) => setOpenId(row.feedbackId)} selectedKey={openId}
            search={{ placeholder: t("adminArea.feedback.search"), text: (row) => `${row.tenantName} ${row.message}` }}
            toolbar={<><FilterChips label={t("adminArea.filterStatus")} value={filter} options={options} onChange={(value) => { setFilter(value); setOpenId(null); }} />
              <RefreshButton onClick={refresh} /></>}
            partial={loaded.data.complete ? undefined : <button type="button" className="text-brand-text hover:underline" onClick={loadMore}>
              {t("list.partial", { count: String(rows.length) })} · {t("list.loadMore")}</button>}
            empty={<EmptyState compact title={t("list.noMatch")} action={<button type="button" className="text-sm text-brand-text hover:underline" onClick={() => setFilter("all")}>{t("list.clearSearch")}</button>} />} />}
      </>)}
    </div>
  </>;
}
