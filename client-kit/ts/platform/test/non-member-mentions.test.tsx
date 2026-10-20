// DD-125(8) / V-SCN-162..163: mentioning people outside a Workspace channel.
import { act, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionDispatchState,
  ActionGateState,
  ReasonCode,
  WorkspaceMembershipState,
  type ActionCommand,
  type ActionSubmission,
  type WorkspaceMemberView,
} from "@client-kit/contracts";
import { setLocale, translate } from "../src/i18n";
import {
  NonMemberMentionDialog,
  inviteAndAwaitActive,
  loadTenantMentionDirectory,
  mergeReferenceMentionTags,
  nonMemberInvitePrincipals,
  outsideMentionPeople,
  partitionNonMemberMentions,
  useNonMemberInvite,
  withoutInvitingRecipients,
  WORKSPACE_MEMBER_ADD_ACTION,
  type NonMemberInviteResult,
} from "../src/react/non-member-mentions";
import { TransportError } from "../src/transport";
import { click, render, settle } from "./render";

const member = "a".repeat(64), outsider = "b".repeat(64), agent = "c".repeat(64), second = "d".repeat(64);
const olive = { principalId: "olive", displayName: "Olive" };
const en = (key: Parameters<typeof translate>[1]) => translate("en", key);

beforeEach(() => setLocale("en"));

describe("non-member partition", () => {
  it("judges only Workspace channels with a resolved roster and never Agents", () => {
    expect(partitionNonMemberMentions({ mentionPubkeys: [member, outsider.toUpperCase(), agent, outsider], memberPubkeys: [member], isDm: false,
      excludedPubkeys: [agent] })).toEqual({ members: [member, agent], nonMembers: [outsider] });
    expect(partitionNonMemberMentions({ mentionPubkeys: [member, outsider], memberPubkeys: [member], isDm: true }).nonMembers).toEqual([]);
    expect(partitionNonMemberMentions({ mentionPubkeys: [member, outsider], memberPubkeys: null, isDm: false }).nonMembers).toEqual([]);
  });

  it("send without inviting keeps notifying and reference mentions disjoint, sorted and de-duplicated", () => {
    const result = withoutInvitingRecipients({ mentionPubkeys: [second, member, outsider, second], nonMemberPubkeys: [second, outsider.toUpperCase(), second] });
    expect(result).toEqual({ mentionPubkeys: [member], referenceMentionPubkeys: [outsider, second] });
    expect(result.mentionPubkeys.filter((key) => result.referenceMentionPubkeys.includes(key))).toEqual([]);
    expect(mergeReferenceMentionTags([["mention", outsider], ["emoji", "x"]], [outsider, second]))
      .toEqual([["mention", outsider], ["emoji", "x"], ["mention", second]]);
  });

  it("offers same-Tenant people outside the channel, excluding members by key and by Principal", async () => {
    const pages = [
      { items: [{ principalId: "member", displayName: "Mia", pubkeys: [member, second] }, { principalId: "olive", displayName: "Olive", pubkeys: [outsider.toUpperCase()] }], maxParticipants: 8, nextCursor: "next" },
      { items: [{ principalId: "renamed", displayName: "Ren", pubkeys: ["e".repeat(64)] }], maxParticipants: 8 },
    ];
    const conversationParticipants = vi.fn(async (cursor?: string) => pages[cursor ? 1 : 0]!);
    const directory = await loadTenantMentionDirectory({ conversationParticipants });
    expect(conversationParticipants).toHaveBeenCalledTimes(2);
    expect(outsideMentionPeople({ directory, memberPubkeys: [member], memberPrincipalIds: ["renamed"] }))
      .toEqual([{ pubkey: outsider, displayName: "Olive", principalId: "olive", notInChannel: true }]);
    expect(nonMemberInvitePrincipals(directory, [outsider, "f".repeat(64)])).toEqual({ principals: [olive], unresolved: ["f".repeat(64)] });
    await expect(loadTenantMentionDirectory({ conversationParticipants: async () => pages[0]! })).rejects.toBeInstanceOf(TransportError);
  });
});

