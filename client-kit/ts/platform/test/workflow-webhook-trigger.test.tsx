import { describe, expect, it, vi } from "vitest";
import { AutomationTriggerKind, type AutomationVersionContent } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { translate, type PlatformMessageKey } from "../src/i18n";
import { workflowCardLabel, workflowTriggerSummary } from "../src/react/workflow-card-label";
import { workflowTemplateVariables } from "../src/react/workflow-template-variables";
import { WorkflowWebhookSecretDialog } from "../src/react/workflow-webhook-secret-dialog";
import { click, render, settle } from "./render";

// Buzz 779af8886caae1317b4de962082429867ab61503 WorkflowWebhookSecretDialog,
// WorkflowDialog's "Continue without this secret?" and getTriggerCardClause (DD-116).
describe("original webhook trigger", () => {
  const en = (key: PlatformMessageKey, variables?: Record<string, string | number>) => translate("en", key, variables);
  const content = {trigger: {kind: AutomationTriggerKind.Webhook}, resultTarget: "CHANNEL", formatVersion: 2,
    steps: [{id: "post", action: "send_message", text: "{{trigger.service}} deployed"}]} as unknown as AutomationVersionContent;

  it("describes the webhook trigger with the original card clause and template variables", () => {
    expect(workflowTriggerSummary(content, en)).toBe("When a webhook arrives");
    expect(workflowCardLabel(content, en)).toBe("When a webhook arrives, send “{{trigger.service}} deployed”");
    expect(workflowTemplateVariables(AutomationTriggerKind.Webhook).map((variable) => variable.value)).toEqual(["trigger.channel_id"]);
  });

  it("shows the key once, masked, and confirms before leaving it behind", async () => {
    const copied: string[] = [];
    const onContinue = vi.fn();
    const secret = `whsec_${"A".repeat(43)}=`;
    await render(<PlatformProvider client={createBffClient({send: vi.fn(async () => ({status: 503, body: undefined}))})}
      locale="en" copyText={async (text) => { copied.push(text); }}>
      <WorkflowWebhookSecretDialog onContinue={onContinue}
        secret={{automationResourceId: "00000000-0000-4000-8000-000000000001", secret, url: "https://hooks.example.com/hooks/x"}} />
    </PlatformProvider>);
    await settle();
    const dialog = document.querySelector<HTMLElement>('[data-testid="workflow-webhook-secret-dialog"]')!;
    expect(dialog.textContent).toContain("Webhook ready");
    expect(dialog.textContent).toContain("https://hooks.example.com/hooks/x");
    expect(dialog.textContent).not.toContain(secret);
    expect(dialog.textContent).toContain("webhook-signature");
    await click(dialog.querySelector<HTMLButtonElement>('button[aria-label="Reveal webhook secret"]')!);
    expect(dialog.textContent).toContain(secret);
    await click([...dialog.querySelectorAll("button")].find((button) => button.textContent === "Copy Secret")!);
    await click([...dialog.querySelectorAll("button")].find((button) => button.textContent === "Copy URL")!);
    expect(copied).toEqual([secret, "https://hooks.example.com/hooks/x"]);
    await click([...dialog.querySelectorAll("button")].find((button) => button.textContent === "Continue")!);
    const confirm = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
    expect(confirm.textContent).toContain("Continue without this secret?");
    await click([...confirm.querySelectorAll("button")].find((button) => button.textContent === "Go back")!);
    expect(onContinue).not.toHaveBeenCalled();
    await click([...dialog.querySelectorAll("button")].find((button) => button.textContent === "Continue")!);
    const again = document.querySelector<HTMLElement>('[role="alertdialog"]')!;
    await click([...again.querySelectorAll("button")].find((button) => button.textContent === "Continue")!);
    expect(onContinue).toHaveBeenCalledOnce();
  });
});
