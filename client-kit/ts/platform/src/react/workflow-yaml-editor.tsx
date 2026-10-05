// Reused from Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/shared/ui/textarea.tsx::Textarea and
// desktop/src/features/workflows/ui/WorkflowFormBuilder.tsx::WorkflowFormBuilder.
// Both platform hosts consume this original controlled textarea, not a second editor.
import * as React from "react";
import { twMerge } from "tailwind-merge";
import { useT } from "./context";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => <textarea
    autoCapitalize="none" autoCorrect="off" spellCheck={false}
    className={twMerge(
      "flex min-h-20 w-full rounded-lg border border-input/40 bg-background px-3 py-2 text-base transition-colors placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
      className,
    )} ref={ref} {...props} />,
);
Textarea.displayName = "Textarea";

export function WorkflowYamlEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useT();
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <Textarea className="min-h-0 flex-1 resize-none font-mono text-xs"
      aria-label={t("agents.automation.yaml")} value={value}
      onChange={(event) => onChange(event.target.value)} />
    <p className="text-xs text-muted-foreground">{t("agents.automation.yamlHelp")}</p>
  </div>;
}
