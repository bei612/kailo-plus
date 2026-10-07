import { act, useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { AutomationTriggerKind as TriggerKind } from "@client-kit/contracts";
import { setLocale } from "../src/i18n";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { WorkflowTemplateTextarea } from "../src/react/workflow-template-textarea";
import { activeTemplateToken, insertTemplateVariable, workflowTemplateVariables } from "../src/react/workflow-template-variables";
import { render, type, click } from "./render";

beforeEach(() => {
  localStorage.clear(); setLocale("zh-CN");
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
const client = createBffClient({ send: async () => ({ status: 503, body: undefined }) });

function Editor({ trigger = TriggerKind.ChannelMessage, initial = "", onSubmit = () => {} }: {
  trigger?: TriggerKind; initial?: string; onSubmit?: () => void;
}) {
  const [value, setValue] = useState(initial);
  return <PlatformProvider client={client}><form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <WorkflowTemplateTextarea aria-label="template" triggerType={trigger} value={value} onValueChange={setValue} />
  </form></PlatformProvider>;
}

async function key(field: HTMLTextAreaElement, value: string, isComposing = false) {
  await act(async () => field.dispatchEvent(new KeyboardEvent("keydown", { key: value, isComposing, bubbles: true, cancelable: true })));
}

it("retains original complete-token replacement and surrounding source text", () => {
  const value = "before {{trigger.author}} after";
  const token = activeTemplateToken(value, value.indexOf("author") + 2)!;
  expect(insertTemplateVariable(value, token, "trigger.text")).toEqual({ value: "before {{trigger.text}} after", caret: 23 });
  expect(activeTemplateToken("{{trigger.text}}", 16)).toBeNull();
  expect(activeTemplateToken("{{trigger.text |", 16)).toBeNull();
});

it("offers only actual source fields for schedules and never invents step outputs", () => {
  expect(workflowTemplateVariables(TriggerKind.Schedule).map((row) => row.value)).toEqual(["trigger.channel_id", "trigger.timestamp"]);
  expect(workflowTemplateVariables(TriggerKind.Mention).map((row) => row.value)).toEqual([
    "trigger.text", "trigger.author", "trigger.channel_id", "trigger.timestamp", "trigger.message_id",
  ]);
});

it("inserts via the original keyboard list without submitting and restores the caret", async () => {
  const submit = vi.fn();
  const host = await render(<Editor onSubmit={submit} />);
  const field = host.querySelector("textarea")!;
  await type(field, "前缀 {{trigger.");
  expect(document.querySelector('[role="listbox"]')?.textContent).toContain("消息正文");
  await key(field, "ArrowDown");
  await key(field, "Tab");
  await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
  expect(field.value).toBe("前缀 {{trigger.author}}");
  expect(field.selectionStart).toBe(field.value.length);
  expect(document.activeElement).toBe(field);
  expect(submit).not.toHaveBeenCalled();
  expect(document.querySelector('[role="listbox"]')).toBeNull();
});

it("keeps Chinese IME input and Escape in the template rather than submitting or closing the editor", async () => {
  const submit = vi.fn();
  const host = await render(<Editor onSubmit={submit} />);
  const field = host.querySelector("textarea")!;
  await type(field, "{{trigger.");
  await key(field, "Enter", true);
  expect(field.value).toBe("{{trigger.");
  await key(field, "Escape");
  expect(field.value).toBe("{{trigger.");
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});

it("keeps the mouse interaction and bilingual empty-match text on the same editor", async () => {
  const host = await render(<Editor trigger={TriggerKind.Schedule} />);
  const field = host.querySelector("textarea")!;
  await type(field, "{{trigger.");
  const options = document.querySelectorAll<HTMLElement>('[role="option"]');
  expect(options).toHaveLength(2);
  await click(options[1]!);
  expect(field.value).toBe("{{trigger.timestamp}}");
  await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
  await type(field, "{{unknown");
  expect(document.querySelector('[role="listbox"]')?.textContent).toContain("没有匹配的变量");
  await act(async () => setLocale("en"));
  expect(document.querySelector('[role="listbox"]')?.textContent).toContain("No matching variables");
});
