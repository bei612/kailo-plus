import { act, createRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionEnum, AutomationTriggerKind, type AutomationStep, type WebCustomEmojiView } from "@client-kit/contracts";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { WorkflowFormCanvas, type WorkflowFormCanvasHandle } from "../src/react/workflow-form-canvas";
import { supportedSteps } from "../src/react/workflow-steps";
import { click, render, settle, type } from "./render";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());
const first: AutomationStep = { id: "first", action: ActionEnum.SendMessage, text: "Original" };
const second: AutomationStep = { id: "second", action: ActionEnum.SendMessage, text: "Second" };
const policy = { id: "5d302c74-7f3f-49d5-9583-616e6c9a32a7", version: 1 };
async function setup(initial: AutomationStep[], options: { disabled?: boolean; policies?: boolean; schedule?: boolean; locale?: "en" | "zh-CN"; emojiView?: WebCustomEmojiView } = {}) {
  const changes = vi.fn();
  const handle = createRef<WorkflowFormCanvasHandle>();
  function Editor() {
    const [steps, setSteps] = useState(initial);
    return <><WorkflowFormCanvas ref={handle} steps={steps} onStepsChange={next => { changes(next); setSteps(next); }}
      trigger={options.schedule ? AutomationTriggerKind.Schedule : AutomationTriggerKind.ChannelMessage}
      triggerFields={<input aria-label="Actual trigger draft" defaultValue="Kept" />}
      policies={options.policies ? [policy] : []} disabled={options.disabled} /><output>{JSON.stringify(steps)}</output></>;
  }
  const host = await render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
    <PlatformProvider locale={options.locale ?? "en"} client={createBffClient({send: async request => request.path === "/api/v1/custom-emoji" && options.emojiView
      ? {status:200,body:options.emojiView} : {status:503,body:undefined}})}><Editor /></PlatformProvider>
  </QueryClientProvider>);
  return {host, changes, handle};
}
const read = (host: HTMLElement): AutomationStep[] => JSON.parse(host.querySelector("output")!.textContent!);
async function settledMotion() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); }); }
async function node(host: HTMLElement, index: number) {
  await click(host.querySelectorAll<HTMLElement>('ol > li > div > button[aria-pressed]')[index]!);
  await settledMotion();
}
async function menu(trigger: HTMLElement) {
  await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key:"Enter", bubbles:true })));
  await settle();
  return document.querySelector<HTMLElement>('[role="menu"]')!;
}
async function add(host: HTMLElement, position: number, action: string) {
  const popup = await menu(host.querySelectorAll<HTMLElement>('[data-testid="workflow-node-ingress"] button')[position]!);
  await click([...popup.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === action)!);
  await settledMotion();
}

