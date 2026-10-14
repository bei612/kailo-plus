// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/workflows/ui/workflowActivationWarning.ts::getWorkflowActivationWarning.
// The original classification reads the governed AutomationVersionContent instead
// of Relay YAML; it only decides whether to ask before the governed enable action.
import { AutomationTriggerKind, type AutomationVersionContent } from "@client-kit/contracts";
import type { Translate } from "./context";
import { formatDurationSecondsVerbose } from "./workflow-duration";

export type WorkflowActivationWarning = { description: string; title: string };

const FREQUENT_SCHEDULE_THRESHOLD_SECONDS = 60 * 60;

function frequentIntervalDescription(seconds: number, t: Translate): string | null {
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > FREQUENT_SCHEDULE_THRESHOLD_SECONDS) return null;
  return t("workflows.activation.every", { duration: formatDurationSecondsVerbose(seconds, t) });
}

function normalizedCronFields(cron: string): string[] | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length === 5) return ["0", ...fields, "*"];
  if (fields.length === 6) return [...fields, "*"];
  return fields.length === 7 ? fields : null;
}

function repeatedFieldCount(field: string, maximum: number): number | null {
  if (field === "*") return maximum + 1;
  const step = /^\*\/(\d+)$/.exec(field);
  if (step) {
    const size = Number(step[1]);
    return size >= 1 && size <= maximum + 1 ? Math.ceil((maximum + 1) / size) : null;
  }
  if (field.includes(",") || field.includes("-")) return 2;
  return /^\d+$/.test(field) ? 1 : null;
}

/**
 * Reports whether an hour field selects every hour of the day, so schedules
 * written as `*`, `*\/1`, `0-23`, or an equivalent list still classify as
 * hourly. Unrecognized fields are treated as not matching every hour.
 */
function matchesEveryHour(field: string): boolean {
  const HOURS = 24;
  const selected = new Set<number>();
  for (const segment of field.split(",")) {
    const [base, step] = segment.split("/");
    if (step !== undefined && (!/^\d+$/.test(step) || Number(step) < 1)) return false;
    const size = step === undefined ? 1 : Number(step);
    let start: number, end: number;
    if (base === "*") {
      start = 0;
      end = HOURS - 1;
    } else {
      const bounds = (base ?? "").split("-");
      if (bounds.length > 2 || bounds.some((part) => !/^\d+$/.test(part))) return false;
      start = Number(bounds[0]);
      end = bounds.length === 2 ? Number(bounds[1]) : start;
      if (start > end || end >= HOURS) return false;
      // A bare hour selects only itself; a stepped one runs to end of day.
      if (bounds.length === 1) {
        if (step === undefined) {
          selected.add(start);
          continue;
        }
        end = HOURS - 1;
      }
    }
    for (let hour = start; hour <= end; hour += size) selected.add(hour);
  }
  return selected.size === HOURS;
}

function frequentCronDescription(cron: string, t: Translate): string | null {
  const fields = normalizedCronFields(cron);
  if (!fields) return null;
  const [second = "", minute = "", hour = ""] = fields;
  const secondRuns = repeatedFieldCount(second, 59);
  const minuteRuns = repeatedFieldCount(minute, 59);
  if (secondRuns === null || minuteRuns === null) return null;
  if (!matchesEveryHour(hour)) return null;
  if (secondRuns > 1) return t("workflows.activation.multiplePerMinute");
  if (minute === "*") return t("workflows.activation.everyMinute");
  const steppedMinute = /^\*\/(\d+)$/.exec(minute);
  if (steppedMinute) {
    const minutes = Number(steppedMinute[1]);
    return t("workflows.activation.every", {
      duration: t(minutes === 1 ? "workflows.duration.minute" : "workflows.duration.minutes", { count: minutes }),
    });
  }
  if (minuteRuns === 1) return t("workflows.activation.everyHour");
  if (minuteRuns > 1) return t("workflows.activation.multiplePerHour");
  return null;
}

export function getWorkflowActivationWarning(content: AutomationVersionContent, t: Translate): WorkflowActivationWarning | null {
  const trigger = content.trigger;
  // Original message_posted without filter. A Kailo text prefix is an extra
  // admitted constraint, so it is not "every new message".
  if (trigger.kind === AutomationTriggerKind.ChannelMessage && !trigger.filter?.trim() && !trigger.textPrefix) {
    return { description: t("workflows.activation.everyMessage"), title: t("workflows.activation.title") };
  }
  if (trigger.kind === AutomationTriggerKind.Schedule && trigger.scheduleSpec) {
    const spec = trigger.scheduleSpec;
    const description = spec.cron !== undefined
      ? frequentCronDescription(spec.cron, t)
      : spec.everySeconds !== undefined ? frequentIntervalDescription(spec.everySeconds, t) : null;
    if (description) return { description, title: t("workflows.activation.title") };
  }
  return null;
}
