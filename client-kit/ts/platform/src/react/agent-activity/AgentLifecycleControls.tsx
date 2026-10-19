// Buzz 779af8886caae1317b4de962082429867ab61503 lifecycle entries over governed Installation actions
// (DD-125(6), 05 §2.11, 17 §10):
// - desktop/src/features/profile/ui/UserProfilePrimaryActions.tsx: "Stop"/"Start agent" primary tile and
//   "Restart agent" (icons Square/Play/RefreshCw).
// - desktop/src/features/agents/ui/useManagedAgentActions.ts: error copy, runBulkAction confirm
//   "{Label} {n} agent(s)?" and "{failed} of {total} {noun}s failed.".
// The original desktop asked window.confirm only for bulk actions; every Kailo lifecycle action is
// EXPLICIT, so each one goes through the same confirm with the original wording. The original Delete
// removed a local record; Kailo keeps the Installation, so the confirm says what is kept.
import * as React from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Play, RefreshCw, Square } from "lucide-react";
import type { AgentInstallationView } from "@client-kit/contracts";

import type { PlatformMessageKey } from "../../i18n";
import { useBffClient, useFailureText, useUiT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import { MODAL_BACKDROP_BLUR_CLASS } from "../composer/shared/ui/modalBackdrop";
import { MODAL_CONTENT_MOTION_CLASS, MODAL_OVERLAY_MOTION_CLASS } from "../composer/shared/ui/modalMotion";
import {
  isInstallationActive,
  lifecycleIntent,
  lifecycleOffer,
  useLifecycleController,
  type LifecycleController,
  type LifecycleKind,
} from "./agentLifecycle";
import { EditRespondToDialog } from "./EditRespondToDialog";

const CONFIRM_TITLE = {
  stop: ["agentLifecycle.confirm.stop.one", "agentLifecycle.confirm.stop.other"],
  start: ["agentLifecycle.confirm.start.one", "agentLifecycle.confirm.start.other"],
  restart: ["agentLifecycle.confirm.restart.one", "agentLifecycle.confirm.restart.other"],
  remove: ["agentLifecycle.confirm.remove.one", "agentLifecycle.confirm.remove.other"],
} as const satisfies Record<LifecycleKind, readonly [PlatformMessageKey, PlatformMessageKey]>;

const CONFIRM_BODY = {
  stop: "agentLifecycle.confirm.keepBody",
  remove: "agentLifecycle.confirm.keepBody",
  start: "agentLifecycle.confirm.startBody",
  restart: "agentLifecycle.confirm.restartBody",
} as const satisfies Record<LifecycleKind, PlatformMessageKey>;

const FAILED = {
  stop: "agentLifecycle.failed.stop",
  start: "agentLifecycle.failed.start",
  restart: "agentLifecycle.failed.restart",
  remove: "agentLifecycle.failed.remove",
} as const satisfies Record<LifecycleKind, PlatformMessageKey>;

const BULK_FAILED = {
  stop: ["agentLifecycle.bulkFailed.stop.one", "agentLifecycle.bulkFailed.stop.other"],
  start: ["agentLifecycle.bulkFailed.start.one", "agentLifecycle.bulkFailed.start.other"],
  restart: ["agentLifecycle.bulkFailed.restart.one", "agentLifecycle.bulkFailed.restart.other"],
  remove: ["agentLifecycle.bulkFailed.remove.one", "agentLifecycle.bulkFailed.remove.other"],
} as const satisfies Record<LifecycleKind, readonly [PlatformMessageKey, PlatformMessageKey]>;

export type LifecycleRequest = {
  controller: LifecycleController;
  /** Ask the original confirm for one or more Installations. */
  request: (kind: LifecycleKind, rows: readonly AgentInstallationView[]) => void;
  /** The confirm dialog and the outcome line; render once next to the entries. */
  dialog: React.ReactNode;
  feedback: React.ReactNode;
};

export function useLifecycleRequest(onRecorded?: () => void): LifecycleRequest {
  const t = useUiT();
  const client = useBffClient();
  const failureText = useFailureText();
  const controller = useLifecycleController(client, onRecorded);
  const [confirm, setConfirm] = React.useState<{ kind: LifecycleKind; rows: readonly AgentInstallationView[] } | null>(null);
  const [prepareFailed, setPrepareFailed] = React.useState<LifecycleKind | null>(null);
  const [preparing, setPreparing] = React.useState(false);
  const lastKind = React.useRef<LifecycleKind>("stop");

  const request = React.useCallback((kind: LifecycleKind, rows: readonly AgentInstallationView[]) => {
    if (rows.length === 0 || controller.busy || controller.pending.length > 0) return;
    controller.clear();
    setPrepareFailed(null);
    setConfirm({ kind, rows });
  }, [controller]);

  const run = async () => {
    if (!confirm || preparing) return;
    const { kind, rows } = confirm;
    lastKind.current = kind;
    setConfirm(null);
    setPreparing(true);
    try {
      // Each intent (command and key) is frozen here; Retry re-sends exactly these.
      const intents = await Promise.all(rows.map((row) => lifecycleIntent(client, kind, row)));
      await controller.run(intents);
    } catch {
      setPrepareFailed(kind);
    } finally {
      setPreparing(false);
    }
  };

  const many = (confirm?.rows.length ?? 1) !== 1;
  const dialog = (
    <AlertDialog.Root open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={cn("fixed inset-0 z-50 bg-black/60", MODAL_OVERLAY_MOTION_CLASS, MODAL_BACKDROP_BLUR_CLASS)} />
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
          <AlertDialog.Content className={cn(
            "pointer-events-auto grid w-[calc(100vw-2rem)] max-w-md gap-4 outline-hidden rounded-3xl bg-background p-6 shadow-2xl",
            MODAL_CONTENT_MOTION_CLASS,
          )} data-testid="agent-lifecycle-confirm">
            <div className="flex flex-col space-y-2 text-left">
              <AlertDialog.Title className="text-xl font-semibold tracking-tight">
                {confirm ? t(CONFIRM_TITLE[confirm.kind][many ? 1 : 0], { count: confirm.rows.length }) : null}
              </AlertDialog.Title>
              <AlertDialog.Description className="text-sm text-muted-foreground">
                {confirm ? t(CONFIRM_BODY[confirm.kind]) : null}
              </AlertDialog.Description>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialog.Cancel asChild>
                <Button type="button" variant="outline">{t("agentLifecycle.confirm.cancel")}</Button>
              </AlertDialog.Cancel>
              <AlertDialog.Action asChild>
                <Button data-testid="agent-lifecycle-confirm-action" onClick={(event) => { event.preventDefault(); void run(); }}
                  type="button" variant={confirm?.kind === "stop" || confirm?.kind === "remove" ? "destructive" : "default"}>
                  {t("agentLifecycle.confirm.continue")}
                </Button>
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );

  const failure = controller.failure;
  const feedback = controller.pending.length > 0 ? (
    <div className="flex flex-wrap items-center gap-2" data-testid="agent-lifecycle-unknown">
      <p className="break-all text-sm" role="status">
        {t("agentLifecycle.unknown", { operation: failure?.kind === "unknown" ? failure.operationId ?? "—" : "—" })}
      </p>
      <Button disabled={controller.busy} onClick={() => void controller.retry()} size="sm" type="button" variant="outline">
        {t("agentLifecycle.retry")}
      </Button>
    </div>
  ) : controller.bulkFailures ? (
    <p className="text-sm text-destructive" role="alert" data-testid="agent-lifecycle-failure">
      {t(BULK_FAILED[controller.bulkFailures.kind][controller.bulkFailures.failed === 1 ? 0 : 1],
        { failed: controller.bulkFailures.failed, total: controller.bulkFailures.total })}
    </p>
  ) : failure?.kind === "rejected" ? (
    <p className="text-sm text-destructive" role="alert" data-testid="agent-lifecycle-failure">
      {t(FAILED[lastKind.current])} {failureText(failure)}
    </p>
  ) : prepareFailed ? (
    <p className="text-sm text-destructive" role="alert" data-testid="agent-lifecycle-failure">{t(FAILED[prepareFailed])}</p>
  ) : null;

  return { controller: { ...controller, busy: controller.busy || preparing }, request, dialog, feedback };
}

/**
 * Compact lifecycle section for the Installation detail: the original status badge, the
 * Stop/Start agent primary action, Restart agent and "Manage agent access...".
 */
export function AgentLifecycleSection({ installation, name, locked = false, onRecorded }: {
  installation: AgentInstallationView;
  name: string;
  locked?: boolean;
  onRecorded?: () => void;
}) {
  const t = useUiT();
  const lifecycle = useLifecycleRequest(onRecorded);
  const [accessOpen, setAccessOpen] = React.useState(false);
  const offer = lifecycleOffer(installation);
  const active = isInstallationActive(installation);
  const disabled = locked || lifecycle.controller.busy || lifecycle.controller.pending.length > 0;
  const canManageAccess = offer.stop || offer.start || offer.restart;
  return (
    <section className="flex flex-col gap-2" data-testid="agent-lifecycle-section">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
            active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
          data-testid={`agent-lifecycle-status-${installation.resourceId}`}
        >
          {t(active ? "agentLifecycle.status.running" : "agentLifecycle.status.stopped")}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {offer.stop ? (
          <Button data-testid="agent-lifecycle-stop" disabled={disabled} onClick={() => lifecycle.request("stop", [installation])}
            size="sm" type="button" variant="outline">
            <Square className="h-4 w-4" />{t("agentLifecycle.stop")}
          </Button>
        ) : null}
        {offer.start ? (
          <Button data-testid="agent-lifecycle-start" disabled={disabled} onClick={() => lifecycle.request("start", [installation])}
            size="sm" type="button" variant="outline">
            <Play className="h-4 w-4" />{t("agentLifecycle.start")}
          </Button>
        ) : null}
        {offer.restart ? (
          <Button data-testid="agent-lifecycle-restart" disabled={disabled} onClick={() => lifecycle.request("restart", [installation])}
            size="sm" type="button" variant="outline">
            <RefreshCw className="h-4 w-4" />{t("agentLifecycle.restart")}
          </Button>
        ) : null}
        {canManageAccess ? (
          <Button data-testid="agent-lifecycle-manage-access" disabled={disabled} onClick={() => setAccessOpen(true)}
            size="sm" type="button" variant="outline">
            {t("agentLifecycle.manageAccess")}
          </Button>
        ) : null}
      </div>
      {lifecycle.feedback}
      {lifecycle.dialog}
      <EditRespondToDialog agent={accessOpen ? { installationId: installation.resourceId, name } : null}
        onOpenChange={setAccessOpen} open={accessOpen} onRecorded={onRecorded} />
    </section>
  );
}
