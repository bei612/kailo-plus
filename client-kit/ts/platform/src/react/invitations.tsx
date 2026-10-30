// Tenant 成员邀请的界面（DD-83）：admin 签发与撤回、邀请列表；被邀请人兑换与进度；
// 审批详情里带出兑换者自报名。Web 与 Desktop 渲染同一份。
//
// 入口是否出现只看 BFF 的回答：邀请列表只对持有 Tenant manage 的人开放（FullyConsistent
// Check），回 403 就说明此人不是 admin——嵌入成员页或设置时不渲染入口，管理区的独立分区
// 说明需要的角色（DD-170 §16.4），前端不自判权限。
//
// 凭据的纪律：链接只在签发回应里出现一次，这里只放在组件内存里展示，不写日志、不进存储；
// 兑换时凭据只进请求体。宿主负责从 URL fragment 取出凭据并立即清掉 fragment。

import {
  type ActionCommand,
  ApprovalStatus,
  ActionDispatchState,
  ActionGateState,
  type ActionSubmission,
  type InvitationRedemptionView,
  type IssuedInvitation,
  TenantInvitationStatus,
  type TenantInvitationView,
} from "@client-kit/contracts";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { relativeTime } from "../format";
import { newIdempotencyKey, redemptionPhase } from "../governance";
import {
  enumLabel,
  invitationStatusMessages,
  type PlatformMessageKey,
  tenantMembershipStateMessages,
} from "../i18n";
import { BffError, TransportError, type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useFailureText, useLocale, useReasonText, useT } from "./context";
import { Resource } from "./pages";
import { Badge, Button, type Tone } from "./ui";
import { CellStack, DataTable, type DataColumn } from "./data-table";
import { EmptyState, ErrorState, NoMatchState, PermissionState, TableSkeleton } from "./state-views";
import { ConfirmDialog } from "./confirm-dialog";
import { FilterChips, PageSection, RefreshButton } from "./page-layout";
import { OutcomeNotice, PRIMARY_ACTION_CLASS, RowActionsMenu, UnknownInDialog } from "./roles";
import { useLoad, type Loaded } from "./use-load";
import { CommunityInviteDialog } from "./community-members/CommunityInviteDialog";
import { InviteLinkSection } from "./community-members/InviteLinkSection";
import { Button as InviteButton } from "./profile/buzz/shared/ui/button";
import { CommunityMembersSettingsCard } from "./community-members/CommunityMembersSettingsCard";

/** BFF 以 403 回答：调用方没有这项权限。这是确定的「不给入口」，不是读取失败。 */
function forbidden(error: unknown): boolean {
  return error instanceof BffError && error.status === 403;
}

const inputClass = "h-8 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs";

function invitationReceipt(result:ActionSubmission,command:ActionCommand,previous:ActionSubmission|null) {
  if(!result||result.actionKey!==command.actionKey||!result.actionExecutionId||!result.operationId
    ||(previous&&(result.operationId!==previous.operationId||result.actionExecutionId!==previous.actionExecutionId))
    ||!Object.values(ActionGateState).includes(result.gateState)||!Object.values(ActionDispatchState).includes(result.dispatchState))
    throw new TransportError("Invitation receipt is not confirmed");
  return result.dispatchState!==ActionDispatchState.Unknown&&result.gateState!==ActionGateState.Evaluating
    &&!(result.gateState===ActionGateState.Allowed&&result.dispatchState===ActionDispatchState.NotDispatched);
}

// ---------------------------------------------------------------------------
// admin：签发、列表、撤回
// ---------------------------------------------------------------------------

type IssueOutcome =
  | { kind: "issued"; label: string; invitation: IssuedInvitation }
  | { kind: "noLink" }
  | { kind: "failed"; failure: WriteFailure };

const invitationTone = (status: TenantInvitationStatus): Tone => status === TenantInvitationStatus.Redeemed ? "positive"
  : status === TenantInvitationStatus.Issued ? "info" : "neutral";

