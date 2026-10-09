// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/workflows/ui/WorkflowFormBuilder.tsx::WorkflowNode/WorkflowFormBuilder.
// Original sequence and inspector; the parent retains the governed draft and publishing authority.
import { ArrowDown, CalendarClock, Check, ChevronDown, MessageSquare, Plus, Trash2, X } from "lucide-react";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { forwardRef, type ReactNode, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { ActionEnum, AutomationTriggerKind, type AutomationStep, type AutomationVersionContent } from "@client-kit/contracts";
import { useT, type Translate } from "./context";
import { ActionEmoji } from "./workflow-card-actions";
import { formatDurationSecondsVerbose, parseDurationSeconds } from "./workflow-duration";
import { Button } from "./profile/buzz/shared/ui/button";
import { cn } from "./profile/buzz/shared/lib/cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./sidebar/dropdown-menu";
import { nextStepId, WorkflowStepCard } from "./workflow-steps";

type Pane = { type: "trigger" } | { type: "step"; stepId: string } | null;
type DraftAction = ActionEnum.Delay | ActionEnum.RequestApproval | ActionEnum.SendMessage | ActionEnum.AddReaction | ActionEnum.SetChannelTopic;
const actionKeys = {
  [ActionEnum.Delay]: "workflows.steps.delay",
  [ActionEnum.RequestApproval]: "workflows.steps.requestApproval",
  [ActionEnum.SendMessage]: "buzz.sendMessage",
  [ActionEnum.AddReaction]: "workflows.steps.addReaction",
  [ActionEnum.SetChannelTopic]: "workflows.steps.setTopic",
} as const;
const inspectorContentVariants = {
  enter: (direction: number) => ({ opacity: 0, y: direction < 0 ? 12 : -12 }),
  center: { opacity: 1, y: 0 },
  exit: (direction: number) => ({ opacity: 0, y: direction < 0 ? -12 : 12 }),
};

// Original desktop/src/features/workflows/ui/workflowStepDescription.ts::workflowStepDescription.
// Only existing admitted actions have a consumer; channel/approver identities are not invented.
const MAX_DETAIL_LENGTH = 42;
function workflowStepDescription(step: AutomationStep, actionLabel: string, t: Translate): string {
  const compact = (value: string) => {
    const normalized = value.trim().replaceAll(/\s+/g, " ");
    return normalized.length > MAX_DETAIL_LENGTH ? `${normalized.slice(0, MAX_DETAIL_LENGTH - 3)}...` : normalized;
  };
  const quoted = (value: string | undefined) => value?.trim() ? `“${compact(value)}”` : null;
  let detail: string | null = null;
  switch (step.action) {
    case ActionEnum.Delay: {
      const duration = step.duration?.trim();
      if (duration) {
        const seconds = parseDurationSeconds(duration);
        detail = compact(seconds === null ? duration : formatDurationSecondsVerbose(seconds, t));
      }
      break;
    }
    case ActionEnum.SendMessage: detail = quoted(step.text); break;
    case ActionEnum.RequestApproval: detail = quoted(step.message); break;
    case ActionEnum.AddReaction: detail = step.emoji?.trim() || null; break;
    case ActionEnum.SetChannelTopic: detail = quoted(step.topic); break;
  }
  const name = step.name?.trim();
  return name && detail ? `${name} · ${detail}` : name || detail || actionLabel;
}

function WorkflowNode({ description, label, disabled, icon, title, number, showTitle = true, subtitle, selected, terminal, onSelect, onRemove, actions, onAddAfter }: {
  description: string; label: string; disabled?: boolean; icon?: ReactNode; title: string; number?: number;
  showTitle?: boolean; subtitle?: string;
  selected: boolean; terminal: boolean; onSelect: () => void; onRemove?: () => void;
  actions: DraftAction[]; onAddAfter: (action: DraftAction) => void;
}) {
  const t = useT();
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  return <li className="flex flex-col items-center">
    <div className="group relative isolate w-full after:absolute after:left-full after:top-0 after:z-0 after:h-full after:w-12 after:content-['']">
      <button aria-label={label} aria-pressed={selected}
        className={cn("relative z-20 flex w-full items-center gap-3 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "rounded-full bg-muted/25 p-3 outline outline-2 outline-offset-4 outline-muted-foreground/0",
          "data-[selected=true]:bg-muted/70 data-[selected=true]:outline-muted-foreground/20",
          "data-[selected=false]:hover:bg-muted/45")}
        data-selected={selected} disabled={disabled} onClick={onSelect} type="button">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center", "rounded-full bg-muted/60 text-muted-foreground",
          "data-[selected=true]:bg-foreground/15 data-[selected=true]:text-foreground", number !== undefined && "text-sm font-semibold")}
          data-selected={selected} data-testid="workflow-node-icon">{number ?? icon}</span>
        <span className="min-w-0 flex-1">
          {showTitle ? <span className="block text-2xs font-semibold uppercase tracking-wide text-muted-foreground/70">{title}</span> : null}
          {subtitle ? <span className="block truncate text-2xs font-semibold uppercase tracking-wide text-muted-foreground/70">{subtitle}</span> : null}
          <span className="block truncate text-sm font-semibold text-foreground">{description}</span>
        </span>
      </button>
      {onRemove ? <Button aria-label={t("workflows.steps.remove")}
        className="pointer-events-none absolute -right-8 top-1/2 z-10 h-8 w-8 -translate-y-1/2 rounded-full bg-transparent opacity-0 transition-all duration-200 group-focus-within:pointer-events-auto group-focus-within:translate-x-3 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:translate-x-3 group-hover:opacity-100 hover:bg-destructive/15 hover:text-destructive"
        disabled={disabled} onClick={onRemove} size="icon" type="button" variant="ghost"><Trash2 className="h-4 w-4" /></Button> : null}
    </div>
    <div className="group relative flex h-18 items-center justify-center" data-menu-open={addMenuOpen} data-terminal={terminal} data-testid="workflow-node-ingress">
      {!terminal ? <ArrowDown aria-hidden="true" className="h-5 w-5 text-muted-foreground transition-opacity duration-200 ease-out group-hover:opacity-10 group-data-[menu-open=true]:opacity-10 group-has-[:focus-visible]:opacity-10 motion-reduce:transition-none" /> : null}
      <DropdownMenu onOpenChange={setAddMenuOpen}><DropdownMenuTrigger asChild>
        <Button aria-label={number === undefined ? t("workflows.addStep") : t("workflows.addAfter", {step: title})}
          className={cn("relative z-10 h-7 w-7 rounded-full bg-background shadow-sm", !terminal &&
            "pointer-events-none absolute scale-125 opacity-0 transition-[opacity,transform,background-color,color,border-color,box-shadow] duration-200 ease-out group-hover:pointer-events-auto group-hover:scale-100 group-hover:opacity-100 group-data-[menu-open=true]:pointer-events-auto group-data-[menu-open=true]:scale-100 group-data-[menu-open=true]:opacity-100 focus-visible:pointer-events-auto focus-visible:scale-100 focus-visible:opacity-100 motion-reduce:transition-none")}
          disabled={disabled || actions.length === 0} size="icon" type="button" variant="outline"><Plus className="h-3.5 w-3.5" /></Button>
      </DropdownMenuTrigger><DropdownMenuContent align="center" side="right" sideOffset={8}>
        {actions.map(action => <DropdownMenuItem key={action} onSelect={() => onAddAfter(action)}><span>{t(actionKeys[action])}</span></DropdownMenuItem>)}
      </DropdownMenuContent></DropdownMenu>
    </div>
  </li>;
}

