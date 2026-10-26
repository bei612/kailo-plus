// Buzz 779af8886caae1317b4de962082429867ab61503 SendFeedbackDialog: category pills,
// side-by-side message/image, diagnostics opt-in. DD-158 sends only to Core.
import { Bug, ImageIcon, ThumbsUp, Wrench, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FeedbackCategory, FeedbackClient, type FeedbackSubmissionRequest } from "@client-kit/contracts";
import { useBffClient, useFeedbackEnvironment, useT } from "../context";
import { newIdempotencyKey } from "../../governance";
import { BffError, isOutcomeUnknown, TransportError } from "../../transport";
import { Button } from "../profile/buzz/shared/ui/button";
import { Textarea } from "../profile/buzz/shared/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../composer/shared/ui/dialog";
import { useEmojiBurst } from "../profile/buzz/shared/ui/EmojiBurstProvider";

export function SendFeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const api = useBffClient(), t = useT(), environment = useFeedbackEnvironment();
  const { burstEmoji } = useEmojiBurst();
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => { if (!open) setPreviewOpen(false); }, [open]);
  const [category, setCategory] = useState<FeedbackCategory>();
  const [message, setMessage] = useState("");
  const [image, setImage] = useState<{ url: string; attachment: NonNullable<FeedbackSubmissionRequest["attachment"]> }>();
  const [diagnostics, setDiagnostics] = useState<string>();
  const [includeDiagnostics, setIncludeDiagnostics] = useState(false);
  const [pending, setPending] = useState(false), [attaching, setAttaching] = useState(false);
  const [failed, setFailed] = useState(false), [unknown, setUnknown] = useState(false);
  const frozen = useRef<FeedbackSubmissionRequest | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const locked = pending || unknown;
  useEffect(() => {
    if (!open || diagnostics || !environment.getVersion) return;
    let disposed = false;
    void environment.getVersion().then(version => {
      if (!disposed) setDiagnostics(JSON.stringify({ appVersion: version, platform: navigator.platform,
        userAgent: navigator.userAgent, language: navigator.language, capturedAt: new Date().toISOString() }));
    }).catch(() => {});
    return () => { disposed = true; };
  }, [open, diagnostics, environment.getVersion]);

  async function attach(file: File | undefined) {
    if (!file) return;
    setAttaching(true); setFailed(false);
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024 || file.size === 0) throw new Error();
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file);
      });
      setImage({ url, attachment: { mimeType: file.type, dataBase64: url.slice(url.indexOf(",") + 1) } });
    } catch { setFailed(true); } finally { setAttaching(false); if (input.current) input.current.value = ""; }
  }
  async function submit() {
    if (pending || attaching || !message.trim()) return;
    setPending(true); setFailed(false);
    frozen.current ??= { idempotencyKey: newIdempotencyKey(),
      client: environment.client === "DESKTOP" ? FeedbackClient.Desktop : FeedbackClient.Web,
      message: message.trim(), ...(category ? { category } : {}), ...(image ? { attachment: image.attachment } : {}),
      ...(includeDiagnostics && diagnostics ? { diagnostics } : {}) };
    try {
      const receipt = await api.submitFeedback(frozen.current);
      if (!receipt || typeof receipt.feedbackId !== "string" || !/^[0-9a-f-]{36}$/i.test(receipt.feedbackId)
          || typeof receipt.createdAt !== "string" || !Number.isFinite(Date.parse(receipt.createdAt))) throw new TransportError("Invalid feedback receipt");
      frozen.current = undefined; setUnknown(false); setMessage(""); setCategory(undefined); setImage(undefined);
      setDiagnostics(undefined); setIncludeDiagnostics(false); onOpenChange(false);
    } catch (error) {
      const unresolved = isOutcomeUnknown(error) || (error instanceof BffError && error.status >= 500);
      setUnknown(unresolved); setFailed(true);
      if (!unresolved) frozen.current = undefined;
    } finally { setPending(false); }
  }
  return <Dialog open={open} onOpenChange={next => { if (!pending) onOpenChange(next); }}>
    <DialogContent className="max-w-xl gap-0 overflow-hidden border-0 px-6 pb-0 pt-6" aria-describedby={undefined} data-testid="send-feedback-dialog">
      <DialogHeader className="space-y-0 pb-5"><DialogTitle>{t("platform.feedback.title")}</DialogTitle>
        <p className="pt-2 text-sm text-muted-foreground">{t("platform.feedback.privacy")}</p></DialogHeader>
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <div className="flex flex-wrap items-center gap-2 pb-4">{([
          [FeedbackCategory.Bug, "platform.feedback.bug", Bug], [FeedbackCategory.Praise, "platform.feedback.praise", ThumbsUp],
          [FeedbackCategory.NeedsWork, "platform.feedback.needsWork", Wrench],
        ] as const).map(([value, label, Icon]) => <button key={value} type="button" aria-pressed={category === value} disabled={locked}
          className={`group/feedback-pill inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs ${category === value ? "border-primary/60 bg-primary/10" : "border-border/80 bg-background/80 hover:bg-muted/50"}`}
          onClick={event => { setCategory(category === value ? undefined : value); if (value === FeedbackCategory.Praise && category !== value) burstEmoji("❤️", event.currentTarget); }}>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted"><Icon className="h-4 w-4"/></span>{t(label)}</button>)}</div>
        <div className="flex items-stretch gap-3"><Textarea className="min-h-32 flex-1 resize-none" value={message} disabled={locked} data-testid="feedback-message"
          onChange={event => setMessage(event.target.value)} placeholder={t("platform.feedback.placeholder")}/>
          {image ? <div className="relative w-32 shrink-0 overflow-hidden rounded-lg border"><button type="button" aria-label={t("platform.feedback.image")} className="h-32 w-full" onClick={() => setPreviewOpen(true)}><img src={image.url} alt={t("platform.feedback.image")} className="h-32 w-full object-contain"/></button>
            <button type="button" disabled={locked} aria-label={t("platform.feedback.removeImage")} className="absolute right-1 top-1 rounded-full bg-background p-1" onClick={() => setImage(undefined)}><X className="h-4 w-4"/></button></div>
            : <button type="button" disabled={locked || attaching} className="flex w-32 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-3 text-sm"
              onClick={() => input.current?.click()}><ImageIcon className="h-5 w-5"/>{t("platform.feedback.attachImage")}</button>}
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => void attach(event.target.files?.[0])}/></div>
        <p className="mt-1 text-xs text-muted-foreground">{t("platform.feedback.limits")}</p>
        {diagnostics ? <div className="mt-4 space-y-2"><pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs" data-testid="feedback-diagnostics-preview">{diagnostics}</pre>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={locked} checked={includeDiagnostics} onChange={event => setIncludeDiagnostics(event.target.checked)}/>{t("platform.feedback.diagnosticsConsent")}</label></div> : null}
        {failed ? <p role="alert" className="mt-4 text-sm text-destructive">{t(unknown ? "platform.feedback.unknown" : "platform.feedback.failed")}</p> : null}
        <div className="flex justify-end gap-2 py-4"><Button type="button" variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>{t("platform.feedback.close")}</Button>
          <Button type="submit" disabled={pending || attaching || !message.trim() || [...message.trim()].length > 4000}>{t(pending ? "platform.feedback.sending" : unknown ? "platform.feedback.retry" : "platform.feedback.title")}</Button></div>
      </form>
    </DialogContent>
    {image ? <Dialog open={previewOpen} onOpenChange={setPreviewOpen}><DialogContent aria-describedby={undefined} className="max-w-4xl border-0 p-2" data-testid="feedback-attachment-preview">
      <DialogTitle className="sr-only">{t("platform.feedback.image")}</DialogTitle><img src={image.url} alt={t("platform.feedback.image")} className="max-h-[80vh] w-full rounded-lg bg-black/40 object-contain"/>
    </DialogContent></Dialog> : null}
  </Dialog>;
}
