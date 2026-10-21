// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/PersonaShareDialog.tsx
// (SnapshotShareDialog + PersonaShareDialog). DD-131(7): "send to people" is the governed snapshot
// export (owner approval, ExportPackage) sent as an ordinary attachment in a same-Tenant direct
// message; "Copy link" copies a Tenant-internal link only (no public link, so the original
// "Anyone with the link can view it" warning has nothing to warn about). The "What's included"
// memory level, its plaintext-memory warning and confirmation are not rendered (DD-131(4)).
// "Share to catalog" is `agent.definition.share/unshare` (DD-131(6)): same-Tenant discover/read
// only, it grants no Installation use.
import * as React from "react";
import { BookUser, Check, ChevronRight, Download, Link2, X } from "lucide-react";
import { toast } from "sonner";

import type { AgentDefinitionView, ConversationParticipant, ExportPackageView } from "@client-kit/contracts";
import { Button } from "../profile/buzz/shared/ui/button";
import { Spinner } from "../profile/buzz/shared/ui/spinner";
import { Switch } from "../switch";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../composer/shared/ui/dialog";
import { useBffClient, useCurrentPrincipalId, useUiT } from "../context";
import { useConversationOpen } from "../conversations/use-conversations";
import { PersonaShareRecipients } from "./PersonaShareRecipients";
import { SnapshotExportProgress } from "./SnapshotExportProgress";
import { useSnapshotSendController } from "./useSnapshotSendController";
import { useExportApprovalRole, useSnapshotExport, type SnapshotExportTarget } from "./useSnapshotExport";
import { downloadExportPackage, type SnapshotFile } from "./snapshotFlow";
import type { AgentSnapshotHost } from "./agentSnapshotHost";

const COPY_FEEDBACK_RESET_MS = 1500;
type CopyStatus = "idle" | "copying" | "copied";

export type CatalogShareControl = {
  shared: boolean;
  pending: boolean;
  problem: string | null;
  onChange: (shared: boolean) => void;
};

type SnapshotShareDialogProps = {
  beforeExport?: React.ReactNode;
  displayName: string;
  target: SnapshotExportTarget;
  host: AgentSnapshotHost;
  isPending: boolean;
  /** Why this item cannot be exported right now (e.g. no published version). */
  unavailable?: string | null;
  onExport: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  snapshotKind: "agent" | "team";
  testIdPrefix: string;
};

