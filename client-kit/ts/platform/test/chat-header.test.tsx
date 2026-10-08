import { expect, it, vi } from "vitest";
import { ChatHeader } from "../src/react/messages/chat-header";
import { setLocale } from "../src/i18n";
import { render, click } from "./render";
import { DmHeaderParticipants } from "../src/react/messages/dm-header-participants";
import { AvatarHostProvider } from "../src/react/profile/avatar-host";
import { resolveConversationHeaderParticipants } from "../src/react/conversations/dm-participant-display";
import { ItemState, type ConversationView } from "@client-kit/contracts";

it("renders the actual admitted title, description and original status surface", async () => {
  setLocale("zh-CN");
  const copy = vi.fn(async () => {});
  const host = await render(<ChatHeader title="  研发频道  " description="  频道介绍  "
    leadingContent={<span data-glyph />} statusBadge={<span>归档</span>} onCopyTitle={copy} />);
  expect(host.querySelector('[data-testid="chat-title"]')?.textContent).toBe("  研发频道  ");
  expect(host.querySelector("h1")?.getAttribute("title")).toBe("频道介绍");
  expect(host.querySelector("[data-glyph]")).not.toBeNull();
  expect(host.textContent).toContain("归档");
  const button = host.querySelector<HTMLButtonElement>("button")!;
  expect(button.getAttribute("aria-label")).toContain("研发频道");
  await click(button);
  expect(copy).toHaveBeenCalledExactlyOnceWith("研发频道");
});

it("retains English copy affordance and does not copy an empty title", async () => {
  setLocale("en");
  const copy = vi.fn(async () => {});
  const host = await render(<ChatHeader title=" " leadingContent={null} onCopyTitle={copy} />);
  const button = host.querySelector<HTMLButtonElement>("button")!;
  expect(button.getAttribute("title")).toMatch(/copy/i);
  await click(button);
  expect(copy).not.toHaveBeenCalled();
  expect(host.querySelector("h1")?.hasAttribute("title")).toBe(false);
});

it("restores the original DM baseline and private-channel glyph without manufacturing presence", async () => {
  const dm = await render(<ChatHeader title="Bob" channelType="dm" onCopyTitle={async()=>{}} />);
  expect(dm.querySelector("h1")?.classList.contains("translate-y-px")).toBe(false);
  expect(dm.querySelector("svg")?.classList.contains("lucide-circle-dot")).toBe(true);
  const channel = await render(<ChatHeader title="Private" channelType="stream" visibility="private"
    belowSystemChrome transparentChrome onCopyTitle={async()=>{}} />);
  expect(channel.querySelector("h1")?.classList.contains("translate-y-px")).toBe(true);
  expect(channel.querySelector("svg")?.classList.contains("lucide-lock")).toBe(true);
  expect(channel.firstElementChild?.className).toContain("-mb-(--buzz-channel-content-top-padding,5.75rem)");
  expect(channel.querySelector('[data-testid="chat-presence-badge"]')).toBeNull();
});

it("uses the original one-person avatar and group overlap/overflow rules in the shared consumer", async () => {
  const people = ["One","Two","Three","Four","Five"].map((displayName,index)=>({id:String(index),displayName,avatarUrl:null}));
  const one = await render(<AvatarHostProvider value={{locale:"en",rewriteMediaUrl:url=>url}}>
    <DmHeaderParticipants participants={people.slice(0,1)} title="One" /></AvatarHostProvider>);
  expect(one.querySelector('[data-testid="chat-header-dm-avatar"]')).not.toBeNull();
  expect(one.querySelector('[data-testid="chat-header-dm-avatar-stack"]')).toBeNull();
  expect(one.querySelector('[data-testid="chat-presence-badge"]')).toBeNull();
  const group = await render(<DmHeaderParticipants participants={people} title="Group" />);
  const visible = group.querySelectorAll('[data-testid="chat-header-dm-avatar-stack-participant"]');
  expect(visible).toHaveLength(3);
  expect(visible[1]?.className).toBe("-ml-2");
  expect(visible[0]?.firstElementChild?.className).toContain("ring-2 ring-background");
  expect(group.querySelector('[data-testid="chat-header-dm-avatar-stack-more"]')?.textContent).toBe("+2");
  expect(group.querySelector('[role="button"]')).toBeNull();
});

const conversation: ConversationView={id:"dm",channelId:"native-dm",state:ItemState.Active,
  participantPrincipalIds:["me","bob"],operationId:"operation",version:1};
const people=[{principalId:"me",displayName:"Me",pubkeys:["a".repeat(64),"c".repeat(64)]},
  {principalId:"bob",displayName:"Bob",pubkeys:["b".repeat(64),"d".repeat(64)]}];
it("counts governed people, not their device keys, in the original DM title/avatar consumer",()=>{
  const participants=resolveConversationHeaderParticipants(conversation,"me",people);
  expect(participants).toEqual([people[1]]);
  expect(participants).toHaveLength(1);
});
it.each(["unadmitted","inactive","missing-person","duplicate-person"])("does not manufacture %s header identity",condition=>{
  const actual=condition==="unadmitted"?{...conversation,participantPrincipalIds:["outsider","bob"]}
    :condition==="inactive"?{...conversation,state:ItemState.Provisioning}
    :condition==="duplicate-person"?{...conversation,participantPrincipalIds:["me","bob","bob"]}:conversation;
  const directory=condition==="missing-person"?[people[0]!]:condition==="unadmitted"
    ? [...people,{principalId:"outsider",displayName:"Known outsider",pubkeys:["e".repeat(64)]}]:people;
  expect(resolveConversationHeaderParticipants(actual,"me",directory)).toBeNull();
});
