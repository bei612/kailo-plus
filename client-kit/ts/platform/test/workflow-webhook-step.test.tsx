import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AutomationStepAction, AutomationTriggerKind, type AutomationStep } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { supportedSteps, workflowStepsContent, WorkflowStepCard, type WorkflowStepDraft } from "../src/react/workflow-steps";
import { button, click, render, settle, type } from "./render";

// Buzz 779af8886caae1317b4de962082429867ab61503 WorkflowStepCard (call_webhook) +
// WorkflowWebhookHeadersEditor + workflowFormTypes.ts::actionFieldsForStep.
describe("original call_webhook step", () => {
  const secret = {locator: "tenants/t1/kv/hook", version: 1, audience: "core"};

  it("admits the original fields as the final effect and keeps credentials as SecretRefs", () => {
    const hook = {id: "hook", action: "call_webhook", url: "https://hooks.example.com/n?c={{trigger.channel_id}}",
      method: "PUT", headers: {"Content-Type": "application/json"}, secretHeaders: {Authorization: secret},
      body: "{\"text\":\"{{trigger.text}}\"}", timeout_secs: 30};
    expect(supportedSteps([{id: "wait", action: "delay", duration: "1s"}, hook], 2)).toBe(true);
    expect(supportedSteps([hook], 3)).toBe(false);
    expect(supportedSteps([hook, {id: "wait", action: "delay", duration: "1s"}], 2)).toBe(false);
    for (const url of ["http://hooks.example.com/", "https://{{trigger.text}}/", "https://a{{x}}/", "https://u@h.example.com/"]) {
      expect(supportedSteps([{...hook, url}], 2)).toBe(false);
    }
    expect(supportedSteps([{...hook, method: "TRACE"}], 2)).toBe(false);
    expect(supportedSteps([{...hook, headers: {}}], 2)).toBe(false);
    expect(supportedSteps([{...hook, secretHeaders: {Authorization: {...secret, version: 0}}}], 2)).toBe(false);
    expect(supportedSteps([{...hook, secretHeaders: {"content-type": secret}}], 2)).toBe(false);
  });

  it("serializes like the original form: POST default, blank header names and empty body dropped", () => {
    const draft: WorkflowStepDraft = {id: "hook", action: AutomationStepAction.CallWebhook, url: "https://h.example.com/", body: "",
      secretHeaders: {Authorization: secret},
      headerRows: [{id: "a", key: " X-Trace ", value: "{{trigger.message_id}}"}, {id: "b", key: " ", value: "dropped"}]};
    expect(workflowStepsContent([draft])).toEqual([{id: "hook", action: AutomationStepAction.CallWebhook, url: "https://h.example.com/",
      method: "POST", headers: {"X-Trace": "{{trigger.message_id}}"}, secretHeaders: {Authorization: secret}}]);
    expect(workflowStepsContent([{...draft, headerRows: []}])[0]).not.toHaveProperty("headers");
  });

  it("edits the original endpoint, method, headers and body fields without dropping SecretRefs", async () => {
    const updates: WorkflowStepDraft[] = [];
    const initial: AutomationStep = {id: "hook", action: AutomationStepAction.CallWebhook, url: "", secretHeaders: {Authorization: secret}};
    function Host() {
      const [step, setStep] = useState<WorkflowStepDraft>(initial);
      return <WorkflowStepCard step={step} index={0} trigger={AutomationTriggerKind.Schedule} bare showHeader={false}
        onUpdate={(next) => { updates.push(next); setStep(next); }} />;
    }
    const host = await render(<PlatformProvider client={createBffClient({send: vi.fn(async () => ({status: 503, body: undefined}))})} locale="en">
      <Host /></PlatformProvider>);
    await settle();
    await type(host.querySelector<HTMLInputElement>("#wf-step-0-url")!, "http://h.example.com/");
    expect(host.textContent).toContain("URL must start with https://");
    await type(host.querySelector<HTMLInputElement>("#wf-step-0-url")!, "https://h.example.com/hook");
    expect(host.textContent).not.toContain("URL must start with https://");
    expect(host.querySelector<HTMLSelectElement>("#wf-step-0-method")!.value).toBe("POST");
    expect(host.textContent).toContain("No custom headers.");
    expect(host.textContent).toContain("Authorization");
    await click(button(host, "Add header"));
    await type(host.querySelector<HTMLInputElement>('input[placeholder="Header name"]')!, "X-Trace");
    await type(host.querySelector<HTMLInputElement>('input[placeholder="Header value"]')!, "1");
    await type(host.querySelector<HTMLTextAreaElement>("#wf-step-0-body")!, "{}");
    const content = workflowStepsContent([updates.at(-1)!]);
    expect(content).toEqual([{id: "hook", action: AutomationStepAction.CallWebhook, url: "https://h.example.com/hook", method: "POST",
      headers: {"X-Trace": "1"}, secretHeaders: {Authorization: secret}, body: "{}"}]);
  });
});
