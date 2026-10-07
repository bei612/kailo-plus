// Reused from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/workflows/ui/WorkflowTemplateTextarea.tsx::WorkflowTemplateTextarea.
// Only variables with an existing Core template consumer are offered.
import * as React from "react";
import type { AutomationTriggerKind as TriggerKind } from "@client-kit/contracts";
import { useT } from "./context";

import { cn } from "./profile/buzz/shared/lib/cn";
import { Popover, PopoverAnchor, PopoverContent } from "./conversations/popover";
import { Textarea } from "./profile/buzz/shared/ui/textarea";
import {
  activeTemplateToken,
  insertTemplateVariable,
  workflowTemplateVariables,
} from "./workflow-template-variables";
import type {
  ActiveTemplateToken,
  WorkflowTemplateVariable,
} from "./workflow-template-variables";

export function WorkflowTemplateTextarea({
  className,
  disabled,
  onValueChange,
  triggerType,
  value,
  ...props
}: Omit<React.ComponentProps<typeof Textarea>, "onChange" | "value"> & {
  onValueChange: (value: string) => void;
  triggerType: TriggerKind;
  value: string;
}) {
  const t = useT();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const generatedId = React.useId();
  const textareaId = props.id ?? `workflow-template-${generatedId}`;
  const listboxId = `${textareaId}-variables`;
  const [token, setToken] = React.useState<ActiveTemplateToken | null>(null);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const variables = React.useMemo(
    () => workflowTemplateVariables(triggerType),
    [triggerType],
  );
  const suggestions = React.useMemo(() => {
    if (!token) return [];
    const query = token.query.toLowerCase();
    return variables.filter(
      (variable) =>
        variable.value.toLowerCase().includes(query) ||
        t(variable.description).toLowerCase().includes(query),
    );
  }, [token, variables, t]);
  const open = !disabled && token !== null;
  const selectedOptionId = suggestions[selectedIndex]
    ? `${listboxId}-option-${selectedIndex}`
    : undefined;

  const updateToken = React.useCallback((nextValue: string, caret: number) => {
    setToken(activeTemplateToken(nextValue, caret));
    setSelectedIndex(0);
  }, []);

  const selectVariable = React.useCallback(
    (variable: WorkflowTemplateVariable) => {
      if (!token || disabled) return;
      const next = insertTemplateVariable(value, token, variable.value);
      onValueChange(next.value);
      setToken(null);
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(next.caret, next.caret);
      });
    },
    [disabled, onValueChange, token, value],
  );

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setToken(null);
      }}
    >
      <PopoverAnchor asChild>
        <Textarea
          {...props}
          aria-activedescendant={open ? selectedOptionId : undefined}
          aria-autocomplete="list"
          aria-controls={open ? listboxId : undefined}
          aria-expanded={open}
          aria-haspopup="listbox"
          className={className}
          disabled={disabled}
          id={textareaId}
          onChange={(event) => {
            const nextValue = event.target.value;
            onValueChange(nextValue);
            updateToken(nextValue, event.target.selectionStart);
          }}
          onClick={(event) =>
            updateToken(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
            )
          }
          onKeyDown={(event) => {
            if (!open || event.nativeEvent.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setToken(null);
              return;
            }
            if (suggestions.length === 0) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const direction = event.key === "ArrowDown" ? 1 : -1;
              setSelectedIndex(
                (current) =>
                  (current + direction + suggestions.length) %
                  suggestions.length,
              );
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              selectVariable(suggestions[selectedIndex] ?? suggestions[0]!);
            }
          }}
          ref={textareaRef}
          value={value}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-72 p-1.5"
        onOpenAutoFocus={(event) => event.preventDefault()}
        side="bottom"
        sideOffset={6}
      >
        <div className="max-h-72 overflow-y-auto" id={listboxId} role="listbox">
          {suggestions.length > 0 ? (
            suggestions.map((variable, index) => {
              const previousGroup = suggestions[index - 1]?.group;
              return (
                <React.Fragment key={variable.value}>
                  {variable.group !== previousGroup ? (
                    <p className="px-2 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t(variable.group)}
                    </p>
                  ) : null}
                  <button
                    aria-selected={index === selectedIndex}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left",
                      index === selectedIndex
                        ? "bg-muted text-foreground"
                        : "text-foreground hover:bg-muted/60",
                    )}
                    id={`${listboxId}-option-${index}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => selectVariable(variable)}
                    role="option"
                    type="button"
                  >
                    <code className="min-w-0 truncate text-xs">
                      {`{{${variable.value}}}`}
                    </code>
                    <span className="shrink-0 text-2xs text-muted-foreground">
                      {t(variable.description)}
                    </span>
                  </button>
                </React.Fragment>
              );
            })
          ) : (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              {t("workflows.template.noMatches")}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
