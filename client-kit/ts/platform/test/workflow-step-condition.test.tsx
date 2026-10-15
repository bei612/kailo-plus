import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ActionEnum, AutomationTriggerKind, type AutomationStep } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { buildMessageTextCondition, parseMessageTextCondition, supportsMessageTextCondition } from "../src/react/workflow-message-text-condition";
import { supportedSteps, WorkflowStepCard, type WorkflowStepDraft } from "../src/react/workflow-steps";
import { button, click, render, settle, type } from "./render";

// Buzz 779af8886caae1317b4de962082429867ab61503 WorkflowStepCard Run controls +
// workflowMessageTextCondition: the step's original `if`.
describe("original step condition (Run controls)", () => {
  it("builds and parses only the original structured message-text expressions", () => {
    expect(buildMessageTextCondition({operator: "contains", value: 'de"ploy'})).toBe('str_contains(trigger_text, "de\\"ploy")');
    expect(parseMessageTextCondition('str_contains(trigger_text, "de\\"ploy")')).toEqual({operator: "contains", value: 'de"ploy'});
    expect(parseMessageTextCondition("str_len(trigger_text) == 0")).toEqual({operator: "is_empty", value: ""});
    expect(parseMessageTextCondition('trigger_author == "x"')).toBeNull();
    expect(supportsMessageTextCondition(AutomationTriggerKind.ChannelMessage)).toBe(true);
    expect(supportsMessageTextCondition(AutomationTriggerKind.DiffPosted)).toBe(true);
    expect(supportsMessageTextCondition(AutomationTriggerKind.ReactionAdded)).toBe(false);
    expect(supportsMessageTextCondition(AutomationTriggerKind.Schedule)).toBe(false);
  });

  it("admits the frozen if field in both step formats and rejects empty or oversized conditions", () => {
    const step = {id: "reply", action: "send_message", text: "hi", if: "trigger_is_reply"};
    expect(supportedSteps([step], 3)).toBe(true);
    expect(supportedSteps([{id: "wait", action: "delay", duration: "1s", if: "true"}, step], 2)).toBe(true);
    expect(supportedSteps([{...step, if: " "}], 3)).toBe(false);
    expect(supportedSteps([{...step, if: "x".repeat(4097)}], 3)).toBe(false);
  });

  async function mount(trigger: AutomationTriggerKind, initial: WorkflowStepDraft) {
    const updates: WorkflowStepDraft[] = [];
    function Host() {
      const [step, setStep] = useState(initial);
      return <WorkflowStepCard step={step} index={0} trigger={trigger} bare showHeader={false}
        onUpdate={(next) => { updates.push(next); setStep(next); }} />;
    }
    const host = await render(<PlatformProvider client={createBffClient({send: vi.fn(async () => ({status: 503, body: undefined}))})} locale="en">
      <Host /></PlatformProvider>);
    await settle();
    return {host, updates};
  }
  const runControls = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")]
    .find((node) => node.textContent?.startsWith("Run controls"));

  it("writes the original condition for a message step and summarizes it as Conditional", async () => {
    const message: AutomationStep = {id: "reply", action: ActionEnum.SendMessage, text: "hi"};
    const {host, updates} = await mount(AutomationTriggerKind.ChannelMessage, message);
    expect(runControls(host)!.textContent).toContain("Default");
    await click(runControls(host)!);
    await type(host.querySelector<HTMLInputElement>("#wf-trigger-filter-trigger-text-value")!, "deploy");
    await settle();
    expect(updates.at(-1)?.if).toBe('str_contains(trigger_text, "deploy")');
    expect(runControls(host)!.textContent).toContain("Conditional");
    // Clearing the value removes the field instead of storing an empty `if`.
    await type(host.querySelector<HTMLInputElement>("#wf-trigger-filter-trigger-text-value")!, "");
    expect(updates.at(-1)).not.toHaveProperty("if");
  });

  it("keeps an advanced expression until the original replace confirmation", async () => {
    const message: AutomationStep = {id: "reply", action: ActionEnum.SendMessage, text: "hi", if: 'trigger_author == "x"'};
    const {host, updates} = await mount(AutomationTriggerKind.ChannelMessage, message);
    await click(runControls(host)!);
    expect(host.textContent).toContain("An advanced expression is active");
    await click([...host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find((node) => node.textContent?.startsWith("Message text"))!);
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("Replace advanced expression?");
    await click(button(dialog, "Keep advanced expression"));
    expect(updates).toHaveLength(0);
    await click([...host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find((node) => node.textContent?.startsWith("Message text"))!);
    await click(button(document.querySelector<HTMLElement>('[role="alertdialog"]')!, "Replace expression"));
    expect(updates.at(-1)).not.toHaveProperty("if");
  });

  it("offers no message-text condition for reaction or schedule triggers", async () => {
    const reaction: AutomationStep = {id: "react", action: ActionEnum.AddReaction, emoji: "👍"};
    const {host} = await mount(AutomationTriggerKind.ReactionAdded, reaction);
    // Effect steps keep Run controls for the original timeout (ec2e4b8d); only the
    // message-text condition is absent for triggers without message text.
    const controls = runControls(host);
    if (controls) await click(controls);
    expect([...host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")]
      .find((node) => node.textContent?.startsWith("Message text"))).toBeUndefined();
    expect(host.querySelector("#wf-trigger-filter-trigger-text-value")).toBeNull();
  });
});
