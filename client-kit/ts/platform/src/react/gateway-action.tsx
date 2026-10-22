// DD-134：网关管理区里的写入只提交既有 Governed Action（05 §2.8、§2.13）。与其他治理面板
// 同一模式：先冻结意图与幂等键并预览，确认后提交；回执严格核对；结果不明保留原意图，只能
// 原样重新核对；审批等待（WAITING）与已派发分开呈现，不把 202 当终态。

import {
  ActionDispatchState,
  ActionGateState,
  ReasonCode,
  type ActionCommand,
  type ActionSubmission,
} from "@client-kit/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { newIdempotencyKey } from "../governance";
import type { PlatformMessageKey } from "../i18n";
import { TransportError, type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useFailureText, useReasonText, useT } from "./context";
import { TaskDetail } from "./governance";
import { Button } from "./ui";

/** 结果不明：派发未知、仍在评估，或已准入却未派发。 */
export function submissionUnknown(submission: ActionSubmission | null, failure: WriteFailure | null): boolean {
  return failure?.kind === "unknown" || submission?.dispatchState === ActionDispatchState.Unknown
    || submission?.gateState === ActionGateState.Evaluating
    || (submission?.gateState === ActionGateState.Allowed && submission.dispatchState === ActionDispatchState.NotDispatched);
}

/** 只有带审批的动作允许 WAITING；其余动作出现 WAITING 视为不合契约的回执。 */
const approvalActions = new Set(["component_release.approve", "capability_contract.approve"]);

function validReceipt(intent: ActionCommand, result: ActionSubmission, previous: ActionSubmission | null): boolean {
  return !!result && result.actionKey === intent.actionKey
    && typeof result.actionExecutionId === "string" && !!result.actionExecutionId
    && typeof result.operationId === "string" && !!result.operationId
    && Object.values(ActionGateState).includes(result.gateState)
    && Object.values(ActionDispatchState).includes(result.dispatchState)
    && (result.reason === undefined || Object.values(ReasonCode).includes(result.reason))
    && !(result.gateState === ActionGateState.Denied && !result.reason)
    && !(result.gateState === ActionGateState.Waiting && (!approvalActions.has(intent.actionKey)
      || !result.approvalWorkflowId || result.dispatchState !== ActionDispatchState.NotDispatched))
    && !(previous && (result.actionExecutionId !== previous.actionExecutionId || result.operationId !== previous.operationId));
}

export type GatewayAction = ReturnType<typeof useGatewayAction>;

/** 一项受治理写入的冻结意图与回执。onSettled 在确定回执后触发（用于重读列表）。 */
export function useGatewayAction(onSettled?: (command: ActionCommand, submission: ActionSubmission) => void) {
  const client = useBffClient();
  const t = useT();
  const [intent, setIntent] = useState<ActionCommand | null>(null);
  const [warning, setWarning] = useState<PlatformMessageKey | null>(null);
  const [submission, setSubmission] = useState<ActionSubmission | null>(null);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const unknown = submissionUnknown(submission, failure);

  /** 冻结一项新意图；已有意图（含结果不明）时不替换。 */
  const prepare = useCallback((command: Omit<ActionCommand, "idempotencyKey">, warningKey: PlatformMessageKey) => {
    if (intent || sending.current) return;
    setSubmission(null); setFailure(null);
    setWarning(warningKey);
    setIntent({ ...command, idempotencyKey: newIdempotencyKey() } as ActionCommand);
  }, [intent]);

  const cancel = useCallback(() => {
    if (busy || unknown) return;
    setIntent(null); setWarning(null);
  }, [busy, unknown]);

  const submit = useCallback(async () => {
    if (!intent || sending.current) return;
    sending.current = true; setBusy(true);
    const frozen = intent;
    try {
      const result = await client.submitAction(frozen);
      if (!validReceipt(frozen, result, submission)) throw new TransportError(t("platform.loadFailed"));
      if (!mounted.current) return;
      setSubmission(result); setFailure(null);
      if (!submissionUnknown(result, null)) {
        setIntent(null);
        settled.current?.(frozen, result);
      }
    } catch (error) {
      if (!mounted.current) return;
      // 重新核对时的拒绝不说明原写入的结果：结果不明状态保持，意图保留。
      if (!unknown) {
        const failed = writeFailure(error);
        setFailure(failed);
        if (failed.kind !== "unknown") setIntent(null);
      }
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [client, intent, submission, t, unknown]);

  return { intent, warning, submission, failure, busy, unknown, frozen: !!intent || busy, prepare, submit, cancel };
}

/** 预览不显示密钥：bindingSecretValues 只呈现键名。 */
function preview(intent: ActionCommand): string {
  const shown: Record<string, unknown> = { ...intent };
  delete shown.idempotencyKey;
  if (intent.bindingSecretValues) shown.bindingSecretValues = intent.bindingSecretValues.map((secret) => ({ secretKey: secret.secretKey, value: "••••" }));
  return JSON.stringify(shown, null, 2);
}

/** 确认区、回执与失败的统一呈现；任务详情经既有 TaskDetail 打开。 */
export function GatewayActionPanel({ action, testId }: { action: GatewayAction; testId?: string }) {
  const t = useT();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const [task, setTask] = useState<string | null>(null);
  const { intent, submission, failure, busy, unknown, warning } = action;
  if (task) return <TaskDetail actionExecutionId={task} onBack={() => setTask(null)} onOpen={setTask} />;
  if (!intent && !submission && !failure) return null;
  return <div className="flex flex-col gap-2 rounded-md border p-3 text-sm" data-testid={testId}>
    {intent ? <div role="group" className="flex flex-col gap-2">
      {warning ? <p>{t(warning)}</p> : null}
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">{preview(intent)}</pre>
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => void action.submit()}>{t(busy ? "platform.loading" : unknown ? "agents.retry" : "agents.confirm")}</Button>
        {!busy && !unknown ? <Button onClick={action.cancel}>{t("platform.cancel")}</Button> : null}
      </div>
    </div> : null}
    {submission ? <div role="status" className="flex flex-col gap-1 break-all">
      <p>{unknown ? t("agents.unknown", { operation: submission.operationId })
        : submission.gateState === ActionGateState.Waiting
          ? t("gateway.action.waiting", { workflow: submission.approvalWorkflowId ?? "—", execution: submission.actionExecutionId })
          : submission.gateState === ActionGateState.Denied
            ? t("gateway.action.denied", { reason: submission.reason ? reasonText(submission.reason) : submission.gateState })
            : t("gateway.action.recorded", { execution: submission.actionExecutionId, operation: submission.operationId })}</p>
      <Button className="w-fit" onClick={() => setTask(submission.actionExecutionId)}>{t("gateway.action.viewTask")}</Button>
    </div> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"}>{failure.kind === "unknown"
      ? t("agents.unknown", { operation: failure.operationId ?? submission?.operationId ?? "—" }) : failureText(failure)}</p> : null}
  </div>;
}
