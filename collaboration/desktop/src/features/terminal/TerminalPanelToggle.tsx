// DD-161: the original Buzz Term toggle (channel header SquareTerminal button and
// ProjectRightPanelControls' TerminalPanelIcon), localized and on Kailo components.
import { SquareTerminal } from "lucide-react";
import { useUiT } from "@client-kit/platform/react/context";
import { Button } from "@/shared/ui/button";
import { TerminalPanelIcon } from "@/shared/ui/TerminalPanelIcon";
import { cn } from "@/shared/lib/cn";
import { toggleTerminalPanel, useTerminalPanel } from "./terminalPanelStore";

export function TerminalPanelToggle({ variant = "header" }: { variant?: "header" | "panel" }) {
  const t = useUiT();
  const panel = useTerminalPanel();
  const open = panel.mode !== "closed";
  const label = t(open ? "terminal.hide" : "terminal.open");
  if (variant === "panel") {
    return (
      <Button
        aria-label={label}
        aria-pressed={open}
        className={cn(
          "h-7 w-7 text-sidebar-foreground hover:bg-sidebar-accent",
          open && "bg-sidebar-accent text-sidebar-accent-foreground",
        )}
        data-testid="project-terminal-toggle"
        onClick={toggleTerminalPanel}
        size="icon"
        title={`${t("terminal.title")} (⌘J)`}
        type="button"
        variant="ghost"
      >
        <TerminalPanelIcon className="w-[1.1rem]" data-testid="project-terminal-icon" open={open} />
      </Button>
    );
  }
  return (
    <Button
      aria-label={label}
      data-testid="channel-terminal-toggle"
      onClick={toggleTerminalPanel}
      size="icon"
      title={`${t("terminal.title")} (⌘J)`}
      type="button"
      variant={open ? "secondary" : "outline"}
    >
      <SquareTerminal />
    </Button>
  );
}
