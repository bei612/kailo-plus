// Tenant 成员邀请的界面（DD-83）：admin 签发与撤回、邀请列表；被邀请人兑换与进度；
// 审批详情里带出兑换者自报名。Web 与 Desktop 渲染同一份。
//
// 入口是否出现只看 BFF 的回答：邀请列表只对持有 Tenant manage 的人开放（FullyConsistent
// Check），回 403 就说明此人不是 admin，整节不渲染——前端不自判权限。
//
// 凭据的纪律：链接只在签发回应里出现一次，这里只放在组件内存里展示，不写日志、不进存储；
// 兑换时凭据只进请求体。宿主负责从 URL fragment 取出凭据并立即清掉 fragment。

import {
  type ActionSubmission,
  type InvitationRedemptionView,
  type IssuedInvitation,
  TenantInvitationStatus,
  type TenantInvitationView,
} from "@kailo/contracts";
import { type FormEvent, useRef, useState } from "react";
import { relativeTime } from "../format";
import { newIdempotencyKey, redemptionPhase } from "../governance";
import {
  approvalStatusMessages,
  enumLabel,
  invitationStatusMessages,
  tenantMembershipStateMessages,
} from "../i18n";
import { BffError, type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useFailureText, useLocale, useReasonText, useT } from "./context";
import { Resource } from "./pages";
import { Badge, Button, Cell, Notice, Table } from "./ui";
import { useLoad } from "./use-load";

/** BFF 以 403 回答：调用方没有这项权限。这是确定的「不给入口」，不是读取失败。 */
function forbidden(error: unknown): boolean {
  return error instanceof BffError && error.status === 403;
}

const inputClass = "h-8 rounded-md border border-input bg-transparent px-2 text-sm";

// ---------------------------------------------------------------------------
// admin：签发、列表、撤回
// ---------------------------------------------------------------------------

type IssueOutcome =
  | { kind: "issued"; label: string; invitation: IssuedInvitation }
  | { kind: "noLink" }
  | { kind: "failed"; failure: WriteFailure };

/** 成员页上的邀请一节。非 admin（列表 403）时整节不渲染。 */
export function TenantInvitations() {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const failureText = useFailureText();
  const [state, reload] = useLoad("invitations", client.invitations);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<IssueOutcome | null>(null);
  const [confirming, setConfirming] = useState<TenantInvitationView | null>(null);
  const [withdrawFailure, setWithdrawFailure] = useState<WriteFailure | null>(null);

  // 第一次得到 BFF 的回答之前不画任何东西：非 admin 不该看到这一节闪一下再消失。
  // 重读期间保持已有的画面（签发出的链接还要留在屏幕上）。
  const answered = useRef(false);
  if (state.status === "ok") answered.current = true;
  if (state.status === "error" && forbidden(state.error)) return null;
  if (state.status === "pending" && !answered.current) return null;

  const issue = async (e: FormEvent) => {
    e.preventDefault();
    const name = label.trim();
    if (!name) return;
    setBusy(true);
    setIssued(null);
    try {
      const r: ActionSubmission = await client.submitAction({
        actionKey: "tenant.member.invite",
        idempotencyKey: newIdempotencyKey(),
        name,
      });
      // 链接只在首次回应里出现；没有即不再有第二来源
      setIssued(r.invitation ? { kind: "issued", label: name, invitation: r.invitation } : { kind: "noLink" });
      setLabel("");
    } catch (err) {
      setIssued({ kind: "failed", failure: writeFailure(err) });
    } finally {
      setBusy(false);
      reload();
    }
  };

  const withdraw = async (inv: TenantInvitationView) => {
    setConfirming(null);
    setBusy(true);
    setWithdrawFailure(null);
    try {
      await client.submitAction({
        actionKey: "tenant.member.invite.revoke",
        idempotencyKey: newIdempotencyKey(),
        invitationId: inv.invitationId,
      });
    } catch (err) {
      setWithdrawFailure(writeFailure(err));
    } finally {
      setBusy(false);
      reload();
    }
  };

  return (
    <section className="flex flex-col gap-3" data-testid="tenant-invitations">
      <h2 className="text-sm font-medium">{t("invitations.title")}</h2>
      {answered.current ? (
        <>
          <p className="text-xs text-muted-foreground">{t("invitations.explain")}</p>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => void issue(e)}>
            <label className="flex flex-col gap-1 text-sm">
              <span>{t("invitations.inviteeLabel")}</span>
              <input
                className={inputClass}
                name="inviteeLabel"
                required
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <Button disabled={busy || !label.trim()} type="submit">
              {t("invitations.issue")}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">{t("invitations.inviteeHint")}</p>
        </>
      ) : null}
      {issued ? <IssuedNotice outcome={issued} /> : null}
      {withdrawFailure ? (
        <p className={withdrawFailure.kind === "rejected" ? "text-destructive" : ""} role="alert">
          {withdrawFailure.kind === "unknown"
            ? t("invitations.withdrawUnknown", { operation: withdrawFailure.operationId ?? "—" })
            : t("invitations.withdrawRejected", { reason: failureText(withdrawFailure) })}
        </p>
      ) : null}
      {confirming ? (
        <div className="flex flex-col gap-2 rounded-md border p-3" role="group">
          <p>{t("invitations.confirmWithdraw", { label: confirming.inviteeLabel })}</p>
          <div className="flex gap-2">
            <Button onClick={() => void withdraw(confirming)}>{t("platform.confirm")}</Button>
            <Button onClick={() => setConfirming(null)}>{t("platform.cancel")}</Button>
          </div>
        </div>
      ) : null}
      <div>
        <Button onClick={reload}>{t("platform.refresh")}</Button>
      </div>
      <Resource state={state} reload={reload}>
        {(rows) =>
          rows.length === 0 ? (
            <Notice>{t("invitations.none")}</Notice>
          ) : (
            <Table
              head={[
                t("invitations.invitee"),
                t("platform.state"),
                t("approvals.expires"),
                t("invitations.redeemer"),
                t("invitations.confirmation"),
                "",
              ]}
            >
              {rows.map((inv) => (
                <tr key={inv.invitationId}>
                  <Cell>{inv.inviteeLabel}</Cell>
                  <Cell>
                    <Badge tone={inv.status === TenantInvitationStatus.Redeemed ? "positive" : "neutral"}>
                      {enumLabel(locale, invitationStatusMessages, inv.status)}
                    </Badge>
                    {inv.membershipState ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {enumLabel(locale, tenantMembershipStateMessages, inv.membershipState)}
                      </span>
                    ) : null}
                  </Cell>
                  <Cell title={inv.expiresAt}>{relativeTime(locale, inv.expiresAt)}</Cell>
                  <Cell>{inv.redeemerDisplayName ?? "—"}</Cell>
                  <Cell>
                    {inv.approvalStatus ? enumLabel(locale, approvalStatusMessages, inv.approvalStatus) : "—"}
                  </Cell>
                  <Cell>
                    {inv.status === TenantInvitationStatus.Issued ? (
                      <Button disabled={busy} onClick={() => setConfirming(inv)}>
                        {t("invitations.withdraw")}
                      </Button>
                    ) : null}
                  </Cell>
                </tr>
              ))}
            </Table>
          )
        }
      </Resource>
    </section>
  );
}

