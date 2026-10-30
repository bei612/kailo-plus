// DD-168(2), .design/03 §2/§3.1, DD-45: a member leaves only after everything they own has a
// new owner. This admin section lists members in REVOKING with what still blocks them, and
// moves each Resource (with its Assets) through the governed `resource.transfer_owner`,
// picking the new owner from active members. Nothing here decides permission: Core re-checks
// Tenant `manage` on every read and admission/approval on every transfer.
import {
  ActionDispatchState,
  ActionGateState,
  type ActionSubmission,
  type OwnerTransferItem,
  type OwnerTransferMember,
  type OwnerTransferPage,
} from "@client-kit/contracts";
import { useId, useState } from "react";
import { newIdempotencyKey } from "../governance";
import type { PlatformMessageKey } from "../i18n";
import { BffError, writeFailure, type WriteFailure } from "../transport";
import { PersonaDropdownField } from "./agent-library/PersonaDropdownField";
import { useBffClient, useFailureText, useT } from "./context";
import { OwnerName, useTenantPeople, type TenantPeople } from "./tenant-people";
import { Badge, Button, Notice, ReadFailure } from "./ui";
import { useLoad } from "./use-load";

const TYPE_LABELS: Record<string, PlatformMessageKey> = {
  "agent.definition": "ownerTransfers.type.agentDefinition",
  "agent.installation": "ownerTransfers.type.agentInstallation",
  "agent.team": "ownerTransfers.type.agentTeam",
  "skill.definition": "ownerTransfers.type.skill",
  automation: "ownerTransfers.type.automation",
  llm_route: "ownerTransfers.type.llmRoute",
  "mcp.connection": "ownerTransfers.type.connector",
  "component.shared_object": "ownerTransfers.type.componentObject",
};

const BLOCK_LABELS: Record<NonNullable<OwnerTransferItem["blockReason"]>, PlatformMessageKey> = {
  PROJECTION_PENDING: "ownerTransfers.block.pending",
  STATE: "ownerTransfers.block.state",
  AUTOMATION_ENABLED: "ownerTransfers.block.automationEnabled",
};

function validPage(page: OwnerTransferPage): boolean {
  return !!page && Array.isArray(page.members) && typeof page.truncated === "boolean"
    && page.members.every((member) => !!member && typeof member.principalId === "string" && !!member.principalId
      && typeof member.displayName === "string" && typeof member.membershipState === "string"
      && Array.isArray(member.items) && member.items.every((item) => !!item
        && typeof item.resourceId === "string" && !!item.resourceId && typeof item.typeKey === "string"
        && Number.isSafeInteger(item.resourceVersion) && item.resourceVersion > 0
        && typeof item.resourceOwnerPrincipalId === "string" && typeof item.ownedResource === "boolean"
        && typeof item.transferable === "boolean" && Number.isSafeInteger(item.assetCount)));
}

