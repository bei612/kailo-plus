// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/workflows/ui/cronExpression.ts. Original field editor;
// weekday bounds follow its Rust cron 0.16 consumer (1=SUN, 7=SAT).
import { translateCurrent as t } from "../i18n";
export const CRON_FIELD_DEFINITIONS = [
  { label: "workflows.cron.minute", max: 59, min: 0 },
  { label: "workflows.cron.hour", max: 23, min: 0 },
  { label: "workflows.cron.day", max: 31, min: 1 },
  {
    aliases: [
      "JAN",
      "FEB",
      "MAR",
      "APR",
      "MAY",
      "JUN",
      "JUL",
      "AUG",
      "SEP",
      "OCT",
      "NOV",
      "DEC",
    ],
    label: "workflows.cron.month",
    max: 12,
    min: 1,
  },
  {
    aliases: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
    label: "workflows.cron.weekday",
    max: 7,
    min: 1,
  },
] as const;

export type CronFields = [string, string, string, string, string];

export function cronFieldsFromExpression(expression: string): CronFields {
  const values = expression.trim() ? expression.trim().split(/\s+/) : [];
  return [
    values[0] ?? "",
    values[1] ?? "",
    values[2] ?? "",
    values[3] ?? "",
    values[4] ?? "",
  ];
}

export function cronExpressionFromFields(fields: CronFields): string {
  return fields.join(" ");
}

export function normalizeCronExpression(expression: string): string {
  return expression.trim().replace(/\s+/g, " ");
}

export function cronFieldsFromPaste(
  pastedValue: string,
): { fields: CronFields; ok: true } | { error: string; ok: false } {
  const values = pastedValue.trim().split(/\s+/);
  if (values.length !== CRON_FIELD_DEFINITIONS.length) {
    return {
      error: t("workflows.cron.pasteCount", {count: values.length}),
      ok: false,
    };
  }
  return { fields: values as CronFields, ok: true };
}

const CRON_YAML_FIELDS = [
  { label: "workflows.cron.second", min: 0, max: 59 },
  { label: "workflows.cron.year", min: 2000, max: 2100 },
] as const;
type CronFieldDefinition = (typeof CRON_FIELD_DEFINITIONS)[number] | (typeof CRON_YAML_FIELDS)[number];

function namedOrdinal(atom: string, definition: CronFieldDefinition): number | undefined {
  if (!("aliases" in definition)) return undefined;
  const names = definition.label === "workflows.cron.month"
    ? ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"]
    : ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const value = atom.toUpperCase();
  const index = names.findIndex((name, index) => name === value || definition.aliases[index] === value
    || (definition.label === "workflows.cron.weekday" && ((value === "TUES" && index === 2) || (value === "THURS" && index === 4))));
  return index < 0 ? undefined : index + definition.min;
}

function atomError(
  atom: string,
  definition: CronFieldDefinition,
): string | null {
  if (namedOrdinal(atom, definition) !== undefined) {
    return null;
  }
  if (!/^\d+$/.test(atom)) {
    return t("workflows.cron.atom", {field: t(definition.label), value: atom});
  }

  const value = Number(atom);
  if (value < definition.min || value > definition.max) {
    return t("workflows.cron.bounds", {field: t(definition.label), min: definition.min, max: definition.max});
  }
  return null;
}

function segmentError(
  segment: string,
  definition: CronFieldDefinition,
): string | null {
  const stepParts = segment.split("/");
  if (stepParts.length > 2 || stepParts.some((part) => !part)) {
    return t("workflows.cron.step", {field: t(definition.label)});
  }

  const base = stepParts[0]!;
  const step = stepParts[1];
  if (step !== undefined) {
    if (!/^\d+$/.test(step) || Number(step) < 1) {
      return t("workflows.cron.stepPositive", {field: t(definition.label)});
    }
  }

  if (base === "*") return null;

  const rangeParts = base.split("-");
  if (rangeParts.length > 2 || rangeParts.some((part) => !part)) {
    return t("workflows.cron.range", {field: t(definition.label)});
  }

  const startError = atomError(rangeParts[0]!, definition);
  if (startError) return startError;
  if (rangeParts.length === 1) return null;

  const endError = atomError(rangeParts[1]!, definition);
  if (endError) return endError;

  const ordinal = (atom: string) => namedOrdinal(atom, definition) ?? Number(atom);
  const start = ordinal(rangeParts[0]!);
  const end = ordinal(rangeParts[1]!);
  if (Number.isFinite(start) && Number.isFinite(end) && start > end) {
    return t("workflows.cron.rangeOrder", {field: t(definition.label)});
  }
  return null;
}

export function validateCronField(
  value: string,
  definition: CronFieldDefinition,
): string | null {
  if (!value) return t("workflows.cron.required", {field: t(definition.label)});

  const segments = value.split(",");
  if (segments.some((segment) => !segment)) {
    return t("workflows.cron.empty", {field: t(definition.label)});
  }

  for (const segment of segments) {
    const error = segmentError(segment, definition);
    if (error) return error;
  }
  return null;
}

export function validateCronFields(fields: CronFields): Array<string | null> {
  return fields.map((field, index) =>
    validateCronField(field, CRON_FIELD_DEFINITIONS[index]!),
  );
}

export function cronExpressionError(expression: string): string | null {
  const parsed = cronFieldsFromPaste(expression);
  if (!parsed.ok) return parsed.error;
  return validateCronFields(parsed.fields).find(Boolean) ?? null;
}

// Original Buzz normalize_cron: 5 fields add second=0/year=*, 6 add year=*.
// Keep the original five-field form; six/seven fields remain editable in YAML.
export function cronYamlError(expression: string): string | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length === CRON_FIELD_DEFINITIONS.length) return cronExpressionError(expression);
  if (fields.length !== 6 && fields.length !== 7) return t("workflows.cron.yamlFields");
  const definitions = [CRON_YAML_FIELDS[0], ...CRON_FIELD_DEFINITIONS, CRON_YAML_FIELDS[1]];
  return fields.map((field, index) => validateCronField(field, definitions[index]!)).find(Boolean) ?? null;
}
