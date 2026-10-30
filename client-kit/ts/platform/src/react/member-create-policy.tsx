// DD-164(3) (design 02 DD-164, 07 §4.7.4 schema 2): who may create content — in Kailo and,
// through the member directory, in the components. The Tenant admin chooses MEMBERS_CREATE
// (default: every member holds tenant#creator) or ADMINS_ONLY with the governed
// tenant.member_create_policy.set (SYNC, explicit confirmation). Owners always keep their
// own resources. Shown only when Core offers the action (policyActionKey) to this manager.
import { useEffect, useState } from "react";
import { TenantMemberCreatePolicy, type TenantProfileView } from "@client-kit/contracts";
import { Button } from "./profile/buzz/shared/ui/button";
import { AgentAlertDialog, AlertDialogCancel } from "./agent-library/AgentAlertDialog";
import { useT } from "./context";
import { channelActionOutcomeText, useGovernedChannelAction } from "./channel-management-actions";
import { ReadFailure } from "./ui";

export const MEMBER_CREATE_POLICY_ACTION = "tenant.member_create_policy.set";

/** The Tenant profile carries the policy only for managers who may change it. */
export function memberCreatePolicyEditable(view: TenantProfileView | undefined): view is TenantProfileView & { memberCreatePolicy: TenantMemberCreatePolicy } {
  return !!view && view.policyActionKey === MEMBER_CREATE_POLICY_ACTION
    && Object.values(TenantMemberCreatePolicy).includes(view.memberCreatePolicy as TenantMemberCreatePolicy)
    && Number.isSafeInteger(view.version) && view.version >= 1;
}

const OPTIONS = [
  { value: TenantMemberCreatePolicy.MembersCreate, label: "memberPermissions.membersCreate", hint: "memberPermissions.membersCreateHint" },
  { value: TenantMemberCreatePolicy.AdminsOnly, label: "memberPermissions.adminsOnly", hint: "memberPermissions.adminsOnlyHint" },
] as const;

export function MemberCreatePolicyPanel({ profile, onChanged }: { profile: TenantProfileView; onChanged: () => void }) {
  const t = useT();
  const editable = memberCreatePolicyEditable(profile);
  const current = editable ? profile.memberCreatePolicy : undefined;
  const [choice, setChoice] = useState<TenantMemberCreatePolicy | undefined>(current);
  const [confirming, setConfirming] = useState(false);
  const write = useGovernedChannelAction(() => { onChanged(); }, true);
  useEffect(() => { if (!write.unknown) setChoice(current); }, [current, write.unknown]);
  if (!editable) return null;
  const locked = write.busy || write.unknown;
  const submit = async () => {
    setConfirming(false);
    if (write.unknown) { await write.submit(); return; }
    if (!choice || choice === current) return;
    await write.submit({ actionKey: MEMBER_CREATE_POLICY_ACTION, explicitConfirmation: true,
      tenantMemberCreatePolicy: { policy: choice, expectedVersion: profile.version } });
  };
  return <section className="flex flex-col gap-4" data-testid="member-create-policy">
    <div className="flex flex-col gap-1">
      <h2 className="text-sm font-medium">{t("memberPermissions.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("memberPermissions.description")}</p>
    </div>
    <fieldset className="flex flex-col gap-2" disabled={locked}>
      <legend className="sr-only">{t("memberPermissions.title")}</legend>
      {OPTIONS.map((option) => <label key={option.value}
        className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 text-sm ${choice === option.value ? "border-primary bg-brand-soft" : "border-border bg-card"}`}>
        <input type="radio" name="member-create-policy" className="mt-1" value={option.value} checked={choice === option.value}
          onChange={() => setChoice(option.value)} data-testid={`member-create-policy-${option.value}`} />
        <span className="flex flex-col gap-0.5"><span className="font-medium text-foreground">{t(option.label)}</span>
          <span className="text-muted-foreground">{t(option.hint)}</span></span>
      </label>)}
    </fieldset>
    <p className="text-xs text-muted-foreground">{t("memberPermissions.ownersKeep")}</p>
    <div className="flex justify-end">
      <Button data-testid="member-create-policy-save" disabled={write.busy || (!write.unknown && (!choice || choice === current))}
        onClick={() => { if (write.unknown) void submit(); else setConfirming(true); }}>
        {t(write.unknown ? "memberPermissions.retry" : "memberPermissions.save")}
      </Button>
    </div>
    {write.outcome ? <p role="status" data-testid="member-create-policy-outcome" className="text-sm text-muted-foreground">{channelActionOutcomeText(t, write.outcome)}</p> : null}
    <AgentAlertDialog open={confirming} onOpenChange={setConfirming} testId="member-create-policy-confirm"
      title={t("memberPermissions.confirmTitle")}
      description={t(choice === TenantMemberCreatePolicy.AdminsOnly ? "memberPermissions.confirmAdminsOnly" : "memberPermissions.confirmMembersCreate")}
      footer={<>
        <AlertDialogCancel asChild><Button type="button" variant="outline">{t("platform.cancel")}</Button></AlertDialogCancel>
        <Button type="button" data-testid="member-create-policy-confirm-button" onClick={(event) => { event.preventDefault(); void submit(); }}>{t("platform.confirm")}</Button>
      </>}>
      <p className="text-sm text-muted-foreground">{t("memberPermissions.ownersKeep")}</p>
    </AgentAlertDialog>
  </section>;
}

/** Admin-area section body: reads the Tenant profile and renders the panel for managers. */
export function MemberPermissionsSection({ profile, reload, error }: { profile: TenantProfileView | undefined; reload: () => void; error?: unknown }) {
  if (error !== undefined) return <ReadFailure error={error} onRetry={reload} />;
  return profile ? <MemberCreatePolicyPanel key={`${profile.version}:${profile.memberCreatePolicy ?? ""}`} profile={profile} onChanged={reload} /> : null;
}

