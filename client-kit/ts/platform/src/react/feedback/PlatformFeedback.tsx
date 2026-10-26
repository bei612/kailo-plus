// DD-158(2): the deployment operator reads and triages Core-owned private submissions.
import { FeedbackState } from "@client-kit/contracts";
import { useEffect, useState } from "react";
import { BffError, TransportError } from "../../transport";
import { useBffClient, useT } from "../context";
import { Button, ReadFailure } from "../ui";
import { useLoad } from "../use-load";

export function PlatformFeedback() {
  const api = useBffClient(), t = useT();
  const [offset, setOffset] = useState(0), [busy, setBusy] = useState<string>();
  const [failed, setFailed] = useState(false), [images, setImages] = useState<Record<string, string>>({});
  const [loaded, reload] = useLoad(`platform-feedback:${offset}`, () => api.platformFeedback(offset));
  useEffect(() => { setImages({}); setFailed(false); }, [offset]);
  if (loaded.status === "pending") return <p>{t("platform.loading")}</p>;
  if (loaded.status === "error") return loaded.error instanceof BffError && [403,404].includes(loaded.error.status)
    ? null : <ReadFailure error={loaded.error} onRetry={reload}/>;
  const page = loaded.data;
  if (!page || !Array.isArray(page.items) || page.items.some(row => !row || typeof row.feedbackId !== "string"
      || typeof row.message !== "string" || !Number.isSafeInteger(row.version) || !Object.values(FeedbackState).includes(row.state)))
    return <ReadFailure error={new TransportError("Invalid feedback page")} onRetry={reload}/>;
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
  return <section className="space-y-4 p-4" data-testid="platform-feedback">
    <div className="flex items-center justify-between"><h2 className="font-medium">{t("platform.feedback.operatorTitle")}</h2><Button onClick={() => { setFailed(false); reload(); }}>{t("platform.feedback.refresh")}</Button></div>
    {failed ? <p role="alert">{t("platform.feedback.operatorFailed")}</p> : null}
    {page.items.length === 0 ? <p className="text-sm text-muted-foreground">{t("platform.feedback.empty")}</p> : null}
    {page.items.map(row => <article key={row.feedbackId} className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{row.tenantName}</h3>
        <span className="text-xs text-muted-foreground">{row.client} · {new Date(row.createdAt).toLocaleString()}</span></div>
      <div className="text-sm">{row.category ? t(row.category === "BUG" ? "platform.feedback.bug" : row.category === "PRAISE" ? "platform.feedback.praise" : "platform.feedback.needsWork") : null}
        <span className="ml-3">{t(row.state === FeedbackState.New ? "platform.feedback.new" : row.state === FeedbackState.Triaged ? "platform.feedback.triaged" : "platform.feedback.closed")}</span></div>
      <p className="whitespace-pre-wrap break-words text-sm">{row.message}</p>
      {row.diagnostics ? <details><summary className="cursor-pointer text-sm">{t("platform.feedback.diagnostics")}</summary><pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{row.diagnostics}</pre></details> : null}
      {row.attachment ? images[row.feedbackId] ? <img src={images[row.feedbackId]} alt={t("platform.feedback.image")} className="max-h-80 max-w-full object-contain"/>
        : <Button disabled={Boolean(busy)} onClick={() => void image(row.feedbackId)}>{t("platform.feedback.image")}</Button> : null}
      {row.state !== FeedbackState.Closed ? <Button disabled={Boolean(busy) || failed} onClick={() => void triage(row.feedbackId, row.version, row.state === FeedbackState.New ? FeedbackState.Triaged : FeedbackState.Closed)}>
        {t(row.state === FeedbackState.New ? "platform.feedback.markTriaged" : "platform.feedback.markClosed")}</Button> : null}
    </article>)}
    <div className="flex gap-2"><Button disabled={offset === 0 || Boolean(busy)} onClick={() => setOffset(Math.max(0,offset-25))}>{t("platform.feedback.previous")}</Button>
      <Button disabled={page.nextOffset === undefined || Boolean(busy)} onClick={() => { if (page.nextOffset !== undefined) setOffset(page.nextOffset); }}>{t("platform.feedback.next")}</Button></div>
  </section>;
}
