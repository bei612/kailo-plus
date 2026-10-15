// 05 §2.10、17 §8：一个 Agent 安装的成员使用权（允许成员 @ / 指派 / 委托此安装）。
// Web 与 Desktop 共用；Mobile 只读，不渲染本控件。开关只提交既有统一 Action，
// 授权、范围、审计与 SpiceDB 投影都在 Core；结果不明保留同一请求查证，不换键重发。
import { useRef, useState } from "react";
import {
  ActionDispatchState,
  ActionGateState,
  type ActionCommand,
  type ActionSubmission,
  type AgentInstallationUsePage,
} from "@client-kit/contracts";
import { newIdempotencyKey } from "../governance";
import { type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useFailureText, useT } from "./context";
import { Button, ReadFailure } from "./ui";
import { useLoad } from "./use-load";
import { Switch } from "./switch";

type Intent = { principalId: string; command: ActionCommand };

function validPage(value: AgentInstallationUsePage, installationId: string): boolean {
  return value.installationId === installationId
    && Number.isSafeInteger(value.resourceVersion) && value.resourceVersion > 0
    && Array.isArray(value.members)
    && value.members.every((member) => typeof member.principalId === "string" && member.principalId !== ""
      && typeof member.displayName === "string" && typeof member.requested === "boolean"
      && typeof member.effective === "boolean" && typeof member.canGrant === "boolean"
      && typeof member.canRevoke === "boolean");
}

/** Whether a submission proves its write outcome; anything else stays a pending intent. */
function settled(result: ActionSubmission): boolean {
  return result.dispatchState !== ActionDispatchState.Unknown
    && result.gateState !== ActionGateState.Evaluating
    && !(result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.NotDispatched);
}

export function AgentInstallationUse({ installationId, locked }: { installationId: string; locked?: boolean }) {
  const client = useBffClient();
  const t = useT();
  const failureText = useFailureText();
  const [state, reload] = useLoad(`agent-installation-use:${installationId}`, () => client.agentInstallationUsers(installationId));
  const [intent, setIntent] = useState<Intent | null>(null);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const page = state.status === "ok" && validPage(state.data, installationId) ? state.data : null;

  const submit = async (next: Intent) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setIntent(next);
    setFailure(null);
    try {
      const result = await client.submitAction(next.command);
      if (!result || result.actionKey !== next.command.actionKey || !result.operationId) throw new Error("receipt");
      setOperation(result.operationId);
      if (settled(result)) {
        setIntent(null);
        if (result.gateState !== ActionGateState.Allowed) setFailure({ kind: "rejected", reason: result.reason, detail: "" });
      } else {
        setFailure({ kind: "unknown", operationId: result.operationId });
      }
    } catch (error) {
      const failed = writeFailure(error);
      setFailure(failed);
      if (failed.kind !== "unknown") setIntent(null);
    } finally {
      inFlight.current = false;
      setBusy(false);
      reload();
    }
  };

  const toggle = (principalId: string, allow: boolean) => {
    if (!page || intent || busy || locked) return;
    void submit({
      principalId,
      command: {
        actionKey: allow ? "agent.installation.use.grant" : "agent.installation.use.revoke",
        idempotencyKey: newIdempotencyKey(),
        resourceId: installationId,
        resourceVersion: page.resourceVersion,
        principalId,
        explicitConfirmation: true,
      },
    });
  };

  return (
    <section className="flex flex-col gap-2 rounded-md border p-3" data-testid="agent-installation-use">
      <h4 className="text-sm font-medium">{t("agentUse.title")}</h4>
      <p className="text-sm text-muted-foreground">{t("agentUse.boundary")}</p>
      {state.status === "pending" ? <p role="status" className="text-sm">{t("platform.loading")}</p>
        : !page ? <ReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
        : page.members.length === 0 ? <p className="text-sm text-muted-foreground">{t("agentUse.none")}</p>
        : <ul className="flex flex-col divide-y">
          {page.members.map((member) => {
            const allowed = member.requested;
            const pendingHere = intent?.principalId === member.principalId;
            const status = member.requested ? t("agentUse.granted")
              : member.effective ? t("agentUse.inherited") : t("agentUse.notGranted");
            return (
              <li key={member.principalId} className="flex items-center justify-between gap-3 py-2"
                data-testid={`agent-use-member-${member.principalId}`}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{member.displayName}</span>
                  <span className="block text-xs text-muted-foreground">{pendingHere ? t("agentUse.pending") : status}</span>
                </span>
                <Switch
                  aria-label={t("agentUse.toggle", { name: member.displayName })}
                  checked={pendingHere ? intent?.command.actionKey === "agent.installation.use.grant" : allowed}
                  disabled={locked || busy || (intent !== null && !pendingHere)
                    || (allowed ? !member.canRevoke : !member.canGrant) || page.pendingActionExecutionId !== undefined}
                  onCheckedChange={(checked) => toggle(member.principalId, checked)}
                />
              </li>
            );
          })}
        </ul>}
      {page?.pendingActionExecutionId ? <p role="status" className="text-sm">{t("agentUse.pending")}</p> : null}
      {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"} className="break-all text-sm">
        {failure.kind === "unknown" ? t("agentUse.unknown", { operation: failure.operationId ?? operation ?? "—" }) : failureText(failure)}
      </p> : null}
      <div className="flex gap-2">
        {intent && failure?.kind === "unknown"
          ? <Button disabled={busy} onClick={() => void submit(intent)}>{t("agents.retry")}</Button> : null}
        <Button disabled={busy} onClick={reload}>{t("platform.refresh")}</Button>
      </div>
    </section>
  );
}
