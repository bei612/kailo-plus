// Fixed Buzz 779af8886caae1317b4de962082429867ab61503: desktop/src/features/workflows/ui/WorkflowScheduleFields.tsx.
import { AlertTriangle, ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "./profile/buzz/shared/lib/cn";
import { Input } from "./composer/shared/ui/input";
import { CronExpressionInput } from "./cron-expression-input";
import { useT } from "./context";
import type { PlatformMessageKey } from "../i18n";
import type { TriggerConfig } from "./workflow-schedule";
import {
  SCHEDULE_FREQUENCIES,
  scheduleFormFromTrigger,
  scheduleTriggerFromForm,
  scheduleWeekdaysFromCronField,
} from "./workflow-schedule";
import type { ScheduleFormState } from "./workflow-schedule";

const WEEKDAYS = [
  ["1", "workflows.schedule.sunday", "workflows.schedule.sundayShort"],
  ["2", "workflows.schedule.monday", "workflows.schedule.mondayShort"],
  ["3", "workflows.schedule.tuesday", "workflows.schedule.tuesdayShort"],
  ["4", "workflows.schedule.wednesday", "workflows.schedule.wednesdayShort"],
  ["5", "workflows.schedule.thursday", "workflows.schedule.thursdayShort"],
  ["6", "workflows.schedule.friday", "workflows.schedule.fridayShort"],
  ["7", "workflows.schedule.saturday", "workflows.schedule.saturdayShort"],
] as const;

const MONTH_DAYS = Array.from({ length: 31 }, (_, index) => String(index + 1));

function monthlyDayWarning(monthDay: string): boolean {
  return Number(monthDay) > 28;
}

function customCronSeed(schedule: ScheduleFormState): string {
  const currentTrigger = scheduleTriggerFromForm(schedule);
  if (currentTrigger.cron) return currentTrigger.cron;

  switch (currentTrigger.interval) {
    case "15m":
      return "*/15 * * * *";
    case "30m":
      return "*/30 * * * *";
    case "1h":
      return "0 * * * *";
    default:
      return "";
  }
}

export function WorkflowScheduleFields({
  disabled,
  onUpdate,
  trigger,
}: {
  disabled?: boolean;
  onUpdate: (trigger: TriggerConfig) => void;
  trigger: TriggerConfig;
}) {
  const t = useT();
  const [forceCustomCron, setForceCustomCron] = React.useState(false);
  const parsedSchedule = scheduleFormFromTrigger(trigger);
  const schedule: ScheduleFormState = forceCustomCron
    ? {
        ...parsedSchedule,
        customCron: trigger.cron ?? parsedSchedule.customCron,
        frequency: "custom_cron",
      }
    : parsedSchedule;
  const updateSchedule = (updates: Partial<ScheduleFormState>) => {
    onUpdate(scheduleTriggerFromForm({ ...schedule, ...updates }));
  };
  const usesTime = ["daily", "weekly", "monthly"].includes(schedule.frequency);
  const selectedWeekdays = new Set(
    scheduleWeekdaysFromCronField(schedule.weekday),
  );
  const warning = monthlyDayWarning(schedule.monthDay);

  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="sr-only">{t("workflows.schedule.repeats")}</legend>
        <div className="grid grid-cols-2 gap-2.5">
          {SCHEDULE_FREQUENCIES.map((frequency) => {
            const id = `wf-trigger-frequency-${frequency}`;
            return (
              <div
                className={cn(
                  "relative",
                  frequency === "custom_cron" && "col-span-2",
                )}
                key={frequency}
              >
                <input
                  checked={schedule.frequency === frequency}
                  className="peer sr-only"
                  disabled={disabled}
                  id={id}
                  name="wf-trigger-frequency"
                  onChange={() => {
                    const isCustom = frequency === "custom_cron";
                    setForceCustomCron(isCustom);
                    updateSchedule({
                      customCron: isCustom
                        ? customCronSeed(schedule)
                        : schedule.customCron,
                      frequency,
                    });
                  }}
                  type="radio"
                  value={frequency}
                />
                <label
                  className={cn(
                    "flex min-h-12 cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-center text-sm font-medium",
                    "outline-2 outline-offset-2 outline-transparent transition-[background-color,border-color,color,outline-color]",
                    "peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                    "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
                    schedule.frequency === frequency
                      ? "border-border/0 bg-transparent text-foreground outline-foreground/45"
                      : "border-border/70 bg-background/35 text-muted-foreground hover:border-border hover:bg-muted/55 hover:text-foreground hover:outline-muted-foreground/20",
                  )}
                  htmlFor={id}
                >
                  {t(frequencyMessages[frequency])}
                </label>
              </div>
            );
          })}
        </div>
      </fieldset>

      {schedule.frequency === "weekly" ? (
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-muted-foreground">
            {t("workflows.schedule.repeatOn")}
          </legend>
          <div className="grid grid-cols-7 gap-2">
            {WEEKDAYS.map(([value, label, shortLabel]) => {
              const id = `wf-trigger-weekday-${value}`;
              return (
                <div className="relative" key={value}>
                  <input
                    aria-label={t(label)}
                    checked={selectedWeekdays.has(value)}
                    className="peer sr-only"
                    disabled={disabled}
                    id={id}
                    name="wf-trigger-weekday"
                    onChange={() => {
                      const nextWeekdays = new Set(selectedWeekdays);
                      if (nextWeekdays.has(value)) {
                        if (nextWeekdays.size === 1) return;
                        nextWeekdays.delete(value);
                      } else {
                        nextWeekdays.add(value);
                      }
                      updateSchedule({
                        weekday: WEEKDAYS.map(([day]) => day)
                          .filter((day) => nextWeekdays.has(day))
                          .join(","),
                      });
                    }}
                    type="checkbox"
                    value={value}
                  />
                  <label
                    className={cn(
                      "flex aspect-square cursor-pointer items-center justify-center rounded-full text-xs font-medium transition-colors",
                      "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
                      "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
                      selectedWeekdays.has(value)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                    )}
                    htmlFor={id}
                  >
                    {t(shortLabel)}
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {schedule.frequency === "monthly" ? (
        <div className="space-y-1.5">
          <FieldLabel htmlFor="wf-trigger-month-day">{t("workflows.schedule.monthDay")}</FieldLabel>
          <FormSelect
            disabled={disabled}
            id="wf-trigger-month-day"
            onChange={(monthDay) => updateSchedule({ monthDay })}
            value={schedule.monthDay}
          >
            {MONTH_DAYS.map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </FormSelect>
          {warning ? (
            <div
              className="flex gap-2 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2"
              role="status"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="text-xs leading-5 text-warning">{t("workflows.schedule.shortMonth")}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {usesTime ? (
        <div className="space-y-1.5">
          <FieldLabel htmlFor="wf-trigger-time">{t("workflows.schedule.time")}</FieldLabel>
          <Input
            disabled={disabled}
            id="wf-trigger-time"
            onChange={(event) => updateSchedule({ time: event.target.value })}
            type="time"
            value={schedule.time}
          />
        </div>
      ) : null}

      {schedule.frequency === "custom_cron" ? (
        <CronExpressionInput
          disabled={disabled}
          onChange={(customCron) => updateSchedule({ customCron })}
          value={schedule.customCron}
        />
      ) : null}

      {schedule.frequency === "custom_interval" ? (
        <div className="space-y-1.5">
          <FieldLabel htmlFor="wf-trigger-interval">
            {t("workflows.schedule.existingInterval")}
          </FieldLabel>
          <Input
            autoCapitalize="off"
            autoCorrect="off"
            disabled={disabled}
            id="wf-trigger-interval"
            onChange={(event) =>
              updateSchedule({ customInterval: event.target.value })
            }
            value={schedule.customInterval}
          />
          <p className="text-xs text-muted-foreground">
            {t("workflows.schedule.legacyHelp")}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function FormSelect({
  children,
  disabled,
  id,
  onChange,
  value,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  id?: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="relative">
      <select
        className="flex h-9 w-full appearance-none rounded-md border border-input bg-transparent px-3 pr-8 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

function FieldLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      className="block text-xs font-medium text-muted-foreground"
      htmlFor={htmlFor}
    >
      {children}
    </label>
  );
}

const frequencyMessages = {
  every_15_minutes: "workflows.schedule.every15",
  every_30_minutes: "workflows.schedule.every30",
  hourly: "workflows.schedule.hourly",
  daily: "workflows.schedule.daily",
  weekly: "workflows.schedule.weekly",
  monthly: "workflows.schedule.monthly",
  custom_cron: "workflows.schedule.customCron",
} satisfies Record<(typeof SCHEDULE_FREQUENCIES)[number], PlatformMessageKey>;