function IssuedNotice({ outcome }: { outcome: IssueOutcome }) {
  const t = useT();
  const locale = useLocale();
  const failureText = useFailureText();
  const [copied, setCopied] = useState(false);
  if (outcome.kind === "noLink") return <p role="alert">{t("invitations.noLink")}</p>;
  if (outcome.kind === "failed") {
    const f = outcome.failure;
    return (
      <p className={f.kind === "rejected" ? "text-destructive" : ""} role="alert">
        {f.kind === "unknown"
          ? t("invitations.issueUnknown", { operation: f.operationId ?? "—" })
          : t("invitations.issueRejected", { reason: failureText(f) })}
      </p>
    );
  }
  const { invitation, label } = outcome;
  // 剪贴板 API 只在安全上下文里存在；没有时链接照样在只读框里可选中复制
  const canCopy = typeof navigator !== "undefined" && navigator.clipboard !== undefined;
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3" role="status" data-testid="issued-invitation">
      <p>
        {t("invitations.issued", {
          label,
          expires: relativeTime(locale, invitation.expiresAt),
        })}
      </p>
      <input
        aria-label={t("invitations.title")}
        className={`${inputClass} font-mono text-xs`}
        readOnly
        value={invitation.link}
        onFocus={(e) => e.currentTarget.select()}
      />
      {canCopy ? (
        <Button
          className="w-fit"
          onClick={() => void navigator.clipboard.writeText(invitation.link).then(() => setCopied(true))}
        >
          {copied ? t("invitations.copied") : t("invitations.copy")}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * 审批详情里带出这条确认对应的邀请：邀请人写的称呼与兑换者自报名，供审批人带外核对。
 * 不是邀请确认（或调用方看不到邀请列表）时不渲染。
 */
export function InvitationForApproval({ workflowId }: { workflowId: string }) {
  const client = useBffClient();
  const t = useT();
  const [state] = useLoad("invitations", client.invitations);
  if (state.status !== "ok") return null;
  const inv = state.data.find((i) => i.approvalWorkflowId === workflowId);
  if (!inv) return null;
  return (
    <p className="rounded-md border p-3" data-testid="invitation-for-approval">
      {t("invitations.forApproval", { label: inv.inviteeLabel, name: inv.redeemerDisplayName ?? "—" })}
    </p>
  );
}

// ---------------------------------------------------------------------------
// 被邀请人：兑换与进度
// ---------------------------------------------------------------------------

/** 一条兑换的进度，一句话。 */
function RedemptionLine({ view }: { view: InvitationRedemptionView }) {
  const t = useT();
  const locale = useLocale();
  const reasonText = useReasonText();
  const tenant = view.tenantName;
  const p = redemptionPhase(view);
  switch (p.kind) {
    case "active":
      return <>{t("redeem.active", { tenant })}</>;
    case "provisioning":
      return <>{t("redeem.provisioning", { tenant })}</>;
    case "waiting":
      return <>{t("redeem.waiting", { tenant })}</>;
    case "evaluating":
      return <>{t("redeem.evaluating", { tenant })}</>;
    case "ended":
      return <>{t("redeem.ended", { tenant, reason: p.reason ? reasonText(p.reason) : "—" })}</>;
    case "other":
      return (
        <>
          {t("redeem.other", {
            tenant,
            state: `${enumLabel(locale, tenantMembershipStateMessages, view.membershipState)} · ${view.admissionGateState}`,
          })}
        </>
      );
  }
}

/**
 * 本人兑换过的邀请与进度。等待确认期间 `/api/v1/session` 回 403，宿主据此渲染本组件，
 * 如实说「等待确认」而不是报错。没有任何兑换记录时显示 `emptyHint`。
 */
export function RedemptionProgress({
  onContinue,
  emptyHint,
}: {
  /** 成为成员后继续（宿主重新进入平台页或重新登记设备） */
  onContinue?: () => void;
  emptyHint?: string;
}) {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad("redemptions", client.redemptions);
  return (
    <div className="flex flex-col gap-2" data-testid="redemption-progress">
      <Resource state={state} reload={reload}>
        {(rows) =>
          rows.length === 0 ? (
            emptyHint ? (
              <p className="text-sm text-muted-foreground">{emptyHint}</p>
            ) : null
          ) : (
            <>
              <h2 className="text-sm font-medium">{t("redeem.mine")}</h2>
              <ul className="flex flex-col gap-1 text-sm" role="status">
                {rows.map((r) => (
                  <li key={r.invitationId}>
                    <RedemptionLine view={r} />
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button onClick={reload}>{t("platform.refresh")}</Button>
                {onContinue && rows.some((r) => redemptionPhase(r).kind === "active") ? (
                  <Button onClick={onContinue}>{t("redeem.continue")}</Button>
                ) : null}
              </div>
            </>
          )
        }
      </Resource>
    </div>
  );
}

/**
 * 兑换页。`credential` 由宿主从链接的 fragment 取出（并已清掉 fragment）；没有凭据时
 * 只显示本人的兑换进度。
 */
export function InvitationRedeemPage({
  credential,
  onContinue,
}: {
  credential: string | null;
  onContinue?: () => void;
}) {
  const client = useBffClient();
  const t = useT();
  const failureText = useFailureText();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [done, setDone] = useState<InvitationRedemptionView | null>(null);
  // 进度列表在兑换后重读
  const [round, setRound] = useState(0);

  const redeem = async () => {
    if (!credential || !name.trim()) return;
    setBusy(true);
    setFailure(null);
    try {
      setDone(await client.redeemInvitation({ credential, displayName: name.trim() }));
    } catch (e) {
      setFailure(writeFailure(e));
    } finally {
      setBusy(false);
      setRound((n) => n + 1);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void redeem();
  };

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-6 text-sm" data-testid="invitation-redeem">
      <h1 className="text-lg font-semibold">{t("redeem.title")}</h1>
      {credential && !done ? (
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <p className="text-muted-foreground">{t("redeem.explain")}</p>
          <label className="flex flex-col gap-1">
            <span>{t("redeem.displayName")}</span>
            <input
              className={inputClass}
              name="displayName"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <Button className="w-fit" disabled={busy || !name.trim()} type="submit">
            {t("redeem.submit")}
          </Button>
        </form>
      ) : null}
      {!credential ? <p className="text-muted-foreground">{t("redeem.noCredential")}</p> : null}
      {failure ? (
        <div className="flex flex-col gap-2" role="alert">
          {failure.kind === "unknown" ? (
            <>
              <p>{t("redeem.unknown")}</p>
              <Button className="w-fit" disabled={busy} onClick={() => void redeem()}>
                {t("redeem.again")}
              </Button>
            </>
          ) : (
            <p className="text-destructive">{t("redeem.rejected", { reason: failureText(failure) })}</p>
          )}
        </div>
      ) : null}
      <RedemptionProgress key={round} onContinue={onContinue} />
    </div>
  );
}
