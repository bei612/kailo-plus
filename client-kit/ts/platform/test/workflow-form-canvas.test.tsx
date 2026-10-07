import { act, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionEnum, AutomationTriggerKind, type AutomationStep } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { WorkflowFormCanvas } from "../src/react/workflow-form-canvas";
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
async function setup(initial: AutomationStep[], options: { disabled?: boolean; policies?: boolean; schedule?: boolean; locale?: "en" | "zh-CN" } = {}) {
  const changes = vi.fn();
  function Editor() {
    const [steps, setSteps] = useState(initial);
    return <><WorkflowFormCanvas steps={steps} onStepsChange={next => { changes(next); setSteps(next); }}
      trigger={options.schedule ? AutomationTriggerKind.Schedule : AutomationTriggerKind.ChannelMessage}
      triggerFields={<input aria-label="Actual trigger draft" defaultValue="Kept" />}
      policies={options.policies ? [policy] : []} disabled={options.disabled} /><output>{JSON.stringify(steps)}</output></>;
  }
  const host = await render(<PlatformProvider locale={options.locale ?? "en"} client={createBffClient({send: async () => ({status:503,body:undefined})})}><Editor /></PlatformProvider>);
  return {host, changes};
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
      .find(button => button.textContent?.startsWith("Details"))!);
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
    const {host, changes} = await setup([first], {disabled:true});
    expect([...host.querySelectorAll<HTMLButtonElement>('ol button')].every(button => button.disabled)).toBe(true);
    await click(host.querySelector<HTMLElement>('ol button')!);
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
