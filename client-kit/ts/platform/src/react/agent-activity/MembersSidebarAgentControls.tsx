// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/channels/ui/MembersSidebarAgentControls.tsx (bulk menu) and the agent branch of
// MembersSidebarMemberCard.tsx's member menu, original DOM/classes/copy, over governed Installation
// actions (DD-125(6)): Stop / Remove from channel → agent.installation.disable, Start agent →
// agent.installation.enable, "Spawn or respawn all" → enable the stopped ones and restart (same-version
// upgrade) the running ones. Every item follows the BFF hints; Core re-admits each submit.
import { Activity, Ellipsis, Pencil, Play, Square, Trash2 } from "lucide-react";
import type { AgentInstallationView } from "@client-kit/contracts";

import { useUiT } from "../context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../sidebar/dropdown-menu";
import { isInstallationActive, lifecycleOffer, type LifecycleKind } from "./agentLifecycle";

type MembersSidebarAgentControlsProps = {
  canBulkRemove: boolean;
  canBulkRespawn: boolean;
  canBulkStop: boolean;
  disabled: boolean;
  onRemoveAll: () => void;
  onRespawnAll: () => void;
  onStopAll: () => void;
};

export function MembersSidebarAgentControls({
  canBulkRemove,
  canBulkRespawn,
  canBulkStop,
  disabled,
  onRemoveAll,
  onRespawnAll,
  onStopAll,
}: MembersSidebarAgentControlsProps) {
  const t = useUiT();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={t("agentLifecycle.bulkMenu")}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          data-testid="members-sidebar-agent-controls"
          type="button"
        >
          <Ellipsis className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuItem
          data-testid="members-sidebar-respawn-all"
          disabled={disabled || !canBulkRespawn}
          onClick={onRespawnAll}
        >
          <Play className="h-4 w-4" />
          {t("agentLifecycle.respawnAll")}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="members-sidebar-stop-all"
          disabled={disabled || !canBulkStop}
          onClick={onStopAll}
        >
          <Square className="h-4 w-4" />
          {t("agentLifecycle.stopAll")}
        </DropdownMenuItem>
        {canBulkRemove ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              data-testid="members-sidebar-remove-all"
              disabled={disabled}
              onClick={onRemoveAll}
            >
              <Trash2 className="h-4 w-4" />
              {t("agentLifecycle.removeAll")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Bulk targets in the original order: stop running, respawn = start stopped + restart running. */
export function bulkTargets(rows: readonly AgentInstallationView[]) {
  const stop = rows.filter((row) => lifecycleOffer(row).stop);
  const start = rows.filter((row) => lifecycleOffer(row).start);
  const restart = rows.filter((row) => lifecycleOffer(row).restart);
  return { stop, start, restart };
}

/** Agent branch of the original member menu (MembersSidebarMemberCard). */
export function AgentMemberMenu({
  installation,
  disabled,
  onManageAccess,
  onRequest,
  onViewActivity,
}: {
  installation: AgentInstallationView;
  disabled: boolean;
  onManageAccess: () => void;
  onRequest: (kind: LifecycleKind) => void;
  /** Only with Installation `audit` (the transcript is readable). */
  onViewActivity?: () => void;
}) {
  const t = useUiT();
  const offer = lifecycleOffer(installation);
  const active = isInstallationActive(installation);
  const primary: LifecycleKind | null = active ? (offer.stop ? "stop" : null) : (offer.start ? "start" : null);
  const canManage = offer.stop || offer.start || offer.restart;
  if (!onViewActivity && !canManage) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={t("agentLifecycle.memberMenu")}
          className="invisible relative z-20 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground group-hover/member:visible hover:bg-muted hover:text-foreground data-[state=open]:visible"
          data-testid={`sidebar-member-menu-${installation.agentPubkey ?? installation.resourceId}`}
          type="button"
        >
          <Ellipsis className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {onViewActivity ? (
          <DropdownMenuItem
            data-testid={`sidebar-view-activity-${installation.resourceId}`}
            onClick={onViewActivity}
          >
            <Activity className="h-4 w-4" />
            {t("agentActivity.viewActivity")}
          </DropdownMenuItem>
        ) : null}
        {canManage ? (
          <>
            {onViewActivity ? <DropdownMenuSeparator /> : null}
            {primary ? (
              <DropdownMenuItem
                data-testid={`sidebar-agent-action-${installation.resourceId}`}
                disabled={disabled}
                onClick={() => onRequest(primary)}
              >
                {primary === "stop" ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {t(primary === "stop" ? "agentLifecycle.stop" : "agentLifecycle.start")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              data-testid={`sidebar-edit-respond-to-${installation.resourceId}`}
              disabled={disabled}
              onClick={onManageAccess}
            >
              <Pencil className="h-4 w-4" />
              {t("agentLifecycle.manageAccess")}
            </DropdownMenuItem>
            {offer.stop ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  data-testid={`sidebar-remove-member-${installation.resourceId}`}
                  disabled={disabled}
                  onClick={() => onRequest("remove")}
                >
                  <Trash2 className="h-4 w-4" />
                  {t("agentLifecycle.remove")}
                </DropdownMenuItem>
              </>
            ) : null}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
