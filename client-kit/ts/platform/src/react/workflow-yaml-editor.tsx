// Reused from Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/shared/ui/textarea.tsx::Textarea and
// desktop/src/features/workflows/ui/WorkflowFormBuilder.tsx::WorkflowFormBuilder.
// Both platform hosts consume this original controlled textarea, not a second editor.
import { useT } from "./context";
import { Textarea } from "./profile/buzz/shared/ui/textarea";

export function WorkflowYamlEditor({ value, onChange, disabled }: {
  value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const t = useT();
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-6 pb-3 pt-3">
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <Textarea className="min-h-0 flex-1 resize-none font-mono text-xs"
        autoCapitalize="off" disabled={disabled}
        aria-label={t("agents.automation.yaml")} value={value}
        onChange={(event) => onChange(event.target.value)} />
      <p className="flex-shrink-0 text-xs text-muted-foreground">{t("workflows.yamlDirect")}</p>
    </div>
  </div>;
}