describe("original workflow sequence and actual governed draft consumer", () => {
  it("uses the original dialog handle to add a first real step and close the inspector without changing that draft", async () => {
    const {host, changes, handle} = await setup([]);
    expect(handle.current!.closeInspector()).toBe(false);
    await act(async () => handle.current!.addFirstStep());
    await settledMotion();
    expect(read(host)).toEqual([{id:"step_1",action:ActionEnum.SendMessage,text:""}]);
    expect(changes).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-testid="workflow-node-inspector"]')).not.toBeNull();
    await act(async () => expect(handle.current!.closeInspector()).toBe(true));
    await settledMotion();
    expect(host.querySelector('[data-testid="workflow-node-inspector"]')).toBeNull();
    expect(read(host)).toEqual([{id:"step_1",action:ActionEnum.SendMessage,text:""}]);
    expect(changes).toHaveBeenCalledOnce();
  });

  it.each([
    [{id:"step", action:ActionEnum.SendMessage, name:"Release", text:"  Hello\n  world  "}, "Release · “Hello world”", "Send message"],
    [{id:"step", action:ActionEnum.Delay, duration:"1h 2m 1s"}, "1 hour 2 minutes 1 second", "Delay"],
    [{id:"step", action:ActionEnum.Delay, duration:"invalid draft"}, "invalid draft", "Delay"],
    [{id:"step", action:ActionEnum.SetChannelTopic, topic:"Release <b>discussion</b>"}, "“Release <b>discussion</b>”", "Set channel topic"],
    [{id:"step", action:ActionEnum.RequestApproval, message:"Please review", approvalPolicy:policy}, "“Please review”", "Request approval"],
  ] satisfies Array<[AutomationStep,string,string]>)("renders the original configured summary for %j without altering the draft", async (step, summary, subtitle) => {
    const {host,changes} = await setup([step]);
    const target = host.querySelector<HTMLElement>('ol > li:nth-child(2) button[aria-pressed]')!;
    expect(target.getAttribute("aria-label")).toBe(`Step 1: ${summary}`);
    expect(target.textContent).toBe(`1${subtitle}${summary}`);
    expect(target.querySelector("b")).toBeNull();
    expect(read(host)).toEqual([step]);
    expect(changes).not.toHaveBeenCalled();
  });

  it("uses original compact quotes, truncation and empty-action fallback", async () => {
    const {host} = await setup([{...first,text:"a".repeat(43)}, {...second,text:"   "}]);
    const targets = host.querySelectorAll<HTMLElement>('ol > li > div > button[aria-pressed]');
    expect(targets[1]!.getAttribute("aria-label")).toBe(`Step 1: “${"a".repeat(39)}...”`);
    expect(targets[2]!.textContent).toBe("2Send message");
  });

  it("updates the configured node when the real inspector changes its message", async () => {
    const {host} = await setup([first]);
    await node(host,1);
    await type(host.querySelector<HTMLTextAreaElement>("textarea")!, "Changed summary");
    expect(host.querySelector('ol > li:nth-child(2) button[aria-pressed]')?.getAttribute("aria-label")).toBe("Step 1: “Changed summary”");
    expect(read(host)[0]?.text).toBe("Changed summary");
  });

  it.each(["👍", ":not_admitted:"])("uses the original reaction icon instead of a step number and no untrusted image (%s)", async emoji => {
    const {host} = await setup([{id:"reaction", action:ActionEnum.AddReaction, emoji}]);
    await settle();
    const target = host.querySelector<HTMLElement>('ol > li:nth-child(2) button[aria-pressed]')!;
    expect(target.getAttribute("aria-label")).toBe(`Step 1: ${emoji}`);
    expect(target.querySelector('[data-testid="workflow-node-icon"]')?.textContent).toBe(emoji);
    expect(target.textContent).toBe(`${emoji}Add reaction`);
    expect(target.querySelector("img")).toBeNull();
  });

  it("localizes verbose durations and configured action subtitles through the same source", async () => {
    const {host} = await setup([{id:"wait", action:ActionEnum.Delay, duration:"1w 2d 3h 4m 5s"}], {locale:"zh-CN"});
    expect(host.querySelector('ol > li:nth-child(2) button[aria-pressed]')?.textContent).toBe("1延时1 周 2 天 3 小时 4 分钟 5 秒");
  });

  it.each([true, false])("resolves a signed custom reaction only through its admitted media mapping (%s)", async admitted => {
    const key = new Uint8Array(32).fill(1);
    const original = "https://relay.example/media/party.png";
    const rewritten = "/api/v1/media/party.png";
    const event = finalizeEvent({kind:30030, created_at:1, content:"", tags:[["d","buzz:custom-emoji"],["emoji","party",original]]}, key);
    const {host,changes} = await setup([{id:"reaction",action:ActionEnum.AddReaction,emoji:":party:"}], {
      emojiView:{pubkey:getPublicKey(key),events:[event],mediaPaths:admitted ? {[original]:rewritten} : {}},
    });
    // Query notifications use a scheduled task, not only promise microtasks.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const image = host.querySelector('ol img');
    expect(image?.getAttribute("src") ?? null).toBe(admitted ? rewritten : null);
    expect(host.querySelector('ol button[aria-label="Step 1: :party:"]')).not.toBeNull();
    expect(changes).not.toHaveBeenCalled();
  });

  it("selects an original node, edits only that step, and closes without losing the draft", async () => {
    const {host, changes} = await setup([first, second]);
    expect(host.querySelector('ol[aria-label="Workflow sequence"]')?.children).toHaveLength(3);
    expect(host.querySelector("textarea")).toBeNull();
    await node(host, 2);
    expect(changes).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Second");
    expect(host.querySelector('[data-testid="workflow-node-inspector"]')?.className).toContain("[@container(max-width:58rem)]:absolute");
    await type(host.querySelector<HTMLTextAreaElement>("textarea")!, "Changed");
    await click(host.querySelector<HTMLElement>('button[aria-label="Close inspector"]')!);
    await settledMotion();
    expect(read(host)).toEqual([first, {...second, text:"Changed"}]);
    await node(host, 2);
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Changed");
  });

  it("inserts after the selected position, preserving IDs and actual order", async () => {
    const {host} = await setup([first, second]);
    await add(host, 1, "Delay");
    await type(host.querySelector<HTMLInputElement>('#wf-step-1-duration')!, "2m");
    expect(read(host)).toEqual([first, {id:"step_1", action:"delay", duration:"2m"}, second]);
    expect(supportedSteps(read(host), 3)).toBe(true);
  });

  it.each(["en","zh-CN"] as const)("keeps the original delay text input and exact duration draft on blur (%s)",async(locale)=>{
    const {host}=await setup([{id:"wait",action:ActionEnum.Delay,duration:"5s"},first],{locale});
    await node(host,1);
    const input=host.querySelector<HTMLInputElement>('#wf-step-0-duration')!;
    expect(input.placeholder).toBe(locale==="en"?"e.g. 5s, 1m, 1h":"例如 5s、1m、1h");
    expect(host.querySelector('input[type="range"]')).toBeNull();
    await type(input,"0s");
    await act(async()=>input.dispatchEvent(new FocusEvent("focusout",{bubbles:true})));
    expect(read(host)).toEqual([{id:"wait",action:ActionEnum.Delay,duration:"0s"},first]);
    expect(supportedSteps(read(host),3)).toBe(true);
    await type(input,"invalid draft");
    expect(read(host)[0]?.duration).toBe("invalid draft");
    expect(supportedSteps(read(host),3)).toBe(false);
  });

  it("uses the original message editor presentation and preserves template text in the governed step",async()=>{
    const {host}=await setup([first]);
    await node(host,1);
    const input=host.querySelector<HTMLTextAreaElement>('#wf-step-0-text')!;
    expect(host.querySelector('label[for="wf-step-0-text"]')?.textContent).toBe("Message text");
    expect(input.placeholder).toBe("e.g. Deployment started by {{trigger.author}}");
    expect(input.className).toContain("min-h-[60px] resize-y text-xs");
    expect(input.className).not.toContain("p-2");
    expect(host.textContent).toContain("Messages post to the workflow channel selected above.");
    await type(input,"Deployment started by {{trigger.author}}");
    expect(read(host)).toEqual([{...first,text:"Deployment started by {{trigger.author}}"}]);
  });

  it.each([
    [{id:"gate",action:ActionEnum.RequestApproval,message:"Review",approvalPolicy:policy},"message","Approval request message"],
    [{id:"reaction",action:ActionEnum.AddReaction,emoji:"👍"},"emoji","e.g. thumbsup"],
    [{id:"topic",action:ActionEnum.SetChannelTopic,topic:"Discussion"},"topic","New channel topic"],
  ] satisfies Array<[AutomationStep,string,string]>)("restores the supported original field for %j without changing its governed payload",async(step,field,placeholder)=>{
    const {host,changes}=await setup([step],{policies:true});
    await node(host,1);
    expect(host.querySelector<HTMLInputElement>(`#wf-step-0-${field}`)?.placeholder).toBe(placeholder);
    expect(read(host)).toEqual([step]);
    expect(changes).not.toHaveBeenCalled();
    expect(host.querySelector('#wf-step-0-timeout')).toBeNull();
    expect(host.querySelector('#wf-step-0-timeout-secs')).toBeNull();
  });

  it("does not offer an approval after a side effect, or a side effect before approval", async () => {
    const {host} = await setup([{id:"gate", action:ActionEnum.RequestApproval, message:"Approve", approvalPolicy:policy}, first], {policies:true});
    const popup = await menu(host.querySelectorAll<HTMLElement>('[data-testid="workflow-node-ingress"] button')[0]!);
    expect(popup.textContent).toContain("Delay");
    expect(popup.textContent).not.toContain("Send message");
    expect(popup.textContent).not.toContain("Request approval");
  });

  it("keeps selection with the preceding step after deletion and trigger after the final removal", async () => {
    const {host} = await setup([first, second]);
    await node(host, 2);
    await click(host.querySelector<HTMLElement>('[data-testid="workflow-node-inspector"] button[aria-label="Remove step"]')!);
    await settledMotion();
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Original");
    await click(host.querySelector<HTMLElement>('[data-testid="workflow-node-inspector"] button[aria-label="Remove step"]')!);
    await settledMotion();
    expect(read(host)).toEqual([]);
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Actual trigger draft"]')!.value).toBe("Kept");
  });

  it("uses the surviving next step when the selected first step is removed", async () => {
    const {host} = await setup([first, second]);
    await node(host, 1);
    await click(host.querySelector<HTMLElement>('[data-testid="workflow-node-inspector"] button[aria-label="Remove step"]')!);
    await settledMotion();
    expect(read(host)).toEqual([second]);
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Second");
  });

  it("changes terminal action using the original inspector menu without retaining unrelated fields", async () => {
    const {host} = await setup([first]);
    await node(host, 1);
    const popup = await menu(host.querySelector<HTMLElement>('button[aria-label="Action"]')!);
    await click([...popup.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === "Set channel topic")!);
    await settle();
    expect(read(host)).toEqual([{id:"first", action:"set_channel_topic", topic:""}]);
    await type(host.querySelector<HTMLInputElement>('#wf-step-0-topic')!, "Release");
    expect(supportedSteps(read(host), 2)).toBe(true);
  });

  it("retains the selected step when its ID changes and closes the narrow inspector with Escape", async () => {
    const {host} = await setup([first, second]);
    await node(host, 1);
    await click([...host.querySelectorAll<HTMLElement>('[data-testid="workflow-node-inspector"] button[aria-expanded="false"]')]
      .find(button => button.textContent?.startsWith("Step details"))!);
    expect(host.querySelector('label[for="wf-step-0-name"]')?.textContent).toBe("Name (optional)");
    expect(host.querySelector<HTMLInputElement>('#wf-step-0-name')?.placeholder).toBe("e.g. Notify deployment channel");
    expect(host.querySelector<HTMLInputElement>('#wf-step-0-id')?.placeholder).toBe("unique_step_id");
    expect(host.textContent).toContain("Used in configuration and run history.");
    await type(host.querySelector<HTMLInputElement>('#wf-step-0-id')!, "renamed_step");
    await settledMotion();
    expect(read(host)[0]?.id).toBe("renamed_step");
    expect(host.querySelector('ol > li:nth-child(2) button[aria-pressed]')?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Original");
    const inspector = host.querySelector<HTMLElement>('[data-testid="workflow-node-inspector"]')!;
    expect(inspector.getAttribute("aria-modal")).toBe("true");
    const escape = new KeyboardEvent("keydown", {key:"Escape", bubbles:true, cancelable:true});
    await act(async () => inspector.dispatchEvent(escape));
    await settledMotion();
    expect(escape.defaultPrevented).toBe(true);
    expect(host.querySelector('[data-testid="workflow-node-inspector"]')).toBeNull();
    expect(read(host)).toEqual([{...first,id:"renamed_step"},second]);
  });

  it("supports an empty sequence but does not offer unsupported DM, webhook or schedule reaction", async () => {
    const {host} = await setup([], {schedule:true});
    const popup = await menu(host.querySelector<HTMLElement>('[data-testid="workflow-node-ingress"] button')!);
    expect([...popup.querySelectorAll('[role="menuitem"]')].map(item => item.textContent)).toEqual(["Delay", "Send message", "Set channel topic"]);
  });

  it("keeps the disabled draft read-only", async () => {
    const {host, changes, handle} = await setup([first], {disabled:true});
    expect([...host.querySelectorAll<HTMLButtonElement>('ol button')].every(button => button.disabled)).toBe(true);
    await click(host.querySelector<HTMLElement>('ol button')!);
    await act(async () => handle.current!.addFirstStep());
    expect(changes).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="workflow-node-inspector"]')).toBeNull();
  });

  it("uses the same original nodes and inspector in Chinese", async () => {
    const {host} = await setup([first], {locale:"zh-CN"});
    expect(host.querySelector('ol[aria-label="工作流步骤"]')).not.toBeNull();
    await node(host, 1);
    expect(host.querySelector('button[aria-label="关闭检查器"]')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('#wf-step-0-text')).not.toBeNull();
  });
});
