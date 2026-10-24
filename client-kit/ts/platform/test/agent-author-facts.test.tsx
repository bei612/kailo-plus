import { expect, it } from "vitest";
import { act } from "react";
import { WorkspaceMembershipState } from "@client-kit/contracts";
import { setLocale } from "../src/i18n";
import {
  AgentAuthorFactsProvider, MessageRowSurface, agentAddressHost, agentAuthorFacts,
  buildAgentAddressMentionTags, getAgentAddressMentionPubkeys, getVisibleAgentAddressPubkeys,
  withAgentAuthorFacts, type AgentOwnerRenderer, type TimelineMessage,
} from "../src/react/messages";
import { InboxMessageRowSurface } from "../src/react/inbox-surface";
import { UserProfilePopoverSurface } from "../src/react/pulse/UserProfilePopover";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { render } from "./render";

const AGENT = "a".repeat(64);
const OTHER = "b".repeat(64);
const OWNER_KEY = "c".repeat(64);
const directory = {
  principalId: "owner-principal",
  agents: [
    { agentPubkey: AGENT.toUpperCase(), agentDisplayName: "Builder", installationResourceId: "inst-1",
      ownerPrincipalId: "owner-principal", ownerDisplayName: " Dana " },
    { agentPubkey: OTHER, agentDisplayName: "Reviewer", installationResourceId: "inst-2", ownerPrincipalId: "gone-principal" },
  ],
  members: [
    { principalId: "owner-principal", state: WorkspaceMembershipState.Active, pubkeys: [OWNER_KEY], displayName: "Dana" },
  ],
} as never;
const message: TimelineMessage = { id: "m1", pubkey: AGENT, author: "Builder", body: "Done", createdAt: 1770000000, depth: 0, time: "", tags: [] };

it("keeps the original agent-address tag helpers: addressed ∩ delivered, ordered, inline mentions hidden", () => {
  expect(buildAgentAddressMentionTags([OTHER, AGENT.toUpperCase(), OTHER], [AGENT])).toEqual([["mention", AGENT, "agent-address"]]);
  const tags = [["p", AGENT], ["mention", OTHER, "agent-address"], ["mention", AGENT], ["mention", AGENT, "agent-address"], ["mention", OTHER, "agent-address"]];
  expect(getAgentAddressMentionPubkeys(tags)).toEqual([OTHER, AGENT]);
  const label = (pubkey: string) => pubkey === AGENT ? "Builder" : "Reviewer";
  expect(getVisibleAgentAddressPubkeys("ask @Builder please", [AGENT, OTHER], label)).toEqual([OTHER]);
});

it("projects the owner line from the admitted directory and the badge only from the owner's allowlist", () => {
  const facts = agentAuthorFacts(directory, new Set(["inst-1"]));
  expect(facts.get(AGENT)).toEqual({ ownerLabel: "Dana", ownerPubkey: OWNER_KEY, ownerPrincipalId: "owner-principal",
    displayName: "Builder", respondTo: "allowlist" });
  expect(facts.get(OTHER)).toEqual({ ownerLabel: null, ownerPubkey: null, ownerPrincipalId: null, displayName: "Reviewer" });
  expect(withAgentAuthorFacts({ ...message, pubkey: "d".repeat(64) }, facts)).toEqual({ ...message, pubkey: "d".repeat(64) });
  expect(withAgentAuthorFacts(message, facts)).toMatchObject({ isAgent: true, ownerLabel: "Dana", ownerPrincipalId: "owner-principal", respondTo: "allowlist" });
  expect(agentAuthorFacts(directory).get(AGENT)?.respondTo).toBeUndefined();
  const host = agentAddressHost(facts);
  expect(host.isKnownAgent(AGENT.toUpperCase())).toBe(true);
  expect(host.labelFor(OTHER)).toBe("Reviewer");
  expect(host.labelFor(OWNER_KEY)).toBeNull();
});

it("renders the owner line, allowlist badge and address prefix through the provider in both languages", async () => {
  await act(async () => setLocale("zh-CN"));
  const facts = agentAuthorFacts(directory, new Set(["inst-1"]));
  const tagged = { ...message, tags: [["p", OTHER], ["mention", OTHER, "agent-address"]] };
  const view = await render(<TooltipProvider><AgentAuthorFactsProvider facts={facts}>
    <MessageRowSurface message={tagged} renderBody={() => tagged.body} />
  </AgentAuthorFactsProvider></TooltipProvider>);
  expect(view.querySelector('[data-testid="message-agent-owner"]')?.textContent).toContain("管理者为");
  expect(view.querySelector('[data-testid="message-agent-owner"]')?.textContent).toContain("Dana");
  expect(view.querySelector('[data-testid="message-respond-to-badge"]')?.getAttribute("aria-label")).toBe("仅选定的人可以向此 Agent 下达指令");
  expect(view.querySelector('[data-testid="message-agent-address-prefix"]')?.textContent).toContain("Reviewer");
  await act(async () => setLocale("en"));
  expect(view.querySelector('[data-testid="message-respond-to-badge"]')?.getAttribute("aria-label")).toBe("Selected people can send instructions to this agent");

  const unowned = await render(<TooltipProvider><AgentAuthorFactsProvider facts={facts}>
    <MessageRowSurface message={{ ...message, pubkey: OTHER }} renderBody={() => message.body} />
  </AgentAuthorFactsProvider></TooltipProvider>);
  expect(unowned.querySelector('[data-testid="message-agent-owner"]')?.textContent).toContain("owner unavailable");
  expect(unowned.querySelector('[data-testid="message-respond-to-badge"]')).toBeNull();
  expect(unowned.querySelector('[data-testid="message-agent-address-prefix"]')).toBeNull();

  const human = await render(<TooltipProvider><MessageRowSurface message={{ ...message, pubkey: OWNER_KEY }} renderBody={() => message.body} /></TooltipProvider>);
  expect(human.querySelector('[data-testid="message-agent-owner"]')).toBeNull();
});

