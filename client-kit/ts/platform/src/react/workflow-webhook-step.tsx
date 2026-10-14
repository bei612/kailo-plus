// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/workflows/ui/WorkflowStepCard.tsx (case "call_webhook"),
// desktop/src/features/workflows/ui/WorkflowWebhookHeadersEditor.tsx::WorkflowWebhookHeadersEditor,
// desktop/src/features/workflows/ui/workflowFormTypes.ts::toHeaderRows/headersToRecord.
// Kailo keeps credential headers out of versions: they are SecretRefs (secretHeaders),
// authored in YAML, preserved here unchanged and only named.
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import type * as React from "react";
import type { AutomationStep } from "@client-kit/contracts";
import { Button } from "./profile/buzz/shared/ui/button";
import { Input } from "./composer/shared/ui/input";
import { Textarea } from "./profile/buzz/shared/ui/textarea";
import { useT } from "./context";

/** Original StepFormState.headers row; authoring state, not a wire field. */
export type WorkflowHeaderRow = { id: string; key: string; value: string };

export const WEBHOOK_METHODS = ["POST", "GET", "PUT", "PATCH", "DELETE"] as const;

// Original workflowFormTypes.ts::toHeaderRows.
export function toHeaderRows(headers: AutomationStep["headers"], stepId: string): WorkflowHeaderRow[] {
  return Object.entries(headers ?? {}).map(([key, value], index) => ({
    id: `${stepId}_header_${index + 1}`, key, value: typeof value === "string" ? value : String(value),
  }));
}

// Original workflowFormTypes.ts::headersToRecord: blank names are dropped.
export function headersToRecord(rows: WorkflowHeaderRow[]): Record<string, string> | undefined {
  const entries = rows.map(({ key, value }) => [key.trim(), value] as const).filter(([key]) => key.length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

// Original workflowFormPrimitives.tsx::FieldLabel/FormSelect.
function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return <label className="block text-xs font-medium text-muted-foreground" htmlFor={htmlFor}>{children}</label>;
}

function FormSelect({ children, disabled, id, onChange, value }: {
  children: React.ReactNode; disabled?: boolean; id?: string; onChange: (value: string) => void; value: string;
}) {
  return <div className="relative">
    <select className="flex h-9 w-full appearance-none rounded-md border border-input bg-transparent px-3 pr-8 text-sm shadow-xs transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled} id={id} onChange={(event) => onChange(event.target.value)} value={value}>
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
  </div>;
}

export function WorkflowWebhookHeadersEditor({ disabled, headers, onChange, stepId }: {
  disabled?: boolean; headers: WorkflowHeaderRow[]; onChange: (headers: WorkflowHeaderRow[]) => void; stepId: string;
}) {
  const t = useT();
  return <div className="space-y-2">
    <div className="flex items-center justify-between">
      <FieldLabel>{t("workflows.steps.headersOptional")}</FieldLabel>
      <Button className="h-7 gap-1 text-xs" disabled={disabled} size="sm" type="button" variant="outline"
        onClick={() => onChange([...headers, { id: `${stepId}_header_${headers.length + 1}`, key: "", value: "" }])}>
        <Plus className="h-4 w-4" />
        {t("workflows.steps.addHeader")}
      </Button>
    </div>
    {headers.length === 0 ? <p className="text-xs text-muted-foreground">{t("workflows.steps.noCustomHeaders")}</p>
      : <div className="space-y-2">
        {headers.map((header, index) => <div className="flex items-center gap-2" key={header.id}>
          <Input autoCapitalize="off" disabled={disabled} placeholder={t("workflows.steps.headerName")} value={header.key}
            onChange={(event) => onChange(headers.map((current, currentIndex) =>
              currentIndex === index ? { ...current, key: event.target.value } : current))} />
          <Input autoCapitalize="off" disabled={disabled} placeholder={t("workflows.steps.headerValue")} value={header.value}
            onChange={(event) => onChange(headers.map((current, currentIndex) =>
              currentIndex === index ? { ...current, value: event.target.value } : current))} />
          <Button aria-label={t("workflows.steps.removeHeader")} className="h-9 w-9 shrink-0" disabled={disabled}
            size="icon" type="button" variant="ghost"
            onClick={() => onChange(headers.filter((_, currentIndex) => currentIndex !== index))}>
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>)}
      </div>}
  </div>;
}

export function WorkflowWebhookStepFields<Step extends AutomationStep & { headerRows?: WorkflowHeaderRow[] }>({
  disabled, onUpdate, prefix, step,
}: { disabled?: boolean; onUpdate: (step: Step) => void; prefix: string; step: Step }) {
  const t = useT();
  const headerRows = step.headerRows ?? toHeaderRows(step.headers, step.id || prefix);
  const secretNames = Object.keys(step.secretHeaders ?? {});
  return <div className="space-y-4">
    <div className="space-y-1.5">
      <FieldLabel htmlFor={`${prefix}-url`}>{t("workflows.steps.endpointUrl")}</FieldLabel>
      <Input autoCapitalize="off" disabled={disabled} id={`${prefix}-url`} placeholder="https://..." value={step.url ?? ""}
        onChange={(event) => onUpdate({ ...step, url: event.target.value })} />
      {step.url && !step.url.startsWith("https://")
        ? <p className="text-xs text-destructive">{t("workflows.steps.urlMustBeHttps")}</p> : null}
    </div>
    <div className="space-y-1.5">
      <FieldLabel htmlFor={`${prefix}-method`}>{t("workflows.steps.httpMethod")}</FieldLabel>
      <FormSelect disabled={disabled} id={`${prefix}-method`} value={step.method ?? "POST"}
        onChange={(value) => onUpdate({ ...step, method: value as AutomationStep["method"] })}>
        {WEBHOOK_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
      </FormSelect>
    </div>
    <WorkflowWebhookHeadersEditor disabled={disabled} headers={headerRows} stepId={step.id || prefix}
      onChange={(rows) => onUpdate({ ...step, headerRows: rows })} />
    {secretNames.length ? <p className="text-xs text-muted-foreground">
      {t("workflows.steps.secretHeaders", { names: secretNames.join(", ") })}</p> : null}
    <div className="space-y-1.5">
      <FieldLabel htmlFor={`${prefix}-body`}>{t("workflows.steps.requestBodyOptional")}</FieldLabel>
      <Textarea autoCapitalize="off" className="min-h-[60px] resize-y font-mono text-xs" disabled={disabled}
        id={`${prefix}-body`} placeholder='{"key": "{{trigger.text}}"}' value={step.body ?? ""}
        onChange={(event) => onUpdate({ ...step, body: event.target.value })} />
    </div>
  </div>;
}
