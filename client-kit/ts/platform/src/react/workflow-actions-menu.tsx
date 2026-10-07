// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/workflows/ui/WorkflowActionsMenu.tsx::WorkflowActionsMenu.
import { Copy, MoreHorizontal, Pencil, Play, Power, PowerOff, Trash2 } from "lucide-react";
import { Button } from "./profile/buzz/shared/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger } from "./sidebar/dropdown-menu";
import { useT } from "./context";

type WorkflowActionsMenuProps = {
  isEnabled: boolean;
  disabled?: boolean;
  showEnabledToggle?: boolean;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onEdit?: () => void;
  onToggleEnabled?: () => void;
  onTrigger?: () => void;
};

export function WorkflowActionsMenu({ isEnabled, disabled = false, onDelete,
  onDuplicate, onEdit, onToggleEnabled, onTrigger, showEnabledToggle = true }: WorkflowActionsMenuProps) {
  const t = useT();
  if (!onDelete && !onDuplicate && !onEdit && !onToggleEnabled && !onTrigger) return null;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button aria-label={t("workflows.actions")} disabled={disabled}
        className="h-8 w-8 text-muted-foreground hover:bg-background/80 hover:text-foreground data-[state=open]:bg-background/80 data-[state=open]:text-foreground"
        size="icon" type="button" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {onTrigger ? <DropdownMenuItem disabled={disabled} onClick={onTrigger}>
        <Play className="mr-2 h-4 w-4" />{t("agents.automation.run")}</DropdownMenuItem> : null}
      {onEdit ? <DropdownMenuItem disabled={disabled} onClick={onEdit}>
        <Pencil className="mr-2 h-4 w-4" />{t("workflows.edit")}</DropdownMenuItem> : null}
      {onDuplicate ? <DropdownMenuItem disabled={disabled} onClick={onDuplicate}>
        <Copy className="mr-2 h-4 w-4" />{t("agents.automation.copy")}</DropdownMenuItem> : null}
      {showEnabledToggle && onToggleEnabled ? <DropdownMenuCheckboxItem checked={isEnabled}
        className="gap-2 pl-2 [&>span:first-child]:hidden" disabled={disabled}
        onCheckedChange={(checked) => { if (checked !== isEnabled) onToggleEnabled(); }}
        onSelect={(event) => event.preventDefault()}>
        {isEnabled ? <Power className="mr-2 h-4 w-4 shrink-0" /> : <PowerOff className="mr-2 h-4 w-4 shrink-0" />}
        <span>{t("agents.automation.enable")}</span>
        <span aria-hidden="true" className={"ml-auto inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors "
          + (isEnabled ? "bg-primary" : "bg-input")} data-testid="workflow-enabled-switch-visual">
          <span className={"block h-4 w-4 rounded-full bg-background transition-transform "
            + (isEnabled ? "translate-x-4" : "translate-x-0")} />
        </span>
      </DropdownMenuCheckboxItem> : null}
      {onDelete ? <><DropdownMenuSeparator /><DropdownMenuItem disabled={disabled} className="text-destructive" onClick={onDelete}>
        <Trash2 className="mr-2 h-4 w-4" />{t("agents.automation.delete")}</DropdownMenuItem></> : null}
    </DropdownMenuContent>
  </DropdownMenu>;
}
