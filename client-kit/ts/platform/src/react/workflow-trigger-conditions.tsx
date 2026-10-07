// Fixed Buzz 779af8886caae1317b4de962082429867ab61503 WorkflowTriggerConditions.
// Original message_posted branch. Other trigger kinds remain unavailable in Core.
import { ChevronRight } from "lucide-react";
import * as React from "react";

import { cn } from "./profile/buzz/shared/lib/cn";
import { Input } from "./composer/shared/ui/input";
import { UserAvatar } from "./messages/UserAvatar";
import { Tabs, TabsList, TabsTrigger } from "./profile/buzz/shared/ui/tabs";
import { WorkflowAuthorPicker } from "./workflow-author-picker";
import {
  buildConditionExpressions,
  conditionFieldsForTrigger,
  conditionOperatorNeedsValue,
  conditionOperatorsForField,
  conditionValueError,
  parseConditionExpressions,
  type ConditionOperator,
  type ParsedConditionExpression,
} from "./workflow-condition-expression";

import { useT } from "./context";
import { useWorkflowAuthorDirectory, useWorkflowAuthorProfiles } from "./workflow-author-directory";
import { resolveUserLabel } from "./messages/system/identity";
import { parseDirectAuthorInput } from "./workflow-author-candidates";
import type { PlatformMessageKey } from "../i18n";

const operatorMessageKeys = {
  contains: "workflows.condition.contains",
  not_contains: "workflows.condition.notContains",
  starts_with: "workflows.condition.startsWith",
  ends_with: "workflows.condition.endsWith",
  equals: "workflows.condition.equals",
  not_equals: "workflows.condition.notEquals",
  is_not_empty: "workflows.condition.isNotEmpty",
  is_empty: "workflows.condition.isEmpty",
} satisfies Record<ConditionOperator, PlatformMessageKey>;

// Original workflowFormPrimitives.tsx::FieldLabel.
function FieldLabel({children, htmlFor}: {children: React.ReactNode; htmlFor?: string}) {
  return <label className="block text-xs font-medium text-muted-foreground" htmlFor={htmlFor}>{children}</label>;
}

function emptyCondition(field: string): ParsedConditionExpression {
  return {
    field,
    operator: conditionOperatorsForField(field)[0],
    value: "",
    webhookField: "",
  };
}

function compact(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= 20
    ? trimmed
    : `${trimmed.slice(0, 11)}…${trimmed.slice(-6)}`;
}

function fieldUsesFullHeightPicker(field: string): boolean {
  return field === "trigger_author" || field === "trigger_message_id";
}


function ExclusionStrike() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span className="absolute inset-0 [clip-path:circle(50%_at_50%_50%)]">
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="block h-1 w-9 translate-y-0.5 -rotate-45 rounded-full bg-background/90" />
        </span>
      </span>
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <span className="block h-0.5 w-8 -rotate-45 rounded-full bg-muted-foreground" />
      </span>
    </span>
  );
}

function AuthorConditionSummary({
  resolveMediaUrl,
  avatarUrl,
  excluded,
  isAgent,
  label,
}: {
  avatarUrl: string | null;
  resolveMediaUrl: (url: string) => string | undefined;
  excluded: boolean;
  isAgent?: boolean;
  label: string;
}) {
  const t = useT();
  return (
    <span className="flex shrink-0 items-center">
      <span className="relative shrink-0">
        <UserAvatar
          avatarUrl={avatarUrl}
          resolveMediaUrl={resolveMediaUrl}
          className="h-6 w-6"
          displayName={label}
          fallbackDelayMs={0}
          shape={isAgent ? "squircle" : "circle"}
          size="xs"
        />
        {excluded ? <ExclusionStrike /> : null}
      </span>
      <span className="sr-only">
        {t(excluded ? "workflows.condition.excludedAuthor" : "workflows.condition.selectedAuthor")}
        {label}
      </span>
    </span>
  );
}