/** The identity check of a used invitation, in words an admin acts on (DD-170 §16.5(1)). */
const checkLabel: Record<ApprovalStatus, PlatformMessageKey> = {
  [ApprovalStatus.Requested]: "adminArea.invitations.check.waiting",
  [ApprovalStatus.Waiting]: "adminArea.invitations.check.waiting",
  [ApprovalStatus.Approved]: "adminArea.invitations.check.approved",
  [ApprovalStatus.Consumed]: "adminArea.invitations.check.approved",
  [ApprovalStatus.Denied]: "adminArea.invitations.check.denied",
  [ApprovalStatus.Expired]: "adminArea.invitations.check.expired",
  [ApprovalStatus.Cancelled]: "adminArea.invitations.check.withdrawn",
  [ApprovalStatus.Invalidated]: "adminArea.invitations.check.invalid",
};
const checkTone = (status: ApprovalStatus): Tone => status === ApprovalStatus.Approved || status === ApprovalStatus.Consumed ? "positive"
  : status === ApprovalStatus.Requested || status === ApprovalStatus.Waiting ? "warning"
  : status === ApprovalStatus.Denied ? "negative" : "neutral";

type StatusFilter = "all" | "issued" | "redeemed" | "ended";
const matchesFilter = (inv: TenantInvitationView, filter: StatusFilter) => filter === "all"
  || (filter === "issued" && inv.status === TenantInvitationStatus.Issued)
  || (filter === "redeemed" && inv.status === TenantInvitationStatus.Redeemed)
  || (filter === "ended" && (inv.status === TenantInvitationStatus.Revoked || inv.status === TenantInvitationStatus.Expired));

/**
 * 成员管理区的“邀请”分区（DD-83；DD-170 §16）：签发表单、邀请表（状态筛选、总数与翻页）、
 * 撤回确认。非 admin（列表 403）时独立分区说明需要的角色；嵌在成员页或设置里时不渲染入口。
 */
