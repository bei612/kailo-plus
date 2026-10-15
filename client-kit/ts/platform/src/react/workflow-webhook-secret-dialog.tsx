// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/workflows/ui/WorkflowWebhookSecretDialog.tsx::WorkflowWebhookSecretDialog,
// desktop/src/features/workflows/ui/WorkflowDialog.tsx "Continue without this secret?" confirmation,
// desktop/src/features/agents/ui/CopyButton.tsx::CopyButton.
// DD-116: the key is shown once after enable/rotate; the header label is
// replaced by the Standard Webhooks signing instructions (design 06 §9).
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Button } from "./profile/buzz/shared/ui/button";
import { cn } from "./profile/buzz/shared/lib/cn";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./composer/shared/ui/dialog";
import { MODAL_BACKDROP_BLUR_CLASS } from "./composer/shared/ui/modalBackdrop";
import { MODAL_CONTENT_MOTION_CLASS, MODAL_OVERLAY_MOTION_CLASS } from "./composer/shared/ui/modalMotion";
import { useClipboardWrite, useT } from "./context";

function CopyButton({ label, value }: { label: string; value: string }) {
  const copy = useClipboardWrite();
  return <Button onClick={() => { void copy(value); }} size="sm" type="button" variant="outline">
    <Copy className="h-4 w-4" />
    <span>{label}</span>
  </Button>;
}

export type WorkflowWebhookSecret = { automationResourceId: string; secret: string; url?: string };

export function WorkflowWebhookSecretDialog({ onContinue, secret }: {
  onContinue: () => void; secret: WorkflowWebhookSecret;
}) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return <>
    <Dialog open onOpenChange={(open) => { if (!open) setConfirming(true); }}>
      <DialogContent className="sm:max-w-lg" data-testid="workflow-webhook-secret-dialog">
        <DialogHeader>
          <DialogTitle>{t("workflows.webhook.title")}</DialogTitle>
          <DialogDescription>{t("workflows.webhook.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t("workflows.webhook.url")}</p>
            {secret.url ? <>
              <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-xs">{secret.url}</pre>
              <CopyButton label={t("workflows.webhook.copyUrl")} value={secret.url} />
            </> : <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">{t("workflows.webhook.urlUnavailable")}</p>}
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t("workflows.webhook.secret")}</p>
            <div className="flex items-center gap-2 rounded-md bg-muted/50 p-3">
              <code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs">{revealed ? secret.secret : "•".repeat(24)}</code>
              <Button aria-label={t(revealed ? "workflows.webhook.hide" : "workflows.webhook.reveal")}
                onClick={() => setRevealed((value) => !value)} size="icon-xs" type="button" variant="ghost">
                {revealed ? <EyeOff /> : <Eye />}
              </Button>
            </div>
            <CopyButton label={t("workflows.webhook.copySecret")} value={secret.secret} />
            <p className="text-xs text-muted-foreground">{t("workflows.webhook.signing")}</p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => setConfirming(true)} type="button">{t("workflows.webhook.continue")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <AlertDialog.Root open={confirming} onOpenChange={setConfirming}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={cn("fixed inset-0 z-50 bg-black/60", MODAL_OVERLAY_MOTION_CLASS, MODAL_BACKDROP_BLUR_CLASS)} />
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
          <AlertDialog.Content className={cn("pointer-events-auto grid w-[calc(100vw-2rem)] max-w-md gap-4 outline-hidden rounded-3xl bg-background p-6 shadow-2xl", MODAL_CONTENT_MOTION_CLASS)}>
            <div className="flex flex-col space-y-2 text-left">
              <AlertDialog.Title className="text-xl font-semibold tracking-tight">{t("workflows.webhook.leaveTitle")}</AlertDialog.Title>
              <AlertDialog.Description className="text-sm text-muted-foreground">{t("workflows.webhook.leaveDescription")}</AlertDialog.Description>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialog.Cancel asChild><Button type="button" variant="outline">{t("workflows.webhook.goBack")}</Button></AlertDialog.Cancel>
              <AlertDialog.Action asChild><Button onClick={onContinue} type="button" variant="destructive">{t("workflows.webhook.continue")}</Button></AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  </>;
}