function view(principalId: string, state: WorkspaceMembershipState): WorkspaceMemberView {
  return { principalId, displayName: principalId, pubkeys: [], state };
}
function accepted(command: ActionCommand, gateState = ActionGateState.Allowed, dispatchState = ActionDispatchState.Dispatched): ActionSubmission {
  return { actionExecutionId: `execution-${command.principalId}`, actionKey: command.actionKey, operationId: "operation", gateState, dispatchState };
}
/** A deterministic clock: each poll interval advances it. */
function clock() {
  let time = 0;
  return { now: () => time, sleep: vi.fn(async (ms: number) => { time += Math.max(ms, 1); }) };
}

describe("inviteAndAwaitActive", () => {
  it("submits workspace.member.add per person and resolves only once every membership is ACTIVE", async () => {
    const rosters = [[], [view("olive", WorkspaceMembershipState.Provisioning)], [view("olive", WorkspaceMembershipState.Active)]];
    const members = vi.fn(async () => rosters.shift() ?? []);
    const submitAction = vi.fn(async (command: ActionCommand) => accepted(command));
    const result = await inviteAndAwaitActive({ client: { members, submitAction }, workspaceId: "workspace-a", principals: [olive],
      ...clock(), idempotencyKey: () => "key-1" });
    expect(result).toEqual({ status: "active" });
    expect(submitAction).toHaveBeenCalledExactlyOnceWith({ actionKey: WORKSPACE_MEMBER_ADD_ACTION, idempotencyKey: "key-1", workspaceId: "workspace-a", principalId: "olive" });
    expect(members).toHaveBeenCalledTimes(3);
  });

  it("only waits for a membership already PROVISIONING", async () => {
    const rosters = [[view("olive", WorkspaceMembershipState.Provisioning)], [view("olive", WorkspaceMembershipState.Active)]];
    const submitAction = vi.fn();
    const result = await inviteAndAwaitActive({ client: { members: async () => rosters.shift() ?? [], submitAction }, workspaceId: "workspace-a", principals: [olive], ...clock() });
    expect(result).toEqual({ status: "active" });
    expect(submitAction).not.toHaveBeenCalled();
  });

  it("fails without publishing when the add is refused or the membership converges to ERROR", async () => {
    const refused = await inviteAndAwaitActive({ client: { members: async () => [],
      submitAction: async (command) => ({ ...accepted(command, ActionGateState.Denied, ActionDispatchState.NotDispatched), reason: ReasonCode.PermissionDenied }) },
    workspaceId: "workspace-a", principals: [olive], ...clock() });
    expect(refused).toEqual({ status: "rejected", principals: [olive], reason: ReasonCode.PermissionDenied });
    const rosters = [[], [view("olive", WorkspaceMembershipState.Error)]];
    const errored = await inviteAndAwaitActive({ client: { members: async () => rosters.shift() ?? [], submitAction: async (command) => accepted(command) },
      workspaceId: "workspace-a", principals: [olive], ...clock() });
    expect(errored).toEqual({ status: "error", principals: [olive] });
  });

  it("times out at the bound while a membership has not become ACTIVE", async () => {
    const time = clock();
    const result = await inviteAndAwaitActive({ client: { members: async () => [view("olive", WorkspaceMembershipState.Provisioning)], submitAction: vi.fn() },
      workspaceId: "workspace-a", principals: [olive], timeoutMs: 5_000, pollMs: 1_000, ...time });
    expect(result).toEqual({ status: "timeout", principals: [olive] });
    expect(time.sleep).toHaveBeenCalledTimes(5);
  });

  it("stops submitting and waiting once cancelled", async () => {
    const controller = new AbortController();
    const submitAction = vi.fn(async (command: ActionCommand) => { controller.abort(); return accepted(command); });
    const result = await inviteAndAwaitActive({ client: { members: async () => [], submitAction }, workspaceId: "workspace-a",
      principals: [olive, { principalId: "grace", displayName: "Grace" }], signal: controller.signal, ...clock() });
    expect(result).toEqual({ status: "cancelled" });
    expect(submitAction).toHaveBeenCalledTimes(1);
  });
});