export function SnapshotShareDialog({
  beforeExport,
  displayName,
  target,
  host,
  isPending,
  unavailable = null,
  onExport,
  onOpenChange,
  open,
  snapshotKind,
  testIdPrefix,
}: SnapshotShareDialogProps) {
  const t = useUiT();
  const client = useBffClient();
  const principalId = useCurrentPrincipalId();
  const exporter = useSnapshotExport(target);
  const role = useExportApprovalRole(target);
  const [recipients, setRecipients] = React.useState<ConversationParticipant[]>([]);
  const opening = useConversationOpen(principalId ?? "", recipients);
  const controller = useSnapshotSendController(host.sendAttachment);
  const [copyStatus, setCopyStatus] = React.useState<CopyStatus>("idle");
  const [pendingAction, setPendingAction] = React.useState<"send" | "copy" | null>(null);
  const fileCache = React.useRef(new Map<string, Promise<SnapshotFile>>());

  const isSending = ["preparing", "uploading", "sending"].includes(controller.state.phase);
  const isCopying = copyStatus === "copying";
  const exporting = exporter.busy || exporter.holdsIntent || pendingAction !== null;
  const isActionPending = isPending || isCopying || isSending || exporting;
  const hasSelectedRecipients = recipients.length > 0;
  const itemLabel = snapshotKind === "team" ? t("agentSnapshots.itemTeam") : t("agentSnapshots.itemAgent");

  React.useEffect(() => {
    if (open) {
      fileCache.current.clear();
      setCopyStatus("idle");
      setPendingAction(null);
      controller.reset();
      exporter.reset();
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: reset once per open
  }, [open]);

  React.useEffect(() => {
    if (copyStatus !== "copied") return;
    const timer = window.setTimeout(() => setCopyStatus("idle"), COPY_FEEDBACK_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  const getFile = React.useCallback((pkg: ExportPackageView) => {
    const cached = fileCache.current.get(pkg.assetId);
    if (cached) return cached;
    const pending = downloadExportPackage(client, pkg).catch((error: unknown) => {
      if (fileCache.current.get(pkg.assetId) === pending) fileCache.current.delete(pkg.assetId);
      throw error;
    });
    fileCache.current.set(pkg.assetId, pending);
    return pending;
  }, [client]);

  const copyLink = React.useCallback(async (pkg: ExportPackageView) => {
    if (!host.copyLink) return;
    setCopyStatus("copying");
    try {
      await host.copyLink(await getFile(pkg), pkg);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("idle");
      toast.error(t("agentSnapshots.copyFailed"));
    }
  }, [host, getFile, t]);

  const sendToRecipients = React.useCallback(async (pkg: ExportPackageView) => {
    if (recipients.length === 0) return;
    let file: SnapshotFile;
    try {
      file = await getFile(pkg);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("agentSnapshots.sendFailed", { item: itemLabel }));
      return;
    }
    const sent = await controller.beginSend(file, () => opening.prepareConversation(recipients), displayName);
    if (sent) {
      toast.success(t("agentSnapshots.sentCopy", { name: displayName }));
      onOpenChange(false);
    } else if (sent === false) {
      toast.error(controller.getCurrentError() ?? t("agentSnapshots.sendFailed", { item: itemLabel }));
    }
  }, [recipients, getFile, controller, opening, displayName, onOpenChange, t, itemLabel]);

  // A requested send or copy continues once Core has generated the approved package.
  const ready = exporter.state.phase === "ready" ? exporter.state.pkg : null;
  React.useEffect(() => {
    if (!ready || !pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    void (action === "copy" ? copyLink(ready) : sendToRecipients(ready));
  }, [ready, pendingAction, copyLink, sendToRecipients]);
  React.useEffect(() => {
    if (pendingAction && (exporter.state.phase === "refused" || exporter.state.phase === "stalled")) setPendingAction(null);
  }, [pendingAction, exporter.state.phase]);

  function request(action: "send" | "copy") {
    if (isActionPending && !(controller.state.phase === "unknown" && action === "send")) return;
    if (ready) { void (action === "copy" ? copyLink(ready) : sendToRecipients(ready)); return; }
    setPendingAction(action);
    if (exporter.state.phase === "idle" || exporter.state.phase === "refused") { exporter.reset(); exporter.start("png"); }
  }

  function handleDialogOpenChange(nextOpen: boolean) {
    if (!nextOpen && (isCopying || isSending || exporter.holdsIntent || controller.state.phase === "unknown")) return;
    onOpenChange(nextOpen);
  }

  const copyStatusLabel = copyStatus === "copying" ? t("agentSnapshots.copying") : copyStatus === "copied" ? t("agentSnapshots.copied") : t("agentSnapshots.copyLink");
  const unknownSend = controller.state.phase === "unknown";

  return (
    <Dialog onOpenChange={handleDialogOpenChange} open={open}>
      <DialogContent className="max-w-xl gap-3 bg-transparent p-0 shadow-none" data-testid={`${testIdPrefix}-dialog`} showCloseButton={false}>
        <div className="relative rounded-2xl bg-background p-6 pb-4 shadow-2xl" data-testid={`${testIdPrefix}-main-card`}>
          <DialogHeader>
            <DialogTitle className="min-w-0 truncate pr-10">{t("agentSnapshots.shareTitle", { name: displayName })}</DialogTitle>
            <DialogDescription data-testid={`${testIdPrefix}-share-description`}>
              {t("agentSnapshots.shareDescription", { item: itemLabel })}
            </DialogDescription>
          </DialogHeader>
          <DialogClose
            className="absolute right-4 top-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 ease-out hover:bg-accent hover:text-accent-foreground focus:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-100"
            disabled={isCopying || isSending || exporter.holdsIntent || unknownSend}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">{t("buzz.close")}</span>
          </DialogClose>

          <div className="space-y-4 pt-4">
            <div className="flex items-start gap-2">
              {principalId ? (
                <PersonaShareRecipients currentPrincipalId={principalId} disabled={isPending || isSending || unknownSend}
                  onSelectionChange={setRecipients} open={open} testIdPrefix={testIdPrefix} />
              ) : <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t("agentSnapshots.sendUnavailable")}</p>}
              {hasSelectedRecipients ? (
                <div className="shrink-0" data-testid={`${testIdPrefix}-send-motion`}>
                  <Button className="h-10" data-testid={`${testIdPrefix}-send`}
                    disabled={unavailable !== null || (isActionPending && !unknownSend)} onClick={() => request("send")} type="button">
                    {isSending || pendingAction === "send" ? t("agentSnapshots.sending") : unknownSend ? t("agents.retry") : t("agentSnapshots.send")}
                  </Button>
                </div>
              ) : null}
            </div>

            {unavailable ? <p className="text-sm text-muted-foreground" role="status">{unavailable}</p> : null}
            <SnapshotExportProgress exporter={exporter} role={role} testIdPrefix={testIdPrefix} />
            {opening.notice ? <p className="text-sm text-muted-foreground" role="status">{opening.notice}</p> : null}
            {controller.state.phase === "unknown" || controller.state.phase === "error" ? (
              <p className="text-sm text-destructive" data-testid={`${testIdPrefix}-send-error`} role={controller.state.phase === "unknown" ? "status" : "alert"}>
                {controller.state.phase === "unknown" ? t("agentSnapshots.sendUnknown") : controller.state.error}
              </p>
            ) : null}

            {host.copyLink ? <>
              <div className="h-px w-full bg-input/40" data-testid={`${testIdPrefix}-link-divider`} role="separator" />
              <div className="flex items-center justify-between gap-3" data-testid={`${testIdPrefix}-link-row`}>
                <p className="text-xs text-muted-foreground">{t("agentSnapshots.linkScope")}</p>
                <Button
                  className="shrink-0 border-border shadow-none disabled:opacity-100"
                  data-copy-status={copyStatus}
                  data-testid={`${testIdPrefix}-copy-link`}
                  disabled={unavailable !== null || isActionPending}
                  onClick={() => request("copy")}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <span aria-live="polite" className="sr-only">{copyStatusLabel}</span>
                  <span aria-hidden="true" className="flex items-center justify-center gap-1.5" data-testid={`${testIdPrefix}-copy-link-state`}>
                    {copyStatus === "copying" ? <Spinner aria-hidden="true" className="h-4 w-4 border-2" />
                      : copyStatus === "copied" ? <Check aria-hidden="true" className="h-4 w-4" />
                      : <Link2 aria-hidden="true" className="h-4 w-4" />}
                    <span>{copyStatusLabel}</span>
                  </span>
                </Button>
              </div>
            </> : null}
          </div>
        </div>
        {beforeExport}
        <button
          className="relative flex min-h-14 w-full items-center gap-3 rounded-2xl bg-background px-5 py-4 text-left text-sm font-medium shadow-2xl outline-hidden transition-colors hover:bg-muted focus-visible:bg-muted disabled:cursor-default disabled:opacity-100"
          data-testid={`${testIdPrefix}-export`}
          disabled={isActionPending}
          onClick={onExport}
          type="button"
        >
          <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">{t("agentSnapshots.exportItem", { item: itemLabel })}</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DialogContent>
    </Dialog>
  );
}

/** Original "Share to catalog" card; the switch is the governed share/unshare submission. */
export function CatalogShareSection({ control, testIdPrefix, description }: {
  control: CatalogShareControl;
  testIdPrefix: "persona-share" | "team-share";
  description: string;
}) {
  const t = useUiT();
  return (
    <section className="relative flex min-h-16 w-full flex-col gap-2 rounded-2xl bg-background px-5 py-4 shadow-2xl" data-testid={`${testIdPrefix}-catalog`}>
      <div className="flex items-center gap-3">
        <BookUser className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{t("agentCatalog.shareTitle")}</h3>
          <p className="text-xs text-secondary-foreground/75">{description}</p>
        </div>
        <Switch
          aria-label={t("agentCatalog.shareTitle")}
          checked={control.shared}
          data-testid={`${testIdPrefix}-catalog-access`}
          disabled={control.pending}
          onCheckedChange={(checked) => control.onChange(checked)}
          style={{ cursor: "default" }}
        />
      </div>
      {control.problem ? <p className="text-xs text-muted-foreground" role="status">{control.problem}</p> : null}
    </section>
  );
}

type PersonaShareDialogProps = {
  definition: AgentDefinitionView;
  displayName: string;
  host: AgentSnapshotHost;
  /** Present for the Definition owner; the switch is absent otherwise. */
  catalog: CatalogShareControl | null;
  isPending: boolean;
  onExport: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function PersonaShareDialog({ definition, displayName, host, catalog, isPending, onExport, onOpenChange, open }: PersonaShareDialogProps) {
  const t = useUiT();
  const target = React.useMemo<SnapshotExportTarget>(() => ({ kind: "agent", definition }), [definition]);
  return (
    <SnapshotShareDialog
      beforeExport={catalog ? <CatalogShareSection control={catalog} description={t("agentCatalog.shareAgentDescription")} testIdPrefix="persona-share" /> : null}
      displayName={displayName}
      host={host}
      isPending={isPending}
      onExport={onExport}
      onOpenChange={onOpenChange}
      open={open}
      snapshotKind="agent"
      target={target}
      testIdPrefix="persona-share"
      unavailable={definition.currentPublishedVersionAssetId ? null : t("agentSnapshots.exportNeedsPublished")}
    />
  );
}
