// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/workflows/ui/WorkflowCard.tsx::ActionTile/ActionTileStack/StatusToggle
// desktop/src/features/workflows/ui/workflowDefinition.ts::getWorkflowActionTiles.
// Only admitted contract actions are mapped.
import { ActionKind, type AutomationVersionContent } from "@client-kit/contracts";
import { CircleCheckBig, Hash, MessageSquare, SmilePlus, Timer, Zap, type LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "./profile/buzz/shared/lib/cn";
import { Switch } from "./switch";
import { useBffClient, useT } from "./context";
import { useBffCustomEmojiPalette } from "./custom-emoji/palette";
import { reactionEmojiUrl } from "./custom-emoji/emoji";

const ACTION_ICONS: Record<string, LucideIcon> = {
  add_reaction: SmilePlus, delay: Timer, request_approval: CircleCheckBig,
  send_message: MessageSquare, set_channel_topic: Hash,
};
const ACTION_ACCENTS: Record<string, string> = {
  add_reaction: "border-pink-400/30 bg-pink-600 text-white",
  delay: "border-sky-300/30 bg-sky-500 text-white",
  request_approval: "border-emerald-300/30 bg-emerald-600 text-white",
  send_message: "border-blue-300/30 bg-blue-600 text-white",
  set_channel_topic: "border-violet-300/30 bg-violet-600 text-white",
};

export function WorkflowStatusToggle({ disabled, enabled, onToggle }: {
  disabled: boolean; enabled: boolean; onToggle: () => void;
}) {
  const t = useT();
  return <Switch aria-label={t(enabled ? "workflows.disableWorkflow" : "workflows.enableWorkflow")}
    checked={enabled} disabled={disabled}
    onCheckedChange={(checked) => { if (checked !== enabled) onToggle(); }} />;
}

// Original StatusEmoji rendering, resolved only through the existing admitted media reader.
function ActionEmoji({ value }: { value: string }) {
  const palette = useBffCustomEmojiPalette(useBffClient());
  const image = reactionEmojiUrl(value, palette);
  return image ? <img alt="" src={image} draggable={false}
    className="inline-block object-contain align-middle h-6 w-6 text-xl" />
    : <span className="inline-flex items-center justify-center leading-normal align-middle h-6 w-6 text-xl">{value}</span>;
}

function ActionTile({ action, emoji, animationSequence, index, className }: {
  action: string; emoji: string | null; animationSequence: number; index: number; className: string;
}) {
  const ActionIcon = ACTION_ICONS[action] ?? Zap;
  const reduceMotion = useReducedMotion();
  return <span aria-hidden="true" className={cn(
    "absolute inset-y-0 flex w-9 items-center justify-center rounded-xl border shadow-xs",
    ACTION_ACCENTS[action] ?? "border-border/65 bg-background/80 text-muted-foreground", className)}>
    <motion.span animate={animationSequence > 0 && !reduceMotion
      ? { scale: [1, 1.18, 0.94, 1], y: [0, -5, 1, 0] } : undefined}
      className="flex items-center justify-center" transition={{ delay: index * 0.11, duration: 0.48, ease: "easeOut" }}>
      {emoji ? <ActionEmoji value={emoji} /> : <ActionIcon className="h-5 w-5" />}
    </motion.span>
  </span>;
}

export function WorkflowActionTileStack({ content, animationSequence }: {
  content: AutomationVersionContent; animationSequence: number;
}) {
  const actions = content.formatVersion === 2 || content.formatVersion === 3
    ? (content.steps ?? []).map((step) => ({ action: step.action,
      emoji: step.action === "add_reaction" ? step.emoji ?? null : null, key: step.id }))
    : [{ action: content.action?.kind === ActionKind.PostMessage ? "send_message" : "agent_turn", emoji: null, key: "action" }];
  const visibleActions = actions.slice(0, 3);
  return <span className={cn("relative h-9", visibleActions.length === 1 && "w-9",
    visibleActions.length === 2 && "w-[2.625rem]", visibleActions.length > 2 && "w-12")}
    data-testid="workflow-card-action-stack">
    {visibleActions.map((action, index) => <ActionTile action={action.action}
      animationSequence={animationSequence} className={cn(index === 0 && "left-0 z-10",
        index === 1 && "left-1.5 z-[5] scale-90 opacity-60", index === 2 && "left-3 scale-75 opacity-35")}
      emoji={action.emoji} index={index} key={`${action.key}-${animationSequence}`} />).reverse()}
  </span>;
}
