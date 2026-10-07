// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/agents/ui/AgentDefinitionDialog.tsx::AgentDefinitionDialog
// and PersonaAdvancedFields.tsx::PersonaAdvancedFields. Only the admitted
// version fields are supplied by the caller; runtime credentials stay outside UI.
import { type ReactNode, useState } from "react";
import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Input } from "../composer/shared/ui/input";
import { ADVANCED_FIELDS_MOTION_TRANSITION, PERSONA_FIELD_CONTROL_CLASS, PERSONA_FIELD_SHELL_CLASS } from "./agentConfigOptions";

export function AgentDefinitionAdvanced({ children, required = false }: {
  children: ReactNode;
  required?: boolean;
}) {
  const t = useT();
  const [showAdvancedFields, setShowAdvancedFields] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const advancedFieldsTransition = shouldReduceMotion ? { duration: 0 } : ADVANCED_FIELDS_MOTION_TRANSITION;
  return <div className="space-y-3">
    <button aria-expanded={showAdvancedFields}
      className="inline-flex h-9 items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-foreground/80 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => setShowAdvancedFields((current) => !current)} type="button">
      <span>{t("agents.version.advanced")}</span>
      {required ? <span aria-hidden="true" className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive"
        data-testid="persona-advanced-required-badge">{t("agents.version.required")}</span> : null}
      <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-150 ease-out", showAdvancedFields && "rotate-180")} />
    </button>
    <AnimatePresence initial={false}>
      {showAdvancedFields ? <motion.div animate={{ height: "auto", opacity: 1, scale: 1 }}
        className="origin-top overflow-hidden" exit={{ height: 0, opacity: 0, scale: 0.98 }}
        initial={{ height: 0, opacity: 0, scale: 0.98 }} key="persona-advanced-fields" transition={advancedFieldsTransition}>
        <div className="space-y-5 pt-2">{children}</div>
      </motion.div> : null}
    </AnimatePresence>
  </div>;
}

export function AgentParallelismField({ id, value, max, onChange }: {
  id: string; value: string; max?: number; onChange: (value: string) => void;
}) {
  const t = useT();
  return <div className="space-y-1.5">
    <label className="text-sm font-medium text-foreground" htmlFor={id}>{t("agents.version.parallelism")}</label>
    <div className={cn("flex min-h-11 items-center px-3", PERSONA_FIELD_SHELL_CLASS)}>
      <Input className={cn("h-8 px-0 py-0 leading-6 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none", PERSONA_FIELD_CONTROL_CLASS)}
        id={id} inputMode="numeric" max={max} min={1} step={1} required
        onChange={(event) => onChange(event.target.value)} type="number" value={value} />
    </div>
  </div>;
}