it("keeps a known owner name without a Workspace key, and an unnamed Agent unlabelled", () => {
  const facts = agentAuthorFacts({ principalId: null, members: [], agents: [
    { agentPubkey: AGENT, installationResourceId: "inst-1", ownerPrincipalId: "owner-principal", ownerDisplayName: "Dana" },
  ] } as never);
  expect(facts.get(AGENT)).toEqual({ ownerLabel: "Dana", ownerPubkey: null, ownerPrincipalId: null, displayName: null });
  expect(agentAddressHost(facts).labelFor(AGENT)).toBeNull();
});

it("opens the owner's member profile card from the owner name on any host renderer", async () => {
  await act(async () => setLocale("en"));
  const facts = agentAuthorFacts(directory);
  const opened: unknown[] = [];
  const renderOwner: AgentOwnerRenderer = (owner, name) => <button type="button" data-testid="owner-card"
    onClick={() => opened.push(owner)}>{name}</button>;
  const view = await render(<TooltipProvider><AgentAuthorFactsProvider facts={facts} renderOwner={renderOwner}>
    <MessageRowSurface message={message} renderBody={() => message.body} />
    <InboxMessageRowSurface message={{ ...message, id: "m2" }} renderBody={() => message.body} />
  </AgentAuthorFactsProvider></TooltipProvider>);
  const triggers = view.querySelectorAll<HTMLButtonElement>('[data-testid="owner-card"]');
  expect(triggers).toHaveLength(2);
  expect(view.querySelectorAll('[data-testid="message-agent-owner-name"]')[1]?.textContent).toBe("Dana");
  await act(async () => { triggers[0]!.click(); triggers[1]!.click(); });
  expect(opened).toEqual([
    { principalId: "owner-principal", pubkey: OWNER_KEY, label: "Dana" },
    { principalId: "owner-principal", pubkey: OWNER_KEY, label: "Dana" },
  ]);

  const plain = await render(<TooltipProvider><AgentAuthorFactsProvider facts={facts}>
    <MessageRowSurface message={message} renderBody={() => message.body} />
  </AgentAuthorFactsProvider></TooltipProvider>);
  expect(plain.querySelector('[data-testid="owner-card"]')).toBeNull();
  expect(plain.querySelector('[data-testid="message-agent-owner"]')?.textContent).toContain("Dana");
});

/** The visible (non-sr-only) text of the owner chip, in document order. */
function visibleOwnerText(chip: Element): string {
  const clone = chip.cloneNode(true) as Element;
  clone.querySelectorAll(".sr-only").forEach((node) => node.remove());
  return (clone.textContent ?? "").replace(/\s+/g, "");
}

// Defect 7d: "管理者为" was followed by nothing. The name must be rendered as visible text right
// after the label through a host profile popover (Web wraps it in UserProfilePopoverSurface), and
// its slot keeps a minimum width so a squeezed header cannot collapse it to zero.
it("shows the owner name right after “managed by” through a host profile popover trigger", async () => {
  await act(async () => setLocale("zh-CN"));
  const facts = agentAuthorFacts(directory);
  const renderOwner: AgentOwnerRenderer = (owner, name) => <UserProfilePopoverSurface pubkey={owner.pubkey}
    triggerElement="span" triggerAriaLabel={owner.label} onOpenProfile={() => {}} renderBody={() => null}>{name}</UserProfilePopoverSurface>;
  const view = await render(<TooltipProvider><AgentAuthorFactsProvider facts={facts} renderOwner={renderOwner}>
    <MessageRowSurface message={message} renderBody={() => message.body} />
  </AgentAuthorFactsProvider></TooltipProvider>);
  const chip = view.querySelector('[data-testid="message-agent-owner"]')!;
  expect(visibleOwnerText(chip)).toBe("管理者为Dana");
  const name = chip.querySelector('[data-testid="message-agent-owner-name"]')!;
  expect(name.textContent).toBe("Dana");
  const slot = chip.querySelector('[data-testid="message-agent-owner-slot"]')!;
  expect(slot.contains(name)).toBe(true);
  expect(slot.className).toContain("min-w-[3ch]");
  expect(slot.className).toContain("[&>*]:min-w-0");

  // Without a host renderer the Tenant name is plain text after the label, also with a width floor.
  const plain = await render(<TooltipProvider><AgentAuthorFactsProvider facts={agentAuthorFacts({ principalId: null, members: [],
    agents: [{ agentPubkey: AGENT, installationResourceId: "inst-1", ownerPrincipalId: "owner-principal", ownerDisplayName: "Dana" }] } as never)}>
    <MessageRowSurface message={message} renderBody={() => message.body} />
  </AgentAuthorFactsProvider></TooltipProvider>);
  const plainChip = plain.querySelector('[data-testid="message-agent-owner"]')!;
  expect(visibleOwnerText(plainChip)).toBe("管理者为Dana");
  expect(plainChip.querySelector('[data-testid="message-agent-owner-name"]')?.className).toContain("min-w-[3ch]");
});