export function WorkflowTriggerConditions({
  conditionDrafts,
  disabled,
  onChange,
  onConditionDraftsChange,
  triggerType = "message_posted",
  value,
  workflowChannelId,
}: {
  conditionDrafts: ParsedConditionExpression[] | null;
  disabled?: boolean;
  onChange: (value: string) => void;
  onConditionDraftsChange: (drafts: ParsedConditionExpression[] | null) => void;
  triggerType?: "message_posted";
  value: string;
  workflowChannelId?: string | null;
}) {
  const t = useT();
  const directory = useWorkflowAuthorDirectory(workflowChannelId ?? undefined);
  const parsedValue = React.useMemo(
    () => parseConditionExpressions(value, triggerType),
    [triggerType, value],
  );
  const [mode, setMode] = React.useState<"basic" | "advanced">(() =>
    value && parsedValue === null ? "advanced" : "basic",
  );
  const [expandedField, setExpandedField] = React.useState<string | null>(
    () => conditionFieldsForTrigger(triggerType)[0]?.value ?? null,
  );
  const disclosureButtons = React.useRef(new Map<string, HTMLButtonElement>());
  const collapsePicker = React.useCallback((field: string) => {
    setExpandedField(null);
    disclosureButtons.current.get(field)?.focus();
  }, []);
  const conditions = conditionDrafts ?? parsedValue ?? [];
  const localValue = React.useRef(value);
  const authorCondition = conditions.find((condition) => condition.field === "trigger_author");
  const authorKey = parseDirectAuthorInput(authorCondition?.value ?? "");
  const authorProfile = useWorkflowAuthorProfiles(workflowChannelId ?? undefined, authorKey ? [authorKey] : [], directory);
  const candidate = directory.rows.find((row) => row.pubkey === authorKey);
  const triggerPresentation = {
    pubkey: authorKey,
    label: authorKey ? resolveUserLabel({pubkey: authorKey, fallbackName: candidate?.displayName, profiles: authorProfile.profiles, t}) : null,
    avatarUrl: authorKey ? authorProfile.profiles[authorKey]?.avatarUrl ?? null : null,
    isAgent: false,
  };

  React.useEffect(() => {
    if (value === localValue.current) return;
    localValue.current = value;
    const parsed = parseConditionExpressions(value, triggerType);
    if (parsed) {
      onConditionDraftsChange(null);
      setMode("basic");
    } else if (value) {
      setMode("advanced");
    }
  }, [onConditionDraftsChange, triggerType, value]);

  const updateConditions = (next: ParsedConditionExpression[]) => {
    onConditionDraftsChange(next);
    if (
      next.some((condition) =>
        conditionValueError(condition.field, condition.value),
      )
    ) {
      return;
    }
    const expression = buildConditionExpressions(next);
    localValue.current = expression;
    onChange(expression);
  };

  const fields = conditionFieldsForTrigger(triggerType);
  const fullHeightPickerExpanded =
    mode === "basic" && fieldUsesFullHeightPicker(expandedField ?? "");

  return (
    <Tabs
      className={cn(
        "space-y-3",
        fullHeightPickerExpanded &&
          "flex h-full min-h-0 flex-col space-y-0 gap-3",
      )}
      onValueChange={(next) => setMode(next as "basic" | "advanced")}
      value={mode}
    >
      <TabsList
        aria-label={t("workflows.condition.mode")}
        className="grid h-9 w-full grid-cols-2 p-0.5"
      >
        <TabsTrigger className="h-8" disabled={disabled} value="basic">
          {t("workflows.condition.basic")}
        </TabsTrigger>
        <TabsTrigger className="h-8" disabled={disabled} value="advanced">
          {t("agents.version.advanced")}
        </TabsTrigger>
      </TabsList>

      {mode === "advanced" ? (
        <div className="space-y-2">
          <Input
            aria-label={t("workflows.condition.expression")}
            autoCapitalize="off"
            autoCorrect="off"
            disabled={disabled}
            onChange={(event) => {
              onConditionDraftsChange(null);
              localValue.current = event.target.value;
              onChange(event.target.value.trim());
            }}
            placeholder={t("workflows.condition.expressionExample")}
            value={value}
          />
          <p className="text-xs text-muted-foreground">
            {t("workflows.condition.expressionHelp")}
          </p>
        </div>
      ) : parsedValue === null && value.trim() ? (
        <div className="space-y-3 rounded-md border border-border/70 p-3">
          <p className="text-xs text-muted-foreground">
            {t("workflows.condition.advancedActive")}
          </p>
          <button
            className="text-sm font-medium text-destructive hover:underline"
            disabled={disabled}
            onClick={() => {
              onConditionDraftsChange(null);
              localValue.current = "";
              onChange("");
            }}
            type="button"
          >
            {t("workflows.condition.replace")}
          </button>
        </div>
      ) : (
        <div
          className={cn(
            "divide-y divide-border/50",
            fullHeightPickerExpanded && "flex min-h-0 flex-1 flex-col",
          )}
        >
          {fields.map((field) => {
            const existing = conditions.find(
              (condition) => condition.field === field.value,
            );
            const condition = existing ?? emptyCondition(field.value);
            const expanded = expandedField === field.value;
            const error = conditionValueError(field.value, condition.value);
            const summary = existing
              ? `${t(operatorMessageKeys[condition.operator])}${condition.value ? ` ${compact(condition.value)}` : ""}`
              : t("workflows.condition.any");
            const authorSummary =
              existing &&
              field.value === "trigger_author" &&
              triggerPresentation.pubkey &&
              triggerPresentation.label
                ? triggerPresentation.label
                : null;
            return (
              <div
                className={cn(
                  expanded && "pb-4 last:pb-0",
                  expanded &&
                    fieldUsesFullHeightPicker(field.value) &&
                    "flex min-h-0 flex-1 flex-col",
                )}
                key={field.value}
              >
                <button
                  aria-expanded={expanded}
                  className="flex min-h-12 w-full items-center gap-3 py-3 text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
                  disabled={disabled}
                  onClick={() =>
                    setExpandedField(expanded ? null : field.value)
                  }
                  ref={(button) => {
                    if (button)
                      disclosureButtons.current.set(field.value, button);
                    else disclosureButtons.current.delete(field.value);
                  }}
                  type="button"
                >
                  <span className="min-w-0 flex-1 truncate text-base font-medium">
                    {t(field.value === "trigger_author" ? "workflows.condition.author" : "workflows.condition.messageText")}
                  </span>
                  {authorSummary ? (
                    <AuthorConditionSummary
                      avatarUrl={triggerPresentation.avatarUrl}
                      resolveMediaUrl={authorProfile.resolveMediaUrl}
                      excluded={condition.operator === "not_equals"}
                      isAgent={triggerPresentation.isAgent}
                      label={authorSummary}
                    />
                  ) : (
                    <span className="max-w-44 truncate font-mono text-xs text-muted-foreground">
                      {summary}
                    </span>
                  )}
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform duration-150 motion-reduce:transition-none",
                      expanded && "rotate-90",
                    )}
                  />
                </button>
                {expanded ? (
                  <div
                    className={cn(
                      "animate-in space-y-3 pt-1 fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none",
                      fieldUsesFullHeightPicker(field.value) &&
                        "flex min-h-0 flex-1 flex-col space-y-0 gap-3",
                    )}
                  >
                    <fieldset>
                      <legend className="sr-only">{t("workflows.condition.match")}</legend>
                      <div className="grid grid-cols-2 gap-2.5">
                        {conditionOperatorsForField(field.value).map(
                          (operator) => {
                            const selected = condition.operator === operator;
                            return (
                              <button
                                aria-pressed={selected}
                                className={cn(
                                  "flex min-h-12 items-center justify-center rounded-lg border px-3 py-2 text-center text-sm font-medium",
                                  "outline-2 outline-offset-2 outline-transparent transition-[background-color,border-color,color,outline-color] focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                                  selected
                                    ? "border-border/0 bg-transparent text-foreground outline-foreground/45"
                                    : "border-border/70 bg-background/35 text-muted-foreground hover:border-border hover:bg-muted/55 hover:text-foreground hover:outline-muted-foreground/20",
                                )}
                                disabled={disabled}
                                key={operator}
                                onClick={() => {
                                  const next = { ...condition, operator };
                                  updateConditions([
                                    ...conditions.filter(
                                      (item) => item.field !== field.value,
                                    ),
                                    next,
                                  ]);
                                }}
                                type="button"
                              >
                                {t(operatorMessageKeys[operator])}
                              </button>
                            );
                          },
                        )}
                      </div>
                    </fieldset>
                    {conditionOperatorNeedsValue(condition.operator) ? (
                      field.value === "trigger_author" ? (
                        <WorkflowAuthorPicker
                          channelId={workflowChannelId}
                          directory={directory}
                          disabled={disabled}
                          id="wf-trigger-author-value"
                          onEscape={() => collapsePicker(field.value)}
                          onChange={(pubkey) =>
                            updateConditions(
                              pubkey
                                ? [
                                    ...conditions.filter(
                                      (item) => item.field !== field.value,
                                    ),
                                    { ...condition, value: pubkey },
                                  ]
                                : conditions.filter(
                                    (item) => item.field !== field.value,
                                  ),
                            )
                          }
                          value={condition.value}
                        />
                      ) : (
                        <div className="space-y-1.5">
                          <FieldLabel
                            htmlFor={`wf-trigger-${field.value}-value`}
                          >
                            {t(field.value === "trigger_author" ? "workflows.condition.author" : "workflows.condition.messageText")}
                          </FieldLabel>
                          <Input
                            aria-describedby={
                              error
                                ? `wf-trigger-${field.value}-error`
                                : undefined
                            }
                            aria-invalid={error ? true : undefined}
                            autoCapitalize="off"
                            autoCorrect="off"
                            disabled={disabled}
                            id={`wf-trigger-${field.value}-value`}
                            onChange={(event) =>
                              updateConditions([
                                ...conditions.filter(
                                  (item) => item.field !== field.value,
                                ),
                                { ...condition, value: event.target.value },
                              ])
                            }
                            placeholder={t("workflows.condition.example")}
                            spellCheck={field.value === "trigger_text"}
                            value={condition.value}
                          />
                          {error ? (
                            <p
                              className="text-xs text-destructive"
                              id={`wf-trigger-${field.value}-error`}
                            >
                              {t("workflows.condition.invalidPubkey")}
                            </p>
                          ) : null}
                        </div>
                      )
                    ) : null}
                    {existing && !fieldUsesFullHeightPicker(field.value) ? (
                      <button
                        className="text-xs font-medium text-muted-foreground hover:text-foreground"
                        disabled={disabled}
                        onClick={() =>
                          updateConditions(
                            conditions.filter(
                              (item) => item.field !== field.value,
                            ),
                          )
                        }
                        type="button"
                      >
                        {t("workflows.condition.clear")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Tabs>
  );
}