/** Admin area section: members whose departure waits for ownership transfers. */
export function OwnerTransfersPanel({ onOpenApprovals }: { onOpenApprovals?: () => void } = {}) {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad("owner-transfers", () => client.ownerTransfers());
  const people = useTenantPeople("owner-transfers");
  const page = state.status === "ok" && validPage(state.data) ? state.data : null;
  return <section className="flex flex-col gap-4" data-testid="owner-transfers">
    <header className="flex flex-col gap-1">
      <h2 className="text-base font-semibold">{t("ownerTransfers.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("ownerTransfers.description")}</p>
    </header>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : state.status === "error" && state.error instanceof BffError && state.error.status === 403
        ? <Notice>{t("ownerTransfers.adminOnly")}</Notice>
      : !page ? <ReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : page.members.length === 0 ? <Notice>{t("ownerTransfers.none")}</Notice>
      : <>
        {page.members.map((member) => <MemberTransfers key={member.principalId} member={member} people={people}
          onRecorded={reload} onOpenApprovals={onOpenApprovals} />)}
        {page.truncated ? <Notice>{t("ownerTransfers.truncated")}</Notice> : null}
      </>}
  </section>;
}

function MemberTransfers({ member, people, onRecorded, onOpenApprovals }: {
  member: OwnerTransferMember; people: TenantPeople; onRecorded: () => void; onOpenApprovals?: () => void;
}) {
  const t = useT();
  const [target, setTarget] = useState<OwnerTransferItem | null>(null);
  const departing = member.membershipState === "REVOKING";
  return <article className="flex flex-col gap-2 rounded-lg border p-4" data-testid={`owner-transfers-${member.principalId}`}>
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium">{member.displayName.trim() || t("owner.unnamed")}</span>
      {departing ? <Badge tone="negative">{t("ownerTransfers.pending", { count: member.items.length })}</Badge> : null}
    </div>
    <ul className="flex flex-col divide-y rounded-md border">
      {member.items.map((item) => <li key={item.resourceId} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
        data-testid={`owner-transfer-item-${item.resourceId}`}>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-medium">{item.name ?? t(TYPE_LABELS[item.typeKey] ?? "ownerTransfers.type.resource")}</span>
          <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span>{t(TYPE_LABELS[item.typeKey] ?? "ownerTransfers.type.resource")}</span>
            <span>{item.homeWorkspaceName ? t("ownerTransfers.inWorkspace", { name: item.homeWorkspaceName }) : t("ownerTransfers.inTenant")}</span>
            {item.assetCount > 0 ? <span>{t("ownerTransfers.assets", { count: item.assetCount })}</span> : null}
            {!item.ownedResource ? <span>{t("ownerTransfers.leftUnder")}<OwnerName people={people} principalId={item.resourceOwnerPrincipalId} /></span> : null}
          </span>
        </div>
        {item.blockReason ? <span className="text-xs text-muted-foreground">{t(BLOCK_LABELS[item.blockReason])}</span>
          : <Button disabled={target !== null} onClick={() => setTarget(item)}>
            {t(item.ownedResource ? "ownerTransfers.transfer" : "ownerTransfers.gather")}</Button>}
      </li>)}
    </ul>
    {member.truncated ? <Notice>{t("ownerTransfers.truncated")}</Notice> : null}
    {target ? <TransferForm key={target.resourceId} item={target} from={member} people={people}
      onDone={() => { setTarget(null); onRecorded(); }} onCancel={() => setTarget(null)} onOpenApprovals={onOpenApprovals} /> : null}
  </article>;
}

function TransferForm({ item, from, people, onDone, onCancel, onOpenApprovals }: {
  item: OwnerTransferItem; from: OwnerTransferMember; people: TenantPeople;
  onDone: () => void; onCancel: () => void; onOpenApprovals?: () => void;
}) {
  const client = useBffClient();
  const t = useT();
  const failureText = useFailureText();
  const fieldId = useId();
  // Left-behind Assets go back to the Resource's current owner; an owned Resource goes to a chosen member.
  const fixed = item.ownedResource ? null : item.resourceOwnerPrincipalId;
  const [owner, setOwner] = useState(fixed ?? "");
  const [key] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const [submission, setSubmission] = useState<ActionSubmission | null>(null);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const candidates = people.state.status === "ok"
    ? people.state.data.filter((person) => person.principalId !== from.principalId && person.principalId !== item.resourceOwnerPrincipalId)
      .map((person) => ({ value: person.principalId, label: person.displayName.trim() || t("owner.unnamed") }))
      .sort((a, b) => a.label.localeCompare(b.label))
    : [];
  const submit = async () => {
    if (!owner || busy) return;
    setBusy(true); setFailure(null);
    try {
      const result = await client.submitAction({ actionKey: "resource.transfer_owner", idempotencyKey: key,
        resourceId: item.resourceId, resourceVersion: item.resourceVersion, principalId: owner });
      setSubmission(result);
    } catch (error) { setFailure(writeFailure(error)); } finally { setBusy(false); }
  };
  const waiting = submission?.gateState === ActionGateState.Waiting;
  const settled = submission && submission.dispatchState !== ActionDispatchState.Unknown && submission.gateState !== ActionGateState.Evaluating;
  return <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3 text-sm" data-testid="owner-transfer-form">
    <p>{t(item.ownedResource ? "ownerTransfers.confirmTransfer" : "ownerTransfers.confirmGather",
      { name: item.name ?? t(TYPE_LABELS[item.typeKey] ?? "ownerTransfers.type.resource"), from: from.displayName })}</p>
    {fixed ? <p>{t("agents.newOwner")}: <OwnerName people={people} principalId={fixed} /></p>
      : people.state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : people.state.status === "error" ? <ReadFailure error={people.state.error} onRetry={people.reload} />
      : candidates.length === 0 ? <Notice>{t("agents.ownerNoCandidates")}</Notice>
      : <><label htmlFor={fieldId}>{t("agents.newOwner")}</label>
        <PersonaDropdownField id={fieldId} options={candidates} value={owner} placeholder={t("agents.newOwnerPlaceholder")}
          onValueChange={setOwner} disabled={submission !== null} /></>}
    <p className="text-xs text-muted-foreground">{t("ownerTransfers.approvalHint")}</p>
    {submission ? <p role="status">{waiting ? t("ownerTransfers.waiting") : settled ? t("ownerTransfers.recorded") : t("ownerTransfers.unknown")}</p> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"}>{failure.kind === "rejected"
      ? t("agents.rejected", { reason: failureText(failure) }) : t("ownerTransfers.unknown")}</p> : null}
    <div className="flex flex-wrap gap-2">
      {!submission ? <Button disabled={!owner || busy} onClick={() => void submit()}>{busy ? t("platform.loading") : t("ownerTransfers.submit")}</Button> : null}
      {waiting && onOpenApprovals ? <Button onClick={onOpenApprovals}>{t("agents.openApprovals")}</Button> : null}
      {submission && settled ? <Button onClick={onDone}>{t("ownerTransfers.done")}</Button>
        : !busy ? <Button onClick={onCancel}>{t("agents.cancel")}</Button> : null}
    </div>
  </div>;
}
