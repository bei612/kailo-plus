// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/workflows/ui/WorkflowMessageTextConditionEditor.tsx::WorkflowMessageTextCondition,
// as the step card's Run controls uses it (allowAdvanced={false}). The emitted
// expression is the step's original `if`; Core evaluates it once at admission.
import { ChevronRight } from "lucide-react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as React from "react";
import { cn } from "./profile/buzz/shared/lib/cn";
import { Button } from "./profile/buzz/shared/ui/button";
import { Input } from "./composer/shared/ui/input";
import { MODAL_BACKDROP_BLUR_CLASS } from "./composer/shared/ui/modalBackdrop";
import { MODAL_CONTENT_MOTION_CLASS, MODAL_OVERLAY_MOTION_CLASS } from "./composer/shared/ui/modalMotion";
import { useT } from "./context";
import {
  MESSAGE_TEXT_CONDITION_LABELS,
  MESSAGE_TEXT_CONDITION_OPERATORS,
  buildMessageTextCondition,
  messageTextConditionNeedsValue,
  parseMessageTextCondition,
  type MessageTextCondition,
} from "./workflow-message-text-condition";

const DEFAULT_CONDITION: MessageTextCondition = { operator: "contains", value: "" };

export function WorkflowMessageTextCondition({ disabled, onChange, value }: {
  disabled?: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  const t = useT();
  const initialParsed = React.useRef(parseMessageTextCondition(value));
  const [expanded, setExpanded] = React.useState(() => !value || initialParsed.current !== null);
  const [replaceAdvancedOpen, setReplaceAdvancedOpen] = React.useState(false);
  const [condition, setCondition] = React.useState<MessageTextCondition>(initialParsed.current ?? DEFAULT_CONDITION);
  const localValueRef = React.useRef(value);
  const parsed = value ? parseMessageTextCondition(value) : null;
  const hasUnsupportedExpression = Boolean(value) && parsed === null;

  React.useEffect(() => {
    if (value === localValueRef.current) return;
    localValueRef.current = value;
    const nextParsed = parseMessageTextCondition(value);
    if (nextParsed) {
      setCondition(nextParsed);
      setExpanded(true);
    } else if (!value) {
      setCondition(DEFAULT_CONDITION);
      setExpanded(true);
    } else {
      setExpanded(false);
    }
  }, [value]);

  const emit = (expression: string) => {
    localValueRef.current = expression;
    onChange(expression);
  };
  const updateCondition = (next: MessageTextCondition) => {
    setCondition(next);
    emit(buildMessageTextCondition(next) ?? "");
  };
  const label = (operator: MessageTextCondition["operator"]) => t(MESSAGE_TEXT_CONDITION_LABELS[operator]).toLowerCase();
  const summary = !messageTextConditionNeedsValue(condition.operator) ? label(condition.operator)
    : condition.value.trim() ? `${label(condition.operator)} “${condition.value.trim()}”` : t("workflows.condition.any");

  return <>
    <div>
      {hasUnsupportedExpression ? <p className="border-b border-border/50 pb-3 text-xs text-muted-foreground">
        {t("workflows.textCondition.advancedActive")}
      </p> : null}
      <div className="divide-y divide-border/50">
        <div className={cn(expanded && "pb-4 last:pb-0")}>
          <button aria-expanded={expanded}
            className="flex min-h-12 w-full items-center gap-3 py-3 text-left transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled} type="button"
            onClick={() => { if (hasUnsupportedExpression) setReplaceAdvancedOpen(true); else setExpanded((current) => !current); }}>
            <span className="min-w-0 flex-1 truncate text-base font-medium">{t("workflows.condition.messageText")}</span>
            <span className="max-w-40 truncate text-sm text-muted-foreground">
              {hasUnsupportedExpression ? t("workflows.condition.any") : summary}
            </span>
            <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground/70 transition-transform duration-150 motion-reduce:transition-none",
              expanded && "rotate-90")} />
          </button>
          {expanded && !hasUnsupportedExpression ? <div className="animate-in space-y-4 pt-1 fade-in slide-in-from-top-1 duration-150 motion-reduce:animate-none">
            <fieldset>
              <legend className="sr-only">{t("workflows.condition.match")}</legend>
              <div className="grid grid-cols-2 gap-2.5">
                {MESSAGE_TEXT_CONDITION_OPERATORS.map((operator) => {
                  const id = `wf-trigger-filter-trigger-text-operator-${operator}`;
                  return <div className="relative" key={operator}>
                    <input checked={condition.operator === operator} className="peer sr-only" disabled={disabled} id={id}
                      name="wf-trigger-filter-trigger-text-operator" type="radio" value={operator}
                      onChange={() => updateCondition({ ...condition, operator })} />
                    <label htmlFor={id} className={cn(
                      "flex min-h-12 cursor-pointer items-center justify-center rounded-lg border px-3 py-2 text-center text-sm font-medium",
                      "outline-2 outline-offset-2 outline-transparent transition-[background-color,border-color,color,outline-color]",
                      "peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                      "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
                      condition.operator === operator
                        ? "border-border/0 bg-transparent text-foreground outline-foreground/45"
                        : "border-border/70 bg-background/35 text-muted-foreground hover:border-border hover:bg-muted/55 hover:text-foreground hover:outline-muted-foreground/20")}>
                      {label(operator)}
                    </label>
                  </div>;
                })}
              </div>
            </fieldset>
            {messageTextConditionNeedsValue(condition.operator) ? <Input aria-label={t("workflows.textCondition.value")}
              autoCapitalize="off" autoCorrect="off" disabled={disabled} id="wf-trigger-filter-trigger-text-value"
              placeholder={t("workflows.condition.example")} value={condition.value}
              onChange={(event) => updateCondition({ ...condition, value: event.target.value })} /> : null}
          </div> : null}
        </div>
      </div>
    </div>
    <AlertDialog.Root open={replaceAdvancedOpen} onOpenChange={setReplaceAdvancedOpen}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={cn("fixed inset-0 z-50 bg-black/60", MODAL_OVERLAY_MOTION_CLASS, MODAL_BACKDROP_BLUR_CLASS)} />
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
          <AlertDialog.Content className={cn("pointer-events-auto grid w-[calc(100vw-2rem)] max-w-md gap-4 outline-hidden rounded-3xl bg-background p-6 shadow-2xl", MODAL_CONTENT_MOTION_CLASS)}>
            <div className="flex flex-col space-y-2 text-left">
              <AlertDialog.Title className="text-xl font-semibold tracking-tight">{t("workflows.textCondition.replaceTitle")}</AlertDialog.Title>
              <AlertDialog.Description className="text-sm text-muted-foreground">{t("workflows.textCondition.replaceDescription")}</AlertDialog.Description>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialog.Cancel asChild><Button type="button" variant="outline">{t("workflows.textCondition.keep")}</Button></AlertDialog.Cancel>
              <AlertDialog.Action asChild><Button type="button" variant="destructive" onClick={() => {
                setCondition(DEFAULT_CONDITION);
                setExpanded(true);
                emit("");
              }}>{t("workflows.textCondition.replace")}</Button></AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </div>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  </>;
}