describe("NonMemberMentionDialog", () => {
  const dialogButtons = () => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].map((button) => button.textContent);

  it("without add admission offers only Send anyway and Cancel", async () => {
    const send = vi.fn(), dismiss = vi.fn(), invite = vi.fn();
    await render(<NonMemberMentionDialog open canInvite={false} error={null} isInvitePending={false} names={["Olive"]}
      onDismiss={dismiss} onDoNothing={send} onInvite={invite} />);
    expect(dialogButtons()).toEqual([en("platform.cancel"), en("buzz.nonMemberMention.sendAnyway")]);
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain(en("buzz.nonMemberMention.title"));
    expect(dialog.textContent).toContain(`${translate("en", "buzz.nonMemberMention.notInChannelOne", { names: "Olive" })} ${en("buzz.nonMemberMention.addDenied")}`);
    // The safe action has focus, as in the original.
    expect(document.activeElement?.textContent).toBe(en("buzz.nonMemberMention.sendAnyway"));
    await click([...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')][1]!);
    expect(send).toHaveBeenCalledTimes(1);
    expect(invite).not.toHaveBeenCalled();
  });

  it("with admission offers Do nothing and Invite, shows the pending label and the error", async () => {
    await render(<NonMemberMentionDialog open canInvite error="Could not add Olive" isInvitePending names={["Olive", "Grace"]}
      onDismiss={vi.fn()} onDoNothing={vi.fn()} onInvite={vi.fn()} />);
    expect(dialogButtons()).toEqual([en("platform.cancel"), en("buzz.nonMemberMention.doNothing"), en("buzz.nonMemberMention.inviting")]);
    expect(document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent).toBe("Could not add Olive");
    expect(document.querySelector('[role="alertdialog"]')!.textContent)
      .toContain(translate("en", "buzz.nonMemberMention.notInChannelMany", { names: "Olive, Grace" }));
  });
});

describe("useNonMemberInvite", () => {
  function Harness({ run, onActive }: { run: (draft: object, signal: AbortSignal) => Promise<NonMemberInviteResult>; onActive: () => void }) {
    const [draft, setDraft] = useState<object | null>({});
    const [error, setError] = useState<string | null>(null);
    const invitation = useNonMemberInvite({ draft, canInvite: true, run, onActive, setError });
    return <div>
      <button type="button" onClick={invitation.invite}>invite</button>
      <button type="button" onClick={() => { invitation.cancel(); setDraft(null); }}>cancel</button>
      <output>{invitation.isPending ? "pending" : "idle"}</output>
      <p role="alert">{error}</p>
    </div>;
  }
  const byText = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].find((button) => button.textContent === text)!;

  it("guards double clicks and never publishes an intent cancelled while the add converges", async () => {
    let finish!: (result: NonMemberInviteResult) => void;
    const run = vi.fn(() => new Promise<NonMemberInviteResult>((resolve) => { finish = resolve; }));
    const onActive = vi.fn();
    const host = await render(<Harness run={run} onActive={onActive} />);
    await act(async () => { byText(host, "invite").click(); byText(host, "invite").click(); });
    expect(run).toHaveBeenCalledTimes(1);
    expect(host.querySelector("output")?.textContent).toBe("pending");
    await click(byText(host, "cancel"));
    await act(async () => finish({ status: "active" }));
    await settle();
    expect(onActive).not.toHaveBeenCalled();
    expect(host.querySelector("output")?.textContent).toBe("idle");
  });

  it("keeps the draft and reports a failed invitation by name", async () => {
    const onActive = vi.fn();
    const host = await render(<Harness run={async () => ({ status: "timeout", principals: [olive] })} onActive={onActive} />);
    await click(byText(host, "invite"));
    expect(onActive).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(translate("en", "buzz.nonMemberMention.inviteTimeout", { names: "Olive" }));
  });
});
