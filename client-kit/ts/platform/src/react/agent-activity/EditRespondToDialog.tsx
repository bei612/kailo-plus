// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/channels/ui/EditRespondToDialog.tsx,
// original DOM/copy, over the Installation use page (DD-125(6), 05 §2.10). Save submits one governed
// agent.installation.use.grant/revoke per changed member; an UNKNOWN step keeps its command and
// key ("Retry same request"). Core re-admits every step; the page only offers what it may submit.
import * as React from "react";
import { AgentRespondToMode, type AgentInstallationUsePage } from "@client-kit/contracts";

import { useBffClient, useFailureText, useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../composer/shared/ui/dialog";
import { CreateAgentRespondToField } from "./RespondToField";
import { respondToAllowlistOf, respondToChanges, respondToModeOf, useRespondToSave } from "./respondTo";

function validUsePage(page: AgentInstallationUsePage, installationId: string): boolean {
  return !!page && page.installationId === installationId && Number.isSafeInteger(page.resourceVersion)
    && Array.isArray(page.members) && page.members.every((member) => typeof member.principalId === "string"
      && typeof member.displayName === "string" && typeof member.requested === "boolean"
      && typeof member.canGrant === "boolean" && typeof member.canRevoke === "boolean");
}

export function EditRespondToDialog({
  agent,
  onOpenChange,
  open,
  onRecorded,
}: {
  agent: { installationId: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  onRecorded?: () => void;
}) {
  const t = useUiT();
  const client = useBffClient();
  const failureText = useFailureText();
  const installationId = agent?.installationId ?? "";
  const [page, setPage] = React.useState<AgentInstallationUsePage | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [respondTo, setRespondTo] = React.useState<AgentRespondToMode>(AgentRespondToMode.OwnerOnly);
  const [respondToAllowlist, setRespondToAllowlist] = React.useState<string[]>([]);
  const [reloadTick, setReloadTick] = React.useState(0);
  const reload = React.useCallback(() => setReloadTick((tick) => tick + 1), []);
  const saver = useRespondToSave(client, installationId, () => { reload(); onRecorded?.(); });

  React.useEffect(() => {
    if (!open || !agent) return;
    let current = true;
    setLoadFailed(false);
    client.agentInstallationUsers(agent.installationId).then((next) => {
      if (!current) return;
      if (!validUsePage(next, agent.installationId)) { setLoadFailed(true); return; }
      setPage(next);
      setRespondTo(respondToModeOf(next));
      setRespondToAllowlist(respondToAllowlistOf(next));
    }, () => { if (current) setLoadFailed(true); });
    return () => { current = false; };
  }, [agent, client, open, reloadTick]);

  const editable = page !== null && page.pendingActionExecutionId === undefined
    && page.members.some((member) => member.canGrant || member.canRevoke);
  const respondToValid = respondTo !== AgentRespondToMode.Allowlist || respondToAllowlist.length > 0;
  const pendingUnknown = saver.unknown !== null;

  async function handleSave() {
    if (!page) return;
    const done = await saver.save(respondToChanges(page, respondTo, respondToAllowlist));
    if (done) onOpenChange(false);
  }

  return (
    <Dialog onOpenChange={(next) => { if (!saver.saving && !pendingUnknown) onOpenChange(next); }} open={open}>
      <DialogContent className="max-w-md" data-testid="agent-respond-to-dialog">
        <DialogHeader>
          <DialogTitle>{t("respondTo.title")}</DialogTitle>
          <DialogDescription>
            {t("respondTo.description", { name: agent?.name || t("respondTo.thisAgent") })}
          </DialogDescription>
        </DialogHeader>
        {page ? (
          <CreateAgentRespondToField
            allowlist={respondToAllowlist}
            disabled={saver.saving || pendingUnknown || !editable}
            disabledReason={editable ? undefined : page.pendingActionExecutionId !== undefined
              ? t("agentUse.pending") : t("respondTo.readOnly")}
            members={page.members}
            mode={respondTo}
            onAllowlistChange={setRespondToAllowlist}
            onModeChange={setRespondTo}
          />
        ) : loadFailed ? (
          <p className="text-sm text-destructive" role="alert">{t("platform.loadFailed")}</p>
        ) : (
          <p className="text-sm text-muted-foreground" role="status">{t("platform.loading")}</p>
        )}
        {saver.unknown ? (
          <p className="break-all text-sm" role="status">
            {t("respondTo.unknown", { name: saver.unknown.step.change.displayName, operation: saver.unknown.operationId ?? "—" })}
          </p>
        ) : saver.failure === "pending" ? (
          <p className="text-sm text-muted-foreground" role="status">{t("agentUse.pending")}</p>
        ) : saver.failure ? (
          <p className="text-sm text-destructive" role="alert">{failureText(saver.failure)}</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            disabled={saver.saving || pendingUnknown}
            onClick={() => onOpenChange(false)}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("respondTo.cancel")}
          </Button>
          {pendingUnknown || saver.failure === "pending" ? (
            <Button disabled={saver.saving} onClick={() => void saver.retry().then((done) => { if (done) onOpenChange(false); })}
              size="sm" type="button">
              {t("respondTo.retry")}
            </Button>
          ) : (
            <Button
              data-testid="agent-respond-to-save"
              disabled={!page || !editable || !respondToValid || saver.saving}
              onClick={() => void handleSave()}
              size="sm"
              type="button"
            >
              {saver.saving ? t("respondTo.saving") : t("respondTo.save")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
