import { expect, it } from "vitest";
import { act } from "react";
import { WorkspaceMembershipState } from "@client-kit/contracts";
import { setLocale } from "../src/i18n";
import {
  AgentAuthorFactsProvider, MessageRowSurface, agentAddressHost, agentAuthorFacts,
  buildAgentAddressMentionTags, getAgentAddressMentionPubkeys, getVisibleAgentAddressPubkeys,
  withAgentAuthorFacts, type TimelineMessage,
} from "../src/react/messages";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { render } from "./render";

const AGENT = "a".repeat(64);
const OTHER = "b".repeat(64);
const OWNER_KEY = "c".repeat(64);
const directory = {
  principalId: "owner-principal",
  agents: [
    { pubkey: AGENT.toUpperCase(), displayName: "Builder",
      installation: { resourceId: "inst-1", ownerPrincipalId: "owner-principal", ownerDisplayName: " Dana " } },
    { pubkey: OTHER, displayName: "Reviewer",
      installation: { resourceId: "inst-2", ownerPrincipalId: "gone-principal" } },
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
  expect(facts.get(AGENT)).toEqual({ ownerLabel: "Dana", ownerPubkey: OWNER_KEY, displayName: "Builder", respondTo: "allowlist" });
  expect(facts.get(OTHER)).toEqual({ ownerLabel: null, ownerPubkey: null, displayName: "Reviewer" });
  expect(withAgentAuthorFacts({ ...message, pubkey: "d".repeat(64) }, facts)).toEqual({ ...message, pubkey: "d".repeat(64) });
  expect(withAgentAuthorFacts(message, facts)).toMatchObject({ isAgent: true, ownerLabel: "Dana", respondTo: "allowlist" });
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
