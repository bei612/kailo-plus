// Original token editing from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/workflows/ui/workflowTemplateVariables.ts.
// Suggestions reflect Core's real message-template consumer, not a new evaluator.
import { AutomationTriggerKind as TriggerKind, type AutomationStep } from "@client-kit/contracts";
import type { PlatformMessageKey } from "../i18n";

export type WorkflowTemplateVariable = {
  description: PlatformMessageKey;
  group: "workflows.template.triggerGroup" | "workflows.template.previousSteps";
  value: string;
};
export type ActiveTemplateToken = { end: number; query: string; start: number };

const eventVariables: WorkflowTemplateVariable[] = [
  { value: "trigger.text", description: "workflows.template.text", group: "workflows.template.triggerGroup" },
  { value: "trigger.author", description: "workflows.template.author", group: "workflows.template.triggerGroup" },
  { value: "trigger.channel_id", description: "workflows.template.channel", group: "workflows.template.triggerGroup" },
  { value: "trigger.timestamp", description: "workflows.template.timestamp", group: "workflows.template.triggerGroup" },
  { value: "trigger.message_id", description: "workflows.template.messageId", group: "workflows.template.triggerGroup" },
];

function triggerVariables(trigger: TriggerKind): WorkflowTemplateVariable[] {
  switch (trigger) {
    case TriggerKind.ChannelMessage:
    case TriggerKind.Mention:
      return eventVariables;
    case TriggerKind.Schedule:
      return eventVariables.filter(({ value }) => value === "trigger.channel_id" || value === "trigger.timestamp");
    default:
      return [];
  }
}

export function workflowTemplateVariables(trigger: TriggerKind, previousSteps: AutomationStep[] = []): WorkflowTemplateVariable[] {
  // Original STEP_OUTPUTS and prior-step filtering. Only the already executed
  // message outputs are exposed; no speculative webhook or delay output.
  const priorOutputs: WorkflowTemplateVariable[] = previousSteps.flatMap((step) => {
    if (step.action !== "send_message" || !/^[A-Za-z0-9_]+$/.test(step.id)) return [];
    return [
      {value: `steps.${step.id}.output.sent`, description: "workflows.template.sent", group: "workflows.template.previousSteps"},
      {value: `steps.${step.id}.output.event_id`, description: "workflows.template.sentMessageId", group: "workflows.template.previousSteps"},
    ];
  });
  return [...triggerVariables(trigger), ...priorOutputs];
}

/** Find an unfinished `{{variable` token immediately before the caret. */
export function activeTemplateToken(value: string, caret: number): ActiveTemplateToken | null {
  const beforeCaret = value.slice(0, caret);
  const start = beforeCaret.lastIndexOf("{{");
  if (start < 0) return null;
  const query = beforeCaret.slice(start + 2);
  if (query.includes("}}") || !/^[A-Za-z0-9._]*$/.test(query)) return null;
  const closingBraces = value.indexOf("}}", caret);
  const nestedOpening = value.indexOf("{{", start + 2);
  const end = closingBraces >= 0 && (nestedOpening < 0 || closingBraces < nestedOpening)
    ? closingBraces + 2 : caret;
  return { start, end, query };
}

export function insertTemplateVariable(value: string, token: ActiveTemplateToken, variable: string): { caret: number; value: string } {
  const insertion = `{{${variable}}}`;
  return { value: `${value.slice(0, token.start)}${insertion}${value.slice(token.end)}`, caret: token.start + insertion.length };
}