// Original WorkflowFormBuilderHandle consumers: the dialog owns Escape and
// its primary empty-sequence action; this is not another draft authority.
export type WorkflowFormCanvasHandle = {
  addFirstStep: () => void;
  closeInspector: () => boolean;
};

export const WorkflowFormCanvas = forwardRef<WorkflowFormCanvasHandle, {
  steps: AutomationStep[]; onStepsChange: (steps: AutomationStep[]) => void;
  trigger: AutomationTriggerKind; triggerFields: ReactNode;
  policies: NonNullable<AutomationVersionContent["approvalPolicy"]>[] | null; disabled?: boolean;
}>(function WorkflowFormCanvas({ steps, onStepsChange, trigger, triggerFields, policies, disabled }, ref) {
  const t = useT();
  const [pane, setPane] = useState<Pane>(null);
  const [selectionDirection, setSelectionDirection] = useState<1 | -1>(1);
  const [narrowInspector, setNarrowInspector] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const selectedIndex = pane?.type === "step" ? steps.findIndex(step => step.id === pane.stepId) : -1;
  const selectedStep = selectedIndex < 0 ? undefined : steps[selectedIndex];
  const selectedNode = pane?.type === "trigger" || selectedStep ? pane : null;
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const update = () => setNarrowInspector(container.clientWidth <= 58 * 16);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const selectNode = (next: Exclude<Pane, null>) => {
    const position = next.type === "trigger" ? -1 : steps.findIndex(step => step.id === next.stepId);
    if (selectedNode) setSelectionDirection(position < selectedIndex ? -1 : 1);
    setPane(next);
  };
  const removeStep = (index: number) => {
    if (disabled) return;
    onStepsChange(steps.filter((_, position) => position !== index));
    if (selectedIndex !== index) return;
    setSelectionDirection(-1);
    const fallback = index > 0 ? steps[index - 1] : steps[index + 1];
    setPane(fallback ? {type: "step", stepId: fallback.id} : {type: "trigger"});
  };
  // Editing does not expand the runtime's current format 2/3 action support.
  // Incomplete drafts stay editable; publication still uses supportedSteps + fresh admission.
  const actionsAt = (index: number): DraftAction[] => {
    const messageSequence = !steps.some(step => step.action === ActionEnum.AddReaction || step.action === ActionEnum.SetChannelTopic);
    const actions: DraftAction[] = [ActionEnum.Delay];
    if (policies?.length && !steps.some(step => step.action === ActionEnum.RequestApproval)
      && steps.slice(0, index).every(step => step.action === ActionEnum.Delay)) actions.push(ActionEnum.RequestApproval);
    if (messageSequence && !steps.slice(index).some(step => step.action === ActionEnum.RequestApproval)) actions.push(ActionEnum.SendMessage);
    if (index === steps.length && steps.every(step => step.action === ActionEnum.Delay || step.action === ActionEnum.RequestApproval)) {
      if (trigger !== AutomationTriggerKind.Schedule) actions.push(ActionEnum.AddReaction);
      actions.push(ActionEnum.SetChannelTopic);
    }
    return actions;
  };
  const insertStep = (index: number, action: DraftAction) => {
    if (disabled || !actionsAt(index).includes(action)) return;
    const step: AutomationStep = { id: nextStepId(steps), action,
      ...(action === ActionEnum.SendMessage ? {text: ""} : action === ActionEnum.Delay ? {duration: ""}
        : action === ActionEnum.RequestApproval ? {message: ""} : action === ActionEnum.AddReaction ? {emoji: ""} : {topic: ""}) };
    const next = [...steps]; next.splice(index, 0, step);
    onStepsChange(next); selectNode({type: "step", stepId: step.id});
  };
  useImperativeHandle(ref, () => ({
    addFirstStep: () => insertStep(0, ActionEnum.SendMessage),
    closeInspector: () => {
      if (!selectedNode) return false;
      setPane(null);
      return true;
    },
  }));
  const triggerLabel = t(trigger === AutomationTriggerKind.Schedule ? "agents.automation.schedule"
    : trigger === AutomationTriggerKind.Mention ? "agents.installation.trigger.mention" : "agents.automation.channelMessage");
  const actionLabel = (step: AutomationStep) => t(actionKeys[step.action as DraftAction]);
  const updateStep = (next: AutomationStep) => {
    if (disabled || !selectedStep) return;
    onStepsChange(steps.map((step, index) => index === selectedIndex ? next : step));
    if (next.id !== selectedStep.id) setPane({type: "step", stepId: next.id});
  };
  // The existing runtime admits delays before an effect, or a terminal effect.
  // Switching the original action selector must not silently keep unrelated fields.
  const replacementActions: DraftAction[] = [];
  if (selectedStep) {
    const before = steps.slice(0, selectedIndex);
    const after = steps.slice(selectedIndex + 1);
    replacementActions.push(ActionEnum.Delay);
    if (policies?.length && before.every(step => step.action === ActionEnum.Delay)
      && !after.some(step => step.action === ActionEnum.RequestApproval)) replacementActions.push(ActionEnum.RequestApproval);
    if (![...before, ...after].some(step => step.action === ActionEnum.AddReaction || step.action === ActionEnum.SetChannelTopic)
      && !after.some(step => step.action === ActionEnum.RequestApproval)) replacementActions.push(ActionEnum.SendMessage);
    if (!after.length && before.every(step => step.action === ActionEnum.Delay || step.action === ActionEnum.RequestApproval)) {
      if (trigger !== AutomationTriggerKind.Schedule) replacementActions.push(ActionEnum.AddReaction);
      replacementActions.push(ActionEnum.SetChannelTopic);
    }
  }
  return <div className="flex h-full min-h-0 flex-col [container-type:inline-size]" ref={containerRef}>
    <div className="flex min-h-0 flex-1 flex-col"><div className="relative isolate flex min-h-0 flex-1">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-5"><div className="mx-auto w-full max-w-sm">
        <ol aria-label={t("workflows.sequence")}>
          <WorkflowNode title={t("agents.automation.trigger")} description={triggerLabel} label={`${t("agents.automation.trigger")}: ${triggerLabel}`} disabled={disabled}
            icon={trigger === AutomationTriggerKind.Schedule ? <CalendarClock className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
            selected={selectedNode?.type === "trigger"} terminal={steps.length === 0} onSelect={() => selectNode({type: "trigger"})}
            actions={actionsAt(0)} onAddAfter={action => insertStep(0, action)} />
          {steps.map((step, index) => {
            const label = actionLabel(step);
            const description = workflowStepDescription(step, label, t);
            const emoji = step.action === ActionEnum.AddReaction ? step.emoji?.trim() : undefined;
            const title = t("workflows.steps.number", {number: index + 1});
            return <WorkflowNode key={step.id} title={title} label={`${title}: ${description}`}
            number={emoji ? undefined : index + 1} icon={emoji ? <ActionEmoji value={emoji} /> : undefined}
            description={emoji ? label : description} showTitle={false}
            subtitle={!emoji && description !== label ? label : undefined} disabled={disabled}
            selected={selectedNode?.type === "step" && selectedNode.stepId === step.id} terminal={index === steps.length - 1}
            onSelect={() => selectNode({type: "step", stepId: step.id})} onRemove={() => removeStep(index)}
            actions={actionsAt(index + 1)} onAddAfter={action => insertStep(index + 1, action)} />;
          })}
        </ol>
      </div></div>
      <AnimatePresence>
        {selectedNode ? <motion.button animate={{opacity: 1}} aria-label={t("workflows.closeInspectorOverlay")}
          className="absolute inset-0 z-20 hidden bg-background/15 backdrop-blur-sm [@container(max-width:58rem)]:block"
          data-testid="workflow-node-inspector-backdrop" exit={{opacity: 0}} initial={{opacity: 0}} key="workflow-node-inspector-backdrop"
          onClick={() => setPane(null)} transition={shouldReduceMotion ? {duration: 0} : {duration: 0.18, ease: "easeOut"}} type="button" /> : null}
        {selectedNode ? <FocusScope asChild loop={narrowInspector} trapped={narrowInspector}>
          <motion.aside animate={{opacity: 1, width: "26rem", x: 0}} aria-label={narrowInspector ? t("workflows.nodeInspector") : undefined}
            aria-modal={narrowInspector || undefined}
            className="flex flex-shrink-0 p-4 [@container(max-width:58rem)]:absolute [@container(max-width:58rem)]:inset-y-0 [@container(max-width:58rem)]:right-0 [@container(max-width:58rem)]:z-30 [@container(max-width:58rem)]:max-w-full"
            data-testid="workflow-node-inspector" exit={{opacity: 0, width: 0, x: 24}} initial={{opacity: 0, width: 0, x: 24}} key="workflow-node-inspector"
            onKeyDown={event => { if (event.key === "Escape" && narrowInspector) {event.preventDefault(); event.stopPropagation(); setPane(null);} }}
            role={narrowInspector ? "dialog" : "complementary"}
            transition={shouldReduceMotion ? {duration: 0} : {duration: 0.24, ease: [0.22, 1, 0.36, 1]}}>
            <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-muted/40 [@container(max-width:58rem)]:bg-background [@container(max-width:58rem)]:shadow-2xl">
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 hidden bg-muted/40 [@container(max-width:58rem)]:block" />
              <div className="relative z-10 flex w-96 min-w-96 flex-shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-5 [@container(max-width:26rem)]:w-full [@container(max-width:26rem)]:min-w-0">
                <div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {selectedNode.type === "trigger" ? t("agents.automation.trigger") : t("workflows.steps.number", {number: selectedIndex + 1})}</p>
                  {selectedStep ? <DropdownMenu><DropdownMenuTrigger asChild>
                    <button aria-label={t("agents.automation.action")} disabled={disabled} type="button" data-value={selectedStep.action}
                      className="group inline-flex max-w-full items-center gap-1.5 rounded-md py-0.5 text-base font-semibold text-foreground outline-hidden focus-visible:ring-1 focus-visible:ring-ring">
                      <span className="truncate">{actionLabel(selectedStep)}</span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" />
                    </button>
                  </DropdownMenuTrigger><DropdownMenuContent align="start" sideOffset={8}>
                    {replacementActions.map(action => <DropdownMenuItem key={action} onSelect={() => {
                      if (action === selectedStep.action) return;
                      updateStep({id: selectedStep.id, ...(selectedStep.name ? {name: selectedStep.name} : {}), action,
                        ...(action === ActionEnum.SendMessage ? {text: ""} : action === ActionEnum.Delay ? {duration: ""}
                          : action === ActionEnum.AddReaction ? {emoji: ""} : action === ActionEnum.SetChannelTopic ? {topic: ""} : {message: ""})});
                    }}><Check className={cn("h-4 w-4", selectedStep.action === action ? "opacity-100" : "opacity-0")} />{t(actionKeys[action])}</DropdownMenuItem>)}
                  </DropdownMenuContent></DropdownMenu> : null}
                </div><div className="flex items-center gap-1">
                  {selectedStep ? <Button aria-label={t("workflows.steps.remove")} className="h-8 w-8" disabled={disabled}
                    onClick={() => removeStep(selectedIndex)} size="icon" type="button" variant="ghost"><Trash2 className="h-4 w-4 text-muted-foreground" /></Button> : null}
                  <Button aria-label={t("workflows.closeInspector")} className="h-8 w-8" onClick={() => setPane(null)} size="icon" type="button" variant="ghost"><X className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="relative z-10 min-h-0 w-96 min-w-96 flex-1 overflow-y-auto px-5 pb-5 pt-2 [@container(max-width:26rem)]:w-full [@container(max-width:26rem)]:min-w-0">
                <AnimatePresence custom={selectionDirection} initial={false} mode="wait"><motion.div animate="center" className="h-full min-h-0"
                  custom={selectionDirection} exit="exit" initial="enter" key={selectedNode.type === "trigger" ? "trigger" : `step-${selectedNode.stepId}`}
                  transition={shouldReduceMotion ? {duration: 0} : {duration: 0.15, ease: "easeOut"}} variants={inspectorContentVariants}>
                  {selectedNode.type === "trigger" ? <div className="h-full min-h-0">{triggerFields}</div> : selectedStep ?
                    <WorkflowStepCard bare showHeader={false} disabled={disabled} step={selectedStep} index={selectedIndex} policies={policies} trigger={trigger}
                      previousSteps={steps.slice(0, selectedIndex)} onUpdate={updateStep} /> : null}
                </motion.div></AnimatePresence>
              </div>
            </div>
          </motion.aside>
        </FocusScope> : null}
      </AnimatePresence>
    </div></div>
  </div>;
});
