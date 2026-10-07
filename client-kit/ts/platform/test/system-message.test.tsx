import { act, type ComponentProps, type ReactNode } from "react";
import { afterEach, expect, it } from "vitest";
import { render } from "./render";
import { setLocale } from "../src/i18n";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import type { TimelineMessage } from "../src/react/messages/types";
import { SystemMessageRowSurface } from "../src/react/messages/system/SystemMessageRow";
import { buildGroupedMembershipPayload } from "../src/react/messages/system/membershipGroupPayload";
import { TooltipProvider } from "../src/react/sidebar/tooltip";

const alice = "a".repeat(64);
const bob = "b".repeat(64);
const owner = "c".repeat(64);
const profiles = {
  [alice]: { displayName: "Alice", avatarUrl: null, nip05Handle: null, ownerPubkey: null },
  [bob]: { displayName: "Bob", avatarUrl: null, nip05Handle: null, ownerPubkey: null },
};
function message(id: string, payload: unknown): TimelineMessage {
  return { id, createdAt: 1770000000, author: "Relay", time: "", depth: 0, kind: 40099, body: JSON.stringify(payload) };
}
function Profile({ children, pubkey }: { children: ReactNode; pubkey: string }) {
  return <span data-profile-key={pubkey}>{children}</span>;
}
function row(props: Omit<ComponentProps<typeof SystemMessageRowSurface>, "ProfilePopover">) {
  return <TooltipProvider><SystemMessageRowSurface ProfilePopover={Profile} {...props} /></TooltipProvider>;
}
afterEach(async () => { await act(async () => { setLocale("zh-CN"); }); });

it("renders original self-join and departure copy with the actual profile entry in both languages", async () => {
  setLocale("zh-CN");
  const joined = message("joined", { type: "member_joined", actor: alice, target: alice });
  const left = message("left", { type: "member_left", actor: bob });
  const host = await render(<>{row({ message: joined, profiles, currentPubkey: alice })}{row({ message: left, profiles })}</>);
  expect(host.textContent).toContain("你");
  expect(host.textContent).toContain("加入了频道");
  expect(host.textContent).toContain("Bob");
  expect(host.textContent).toContain("离开了频道");
  expect(host.querySelector(`[data-profile-key="${alice}"]`)).not.toBeNull();
  await act(async () => { setLocale("en"); });
  expect(host.textContent).toContain("You");
  expect(host.textContent).toContain("joined the channel");
  expect(host.textContent).toContain("left the channel");
});

it("retains all original grouped arrivals and duplicate-self-join departure lifecycle", async () => {
  setLocale("en");
  const first = message("first", { type: "member_joined", actor: alice, target: alice });
  const other = message("other", { type: "member_joined", actor: alice, target: bob });
  const departure = message("departure", { type: "member_left", actor: alice });
  const lifecycle = [first, { ...first, id: "duplicate" }, departure];
  expect(buildGroupedMembershipPayload(lifecycle)).toEqual({ type: "member_joined_then_left", target: alice });
  const arrivals = await render(row({ message: first, groupedMessages: [first, other], profiles }));
  expect(arrivals.textContent).toContain("Alice");
  expect(arrivals.textContent).toContain("Bob");
  const lifecycleHost = await render(row({ message: first, groupedMessages: lifecycle, profiles }));
  expect(lifecycleHost.textContent).toContain("joined, then left the channel");
});

it("localizes a different member's invited arrival without changing the actor identity", async () => {
  setLocale("zh-CN");
  const host = await render(row({ message: message("invited", { type: "member_joined", actor: alice, target: bob }), profiles }));
  expect(host.textContent).toContain("Bob");
  expect(host.textContent).toContain("被添加，操作者为");
  expect(host.textContent).not.toContain("added by");
  expect(host.querySelector(`[data-profile-key="${alice}"]`)?.textContent).toContain("Alice");
});

it("shows only the public moderation reason and never deleted content or private reporter evidence", async () => {
  setLocale("zh-CN");
  const tombstone = message("removed", { type: "message_deleted", actor: alice,
    public_reason: "违反社区规则", reason_code: "SPAM", action_id: "audit-reference",
    content: "secret-deleted-body", reporter: "secret-reporter", evidence: "secret-evidence" });
  const host = await render(row({ message: tombstone, profiles }));
  expect(host.textContent).toContain("已被社区管理员移除");
  expect(host.textContent).toContain("违反社区规则");
  expect(host.textContent).not.toMatch(/secret-|SPAM|audit-reference/);
});

it("keeps malformed and unknown system envelopes out of the user-facing message body", async () => {
  const invalid = message("invalid", { type: "member_joined", actor: 5, target: alice, content: "not-public" });
  const unknown = message("unknown", { type: "not-supported", content: "not-public" });
  const host = await render(<>{row({ message: invalid, profiles })}{row({ message: unknown, profiles })}
    {row({ message: message("null", null), profiles })}{row({ message: message("array", [{ type: "member_left" }]), profiles })}</>);
  expect(host.textContent).toBe("");
});

it("honors the explicit host language for system actions, identity and owner copy over the device preference", async () => {
  setLocale("zh-CN");
  const client = createBffClient({ send: async () => { throw new Error("System display must not issue management requests"); } });
  const changed = message("topic", { type: "topic_changed", actor: alice, topic: "Release" });
  const host = await render(<PlatformProvider client={client} locale="en">{row({ message: changed, profiles, currentPubkey: alice })}</PlatformProvider>);
  expect(host.textContent).toContain("You");
  expect(host.textContent).toContain("changed the topic to “Release”");
  expect(host.textContent).not.toContain("将话题改为");
});

it("uses real agent ownership and retains unavailable-owner semantics instead of inventing an owner", async () => {
  setLocale("en");
  const agentProfiles = { ...profiles, [bob]: { ...profiles[bob]!, isAgent: true, ownerPubkey: owner } };
  const agentLeft = message("agent-topic", { type: "topic_changed", actor: bob, topic: "Release" });
  const ownerProfiles = { [owner]: { displayName: "Carol", avatarUrl: null, nip05Handle: null, ownerPubkey: null } };
  const host = await render(row({ message: agentLeft, profiles: agentProfiles, ownerProfiles }));
  expect(host.querySelector('[data-testid="message-agent-owner"]')?.textContent).toContain("managed by");
  expect(host.querySelector(`[data-profile-key="${owner}"]`)?.textContent).toContain("Carol");
  await act(async () => { setLocale("zh-CN"); });
  expect(host.querySelector('[data-testid="message-agent-owner"]')?.textContent).toContain("管理者为");
  const unavailable = await render(row({ message: agentLeft, profiles: { ...profiles, [bob]: { ...profiles[bob]!, isAgent: true } } }));
  expect(unavailable.querySelector('[data-testid="message-agent-owner"]')?.textContent).toContain("管理者信息不可用");
  expect(unavailable.querySelector(`[data-profile-key="${owner}"]`)).toBeNull();
});
