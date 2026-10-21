// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/PersonaActionsMenu.tsx.
// Only the original "Share" entry is restored here (DD-131(6)(7)); editing, versions and lifecycle
// stay in the governed Definition detail the card already opens, and no governed Definition delete
// or duplicate exists.
import { EllipsisVertical, Share2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../sidebar/dropdown-menu";
import { useUiT } from "../context";

export function PersonaActionsMenu({ disabled, displayName, resourceId, onShare }: {
  disabled: boolean;
  displayName: string;
  resourceId: string;
  onShare: () => void;
}) {
  const t = useUiT();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={t("agentSnapshots.openActions", { name: displayName })}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          data-testid={`agent-actions-${resourceId}`}
          disabled={disabled}
          type="button"
        >
          <EllipsisVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
        <DropdownMenuItem data-testid={`agent-share-${resourceId}`} disabled={disabled} onClick={onShare}>
          <Share2 className="h-4 w-4" />
          {t("agentTeams.share")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
