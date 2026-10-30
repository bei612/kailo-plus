// DD-164(4) (design 07 §4.7.2/§4.7.4): Kailo's share dialog for a component's
// native object. The component page only handed over a ComponentShareIntent;
// the object name, current grants and what may be granted come from Core, and
// the change is the governed `component.share.set` (explicit confirmation, the
// complete grant list replaces the current one). Kailo is the only authority:
// the grants reach the component through the member directory. DD-141 tokens.
import { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import {
  ActionDispatchState, ActionGateState, ComponentShareAccess, ComponentShareSubjectKind,
  type ComponentShareGrant, type ComponentShareIntentView, type ConversationParticipant, type WorkspaceView,
} from "@client-kit/contracts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./composer/shared/ui/dialog";
import { Button } from "./profile/buzz/shared/ui/button";
import { useBffClient, useReasonText, useT } from "./context";
import { useLoad } from "./use-load";
import { BffError, writeFailure } from "../transport";
import { newIdempotencyKey } from "../governance";

type People = { members: ConversationParticipant[]; workspaces: WorkspaceView[] };

const MAX_MEMBER_PAGES = 10;

function subjectKey(grant: ComponentShareGrant): string {
  const subject = grant.subject;
  return subject.kind === ComponentShareSubjectKind.Principal ? `p:${subject.principalId}`
    : subject.kind === ComponentShareSubjectKind.Workspace ? `w:${subject.workspaceId}` : "t";
}

/** The grant list Core accepts: one per subject, TENANT only READ, nothing for the owner. */
export function normalizedGrants(grants: readonly ComponentShareGrant[], owner?: string): ComponentShareGrant[] {
  const seen = new Map<string, ComponentShareGrant>();
  for (const grant of grants) {
    if (grant.subject.kind === ComponentShareSubjectKind.Principal && (!grant.subject.principalId || grant.subject.principalId === owner)) continue;
    if (grant.subject.kind === ComponentShareSubjectKind.Workspace && !grant.subject.workspaceId) continue;
    const access = grant.subject.kind === ComponentShareSubjectKind.Tenant ? ComponentShareAccess.Read : grant.access;
    seen.set(subjectKey(grant), { subject: grant.subject, access });
  }
  return [...seen.values()];
}

export function ComponentShareDialog({ intentId, onClose }: { intentId: string; onClose: () => void }) {
  const client = useBffClient();
  const t = useT();
  const [intent, reloadIntent] = useLoad(`component-share-intent:${intentId}`, () => client.componentShareIntent(intentId));
  const [people] = useLoad<People>(`component-share-people:${intentId}`, async () => {
    const members: ConversationParticipant[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_MEMBER_PAGES; page += 1) {
      const read = await client.conversationParticipants(cursor);
      members.push(...read.items);
      cursor = read.nextCursor;
      if (!cursor) break;
    }
    return { members, workspaces: await client.workspaces() };
  });
  const expired = intent.status === "error" && intent.error instanceof BffError && intent.error.status === 404;
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent showCloseButton={false} aria-describedby={undefined} data-testid="component-share-dialog"
      className="flex max-h-[85vh] max-w-lg flex-col gap-0 overflow-hidden p-0">
      <DialogHeader className="flex shrink-0 flex-row items-start justify-between gap-3 px-6 pt-5 pb-3">
        <DialogTitle className="text-base font-semibold text-foreground">
          {intent.status === "ok" ? t("componentShare.title", { name: intent.data.name }) : t("componentShare.kind")}
        </DialogTitle>
        <Button aria-label={t("componentShare.close")} size="icon-xs" variant="ghost" onClick={onClose}><X aria-hidden="true" /></Button>
      </DialogHeader>
      {intent.status === "pending" ? <p role="status" className="px-6 pb-6 text-sm text-muted-foreground">{t("componentShare.loading")}</p>
        : intent.status === "error" ? <div role="alert" className="flex flex-col gap-3 px-6 pb-6 text-sm text-foreground" data-testid="component-share-unavailable">
          <span>{expired ? t("componentShare.expired") : t("platform.loadFailed")}</span>
          <div className="flex justify-end gap-2">
            {expired ? null : <Button variant="outline" onClick={reloadIntent}>{t("platform.retry")}</Button>}
            <Button onClick={onClose}>{t("componentShare.close")}</Button>
          </div></div>
        : <ShareEditor intent={intent.data} people={people.status === "ok" ? people.data : null} peopleFailed={people.status === "error"} onClose={onClose} />}
    </DialogContent>
  </Dialog>;
}

function ShareEditor({ intent, people, peopleFailed, onClose }: { intent: ComponentShareIntentView; people: People | null; peopleFailed: boolean; onClose: () => void }) {
  const client = useBffClient();
  const t = useT();
  const reasonText = useReasonText();
  const [grants, setGrants] = useState<ComponentShareGrant[]>(() => normalizedGrants(intent.grants, intent.ownerPrincipalId));
  const [kind, setKind] = useState<ComponentShareSubjectKind>(intent.allowedSubjects[0] ?? ComponentShareSubjectKind.Tenant);
  const [target, setTarget] = useState("");
  const [access, setAccess] = useState<ComponentShareAccess>(ComponentShareAccess.Read);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "saving" } | { kind: "unknown" } | { kind: "rejected"; text: string }>({ kind: "idle" });
  // One idempotency key per intended change; a retry after an unknown outcome reuses it.
  const attempt = useRef<{ key: string; body: string } | null>(null);
  const editable = intent.canShare && state.kind !== "saving" && state.kind !== "unknown";
  const names = useMemo(() => new Map<string, string>([
    ...(people?.members ?? []).map((member) => [`p:${member.principalId}`, member.displayName] as const),
    ...(people?.workspaces ?? []).map((workspace) => [`w:${workspace.id}`, workspace.name] as const),
  ]), [people]);
  const label = (grant: ComponentShareGrant) => grant.subject.kind === ComponentShareSubjectKind.Tenant
    ? t("componentShare.subject.tenant") : names.get(subjectKey(grant)) ?? t("componentShare.unknownSubject");
  const kindLabel = (value: ComponentShareSubjectKind) => value === ComponentShareSubjectKind.Principal ? t("componentShare.subject.person")
    : value === ComponentShareSubjectKind.Workspace ? t("componentShare.subject.workspace") : t("componentShare.subject.tenant");
  const taken = new Set(grants.map(subjectKey));
  const candidates = kind === ComponentShareSubjectKind.Principal
    ? (people?.members ?? []).filter((member) => member.principalId !== intent.ownerPrincipalId && !taken.has(`p:${member.principalId}`))
      .map((member) => ({ id: member.principalId, name: member.displayName }))
    : kind === ComponentShareSubjectKind.Workspace
      ? (people?.workspaces ?? []).filter((workspace) => !taken.has(`w:${workspace.id}`)).map((workspace) => ({ id: workspace.id, name: workspace.name }))
      : [];
  const canAdd = editable && (kind === ComponentShareSubjectKind.Tenant ? !taken.has("t") : candidates.some((candidate) => candidate.id === target));
  const add = () => {
    if (!canAdd) return;
    const subject = kind === ComponentShareSubjectKind.Principal ? { kind, principalId: target }
      : kind === ComponentShareSubjectKind.Workspace ? { kind, workspaceId: target } : { kind };
    setGrants((current) => normalizedGrants([...current, { subject, access: kind === ComponentShareSubjectKind.Tenant ? ComponentShareAccess.Read : access }], intent.ownerPrincipalId));
    setTarget("");
    if (state.kind === "rejected") setState({ kind: "idle" });
  };
  const save = async () => {
    const body = normalizedGrants(grants, intent.ownerPrincipalId);
    const serialized = JSON.stringify(body);
    if (!attempt.current || attempt.current.body !== serialized || state.kind !== "unknown")
      attempt.current = { key: newIdempotencyKey(), body: serialized };
    setState({ kind: "saving" });
    try {
      const submission = await client.submitAction({
        actionKey: "component.share.set",
        idempotencyKey: attempt.current.key,
        // SYNC, EXPLICIT: the user confirmed this complete grant list in the dialog.
        explicitConfirmation: true,
        componentShareSet: { intentId: intent.intentId, grants: body, ...(intent.resourceVersion !== undefined ? { resourceVersion: intent.resourceVersion } : {}) },
      });
      if (submission.gateState === ActionGateState.Allowed && submission.dispatchState === ActionDispatchState.Dispatched) {
        setState({ kind: "idle" });
        onClose();
        toast.success(t("componentShare.saved"));
        return;
      }
      if (submission.dispatchState === ActionDispatchState.Unknown || submission.gateState === ActionGateState.Evaluating) { setState({ kind: "unknown" }); return; }
      setState({ kind: "rejected", text: t("componentShare.rejected", { reason: submission.reason ? reasonText(submission.reason) : submission.gateState }) });
    } catch (error) {
      const failure = writeFailure(error);
      if (failure.kind === "unknown") setState({ kind: "unknown" });
      else setState({ kind: "rejected", text: t("componentShare.rejected", { reason: failure.reason ? reasonText(failure.reason) : failure.detail }) });
    }
  };
  return <>
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-4">
      {intent.canShare ? null : <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground" data-testid="component-share-read-only">{t("componentShare.readOnly")}</p>}
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" data-testid="component-share-grants">
        {grants.length === 0 ? <li className="px-3 py-2.5 text-sm text-muted-foreground">{t("componentShare.empty")}</li> : null}
        {grants.map((grant) => <li key={subjectKey(grant)} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span className="min-w-0 truncate text-foreground">{label(grant)}<span className="ml-2 text-xs text-muted-foreground">{kindLabel(grant.subject.kind)}</span></span>
          <span className="flex shrink-0 items-center gap-2">
            {grant.subject.kind === ComponentShareSubjectKind.Tenant
              ? <span className="text-xs text-muted-foreground">{t("componentShare.access.read")}</span>
              : <select aria-label={t("componentShare.access")} disabled={!editable} value={grant.access}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                onChange={(event) => setGrants((current) => current.map((item) => subjectKey(item) === subjectKey(grant) ? { ...item, access: event.target.value as ComponentShareAccess } : item))}>
                <option value={ComponentShareAccess.Read}>{t("componentShare.access.read")}</option>
                <option value={ComponentShareAccess.Write}>{t("componentShare.access.write")}</option>
              </select>}
            <Button aria-label={t("componentShare.remove", { name: label(grant) })} disabled={!editable} size="icon-xs" variant="ghost"
              onClick={() => setGrants((current) => current.filter((item) => subjectKey(item) !== subjectKey(grant)))}><X aria-hidden="true" /></Button>
          </span>
        </li>)}
      </ul>
      {intent.canShare ? <div className="flex flex-wrap items-end gap-2" data-testid="component-share-add">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">{t("componentShare.kind")}
          <select value={kind} disabled={!editable} className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            onChange={(event) => { setKind(event.target.value as ComponentShareSubjectKind); setTarget(""); }}>
            {intent.allowedSubjects.map((value) => <option key={value} value={value}>{kindLabel(value)}</option>)}
          </select></label>
        {kind === ComponentShareSubjectKind.Tenant ? null : <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted-foreground">{t("componentShare.target")}
          <select value={target} disabled={!editable || !people} className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            onChange={(event) => setTarget(event.target.value)}>
            <option value="">{t("componentShare.choose")}</option>
            {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
          </select></label>}
        {kind === ComponentShareSubjectKind.Tenant ? null : <label className="flex flex-col gap-1 text-xs text-muted-foreground">{t("componentShare.access")}
          <select value={access} disabled={!editable} className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            onChange={(event) => setAccess(event.target.value as ComponentShareAccess)}>
            <option value={ComponentShareAccess.Read}>{t("componentShare.access.read")}</option>
            <option value={ComponentShareAccess.Write}>{t("componentShare.access.write")}</option>
          </select></label>}
        <Button variant="outline" disabled={!canAdd} onClick={add}>{t("componentShare.add")}</Button>
      </div> : null}
      {peopleFailed ? <p role="status" className="text-xs text-warning-text">{t("componentShare.peopleFailed")}</p> : null}
      {state.kind === "unknown" ? <p role="status" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-text" data-testid="component-share-unknown">{t("componentShare.unknown")}</p> : null}
      {state.kind === "rejected" ? <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-text" data-testid="component-share-rejected">{state.text}</p> : null}
    </div>
    <div className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-3">
      <Button variant="outline" disabled={state.kind === "saving" || state.kind === "unknown"} onClick={onClose}>{t("platform.cancel")}</Button>
      {intent.canShare ? <Button data-testid="component-share-save" disabled={state.kind === "saving"} onClick={() => void save()}>
        {state.kind === "saving" ? t("componentShare.saving") : state.kind === "unknown" ? t("componentShare.retry") : t("componentShare.save")}
      </Button> : null}
    </div>
  </>;
}