export function TenantInvitations({dialog=false,settings=false,active=true,onAccessChange}:{dialog?:boolean;settings?:boolean;active?:boolean;onAccessChange?:(state:Loaded<boolean>,reload:()=>void)=>void} = {}) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const failureText = useFailureText();
  const [state, reload] = useLoad("invitations", client.invitations);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<IssueOutcome | null>(null);
  const [confirming, setConfirming] = useState<TenantInvitationView | null>(null);
  const [withdrawDialog, setWithdrawDialog] = useState(false);
  const [withdrawFailure, setWithdrawFailure] = useState<WriteFailure | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [open,setOpen]=useState(false);
  const [issueIntent,setIssueIntent]=useState<ActionCommand|null>(null);
  const [withdrawIntent,setWithdrawIntent]=useState<ActionCommand|null>(null);
  const issueReceipt=useRef<ActionSubmission|null>(null);
  const withdrawReceipt=useRef<ActionSubmission|null>(null);
  const inFlight=useRef(false);
  const readStatus=state.status;
  const readError=state.status==="error"?state.error:undefined;
  const standalone=!dialog&&!settings;
  useEffect(()=>{
    onAccessChange?.(readStatus==="ok"?{status:"ok",data:true}:readStatus==="error"?{status:"error",error:readError}:{status:"pending"},reload);
  },[readStatus,readError,onAccessChange,reload]);
  useEffect(()=>{
    window.addEventListener("focus",reload);
    return ()=>window.removeEventListener("focus",reload);
  },[reload]);
  // Closing the original settings surface dismisses its dialog, not its
  // unresolved governed intent or first-response-only link.
  useEffect(()=>{if(!active)setOpen(false);},[active]);

  // 第一次得到 BFF 的回答之前不画列表：嵌入成员页或设置时，非 admin 不该看到入口闪一下
  // 再消失；独立分区则以骨架占位。重读期间保持已有的画面（签发出的链接还要留在屏幕上）。
  const answered = useRef(false);
  if (state.status === "ok") answered.current = true;
  const denied = state.status === "error" && forbidden(state.error);
  if (denied && !standalone) return null;
  if (denied && !issueIntent && !withdrawIntent && !issued)
    return <PermissionState title={t("invitations.accessRequired")} description={t("invitations.accessRequiredBody")} />;
  if (state.status === "pending" && !answered.current)
    return standalone ? <PageSection id="admin-invitations" title={t("invitations.title")} description={t("adminArea.invitations.description")}>
      <TableSkeleton rows={4} columns={5} />
    </PageSection> : null;

  const issue = async (e: FormEvent) => {
    e.preventDefault();
    const name = label.trim();
    if ((!issueIntent&&!name)||inFlight.current||withdrawIntent) return;
    const wasUnknown=issued?.kind==="failed"&&issued.failure.kind==="unknown";
    const priorOperation=issued?.kind==="failed"&&issued.failure.kind==="unknown"?issued.failure.operationId:undefined;
    const command=issueIntent??{actionKey:"tenant.member.invite",idempotencyKey:newIdempotencyKey(),name};
    setIssueIntent(command);inFlight.current=true;
    setBusy(true);
    if(!wasUnknown)setIssued(null);
    try {
      const r: ActionSubmission = await client.submitAction(command);
      if(priorOperation&&r?.operationId!==priorOperation)throw new TransportError("Invitation operation changed");
      const confirmed=invitationReceipt(r,command,issueReceipt.current);
      issueReceipt.current=r;
      if(!confirmed){setIssued({kind:"failed",failure:{kind:"unknown",operationId:r.operationId}});return;}
      // 链接只在首次回应里出现；没有即不再有第二来源
      setIssued(r.invitation ? { kind: "issued", label: name, invitation: r.invitation } : { kind: "noLink" });
      setLabel("");
      setIssueIntent(null);
      issueReceipt.current=null;
    } catch (err) {
      if(!wasUnknown){
        const failure=writeFailure(err);setIssued({ kind: "failed", failure });
        if(failure.kind!=="unknown"){setIssueIntent(null);issueReceipt.current=null;}
      }
    } finally {
      inFlight.current=false;
      setBusy(false);
      reload();
    }
  };

  const withdraw = async (inv: TenantInvitationView) => {
    if(inFlight.current||issueIntent)return;
    const wasUnknown=withdrawFailure?.kind==="unknown";
    const priorOperation=withdrawFailure?.kind==="unknown"?withdrawFailure.operationId:undefined;
    const command=withdrawIntent??{actionKey:"tenant.member.invite.revoke",idempotencyKey:newIdempotencyKey(),invitationId:inv.invitationId};
    setWithdrawIntent(command);inFlight.current=true;
    setBusy(true);
    if(!wasUnknown)setWithdrawFailure(null);
    try {
      const receipt=await client.submitAction(command);
      if(priorOperation&&receipt?.operationId!==priorOperation)throw new TransportError("Withdrawal operation changed");
      const confirmed=invitationReceipt(receipt,command,withdrawReceipt.current);
      withdrawReceipt.current=receipt;
      if(!confirmed){setWithdrawFailure({kind:"unknown",operationId:receipt.operationId});return;}
      setWithdrawIntent(null);setConfirming(null);setWithdrawDialog(false);setWithdrawFailure(null);withdrawReceipt.current=null;
    } catch (err) {
      if(!wasUnknown){
        const failure=writeFailure(err);setWithdrawFailure(failure);
        if(failure.kind!=="unknown"){setWithdrawIntent(null);setConfirming(null);setWithdrawDialog(false);withdrawReceipt.current=null;}
      }
    } finally {
      inFlight.current=false;
      setBusy(false);
      reload();
    }
  };
  const withdrawUnknown=withdrawFailure?.kind==="unknown";

  const invitationForm = <>
      {answered.current ? (
        <form className="flex flex-col gap-2" onSubmit={(e) => void issue(e)}>
          <label className="text-sm font-medium text-foreground" htmlFor={`invitee-label-${dialog?"dialog":settings?"settings":"page"}`}>{t("adminArea.invitations.inviteeLabel")}</label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id={`invitee-label-${dialog?"dialog":settings?"settings":"page"}`}
              className="h-8 min-w-0 flex-1 basis-56 rounded-lg border border-input bg-background px-2.5 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:border-brand focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/15 disabled:opacity-60"
              name="inviteeLabel"
              required
              autoComplete="off"
              placeholder={t("adminArea.invitations.inviteePlaceholder")}
              disabled={busy||issueIntent!==null||withdrawIntent!==null}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <Button className={PRIMARY_ACTION_CLASS} disabled={busy || withdrawIntent!==null || (!issueIntent&&!label.trim())} type="submit">
              {t(issueIntent?"platform.retry":"invitations.issue")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("adminArea.invitations.inviteeHint")}</p>
        </form>
      ) : null}
      {issued ? <IssuedNotice outcome={issued} /> : null}
  </>;

  const rows = state.status === "ok" ? state.data : null;
  const shown = rows ? rows.filter((inv) => matchesFilter(inv, filter)) : [];
  const columns: DataColumn<TenantInvitationView>[] = [
    { key: "invitee", header: t("adminArea.invitations.inviteeLabel"), truncate: true, title: (inv) => inv.inviteeLabel,
      sortValue: (inv) => inv.inviteeLabel.toLocaleLowerCase(),
      cell: (inv) => <CellStack primary={inv.inviteeLabel} secondary={t("adminArea.invitations.created", { time: relativeTime(locale, inv.createdAt) })} /> },
    { key: "status", header: t("platform.state"), width: "8rem", sortValue: (inv) => enumLabel(locale, invitationStatusMessages, inv.status),
      cell: (inv) => <Badge tone={invitationTone(inv.status)}>{enumLabel(locale, invitationStatusMessages, inv.status)}</Badge> },
    { key: "expires", header: t("approvals.expires"), width: "8rem", secondary: true, sortValue: (inv) => Date.parse(inv.expiresAt),
      title: (inv) => new Date(inv.expiresAt).toLocaleString(locale), cell: (inv) => <span className="whitespace-nowrap text-muted-foreground">{relativeTime(locale, inv.expiresAt)}</span> },
    { key: "redeemer", header: t("invitations.redeemer"), truncate: true, title: (inv) => inv.redeemerDisplayName,
      sortValue: (inv) => inv.redeemerDisplayName?.toLocaleLowerCase(),
      cell: (inv) => inv.redeemerDisplayName ? <CellStack primary={inv.redeemerDisplayName}
        secondary={inv.membershipState ? enumLabel(locale, tenantMembershipStateMessages, inv.membershipState) : undefined} /> : null },
    { key: "check", header: t("adminArea.invitations.confirmation"), width: "9rem",
      sortValue: (inv) => inv.approvalStatus ? t(checkLabel[inv.approvalStatus]) : undefined,
      cell: (inv) => inv.approvalStatus && checkLabel[inv.approvalStatus]
        ? <Badge tone={checkTone(inv.approvalStatus)}>{t(checkLabel[inv.approvalStatus])}</Badge> : null },
  ];
  const statusOptions = [
    { value: "all" as const, label: t("adminArea.filterAll") },
    { value: "issued" as const, label: enumLabel(locale, invitationStatusMessages, TenantInvitationStatus.Issued) },
    { value: "redeemed" as const, label: enumLabel(locale, invitationStatusMessages, TenantInvitationStatus.Redeemed) },
    { value: "ended" as const, label: t("adminArea.invitations.ended") },
  ];

  const list = state.status === "error" && !denied ? <ErrorState error={state.error} onRetry={reload} />
    : !rows ? null
    : rows.length === 0 ? <EmptyState title={t("adminArea.invitations.emptyTitle")} description={t("adminArea.invitations.emptyBody")} />
    : <DataTable label={t("adminArea.invitations.listLabel")} rows={shown} columns={columns} rowKey={(inv) => inv.invitationId}
      search={{ placeholder: t("adminArea.invitations.search"), text: (inv) => `${inv.inviteeLabel} ${inv.redeemerDisplayName ?? ""}` }}
      toolbar={<><FilterChips label={t("adminArea.filterStatus")} value={filter} options={statusOptions} onChange={setFilter} /><RefreshButton onClick={reload} /></>}
      rowActions={(inv) => inv.status === TenantInvitationStatus.Issued ? <RowActionsMenu name={inv.inviteeLabel}
        disabled={busy||issueIntent!==null||withdrawIntent!==null} actions={[{ key: "withdraw", danger: true, label: t("invitations.withdraw"),
          onSelect: () => { setWithdrawFailure(null); setConfirming(inv); setWithdrawDialog(true); } }]} /> : null}
      rowActionsWidth="3.5rem"
      empty={<NoMatchState onClear={() => setFilter("all")} />} />;

  const content = (
    <section className="flex min-w-0 flex-col gap-4" data-testid="tenant-invitations">
      {standalone ? <PageSection id="admin-invitations" title={t("invitations.title")} description={t("adminArea.invitations.description")}>
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">{t("adminArea.invitations.formTitle")}</h3>
          {invitationForm}
        </div>
      </PageSection> : dialog ? invitationForm : null}
      {withdrawFailure ? (
        <OutcomeNotice tone="alert" action={withdrawUnknown && confirming ? <Button disabled={busy} onClick={() => setWithdrawDialog(true)}>{t("adminArea.reopen")}</Button> : undefined}>
          {withdrawUnknown
            ? t("invitations.withdrawUnknown", { operation: withdrawFailure.operationId ?? "—" })
            : t("invitations.withdrawRejected", { reason: failureText(withdrawFailure) })}
        </OutcomeNotice>
      ) : null}
      {list}
      <ConfirmDialog open={withdrawDialog && confirming !== null} testId="invitation-withdraw-dialog" pending={busy}
        onOpenChange={(next) => { if (next) return; setWithdrawDialog(false); if (!withdrawIntent) setConfirming(null); }}
        title={t("adminArea.invitations.withdrawTitle", { label: confirming?.inviteeLabel ?? "" })}
        description={t("adminArea.invitations.withdrawBody")}
        confirmLabel={withdrawUnknown ? t("workspace.lifecycle.retry") : t("invitations.withdraw")}
        onConfirm={() => { if (confirming) void withdraw(confirming); }}>
        {withdrawUnknown ? <UnknownInDialog operation={withdrawFailure?.operationId} /> : null}
      </ConfirmDialog>
    </section>
  );
  if(settings)return <>
    <CommunityMembersSettingsCard inviteAction={<InviteButton data-testid="community-invite-dialog-trigger" onClick={()=>setOpen(true)}>{t("invitations.communityInvite")}</InviteButton>}>
      <CommunityInviteDialog open={open&&active} onOpenChange={setOpen}>{invitationForm}</CommunityInviteDialog>
    </CommunityMembersSettingsCard>
    {content}
  </>;
  if(!dialog)return content;
  return <>
    <InviteButton data-testid="community-invite-dialog-trigger" onClick={()=>setOpen(true)}>{t("invitations.communityInvite")}</InviteButton>
    <CommunityInviteDialog open={open} onOpenChange={setOpen}>
      {content}
    </CommunityInviteDialog>
  </>;
}

function IssuedNotice({ outcome }: { outcome: IssueOutcome }) {
  const t = useT();
  const locale = useLocale();
  const failureText = useFailureText();
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
  return (
    <div className="space-y-3" role="status" data-testid="issued-invitation">
      <p>
        {t("invitations.issued", {
          label,
          expires: relativeTime(locale, invitation.expiresAt),
        })}
      </p>
      <InviteLinkSection inviteUrl={invitation.link}/>
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
