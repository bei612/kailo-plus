// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/TeamsSection.tsx.
// Data is the governed Tenant `agent_team` directory (DD-131(1)); Edit and Delete are offered to
// the team owner only (Core still re-checks Team `update`/`manage` on every submission). The
// original built-in welcome team does not exist (DD-125(5)).
import {
  CopyPlus,
  EllipsisVertical,
  Pencil,
  Rocket,
  Share2,
  Trash2,
} from "lucide-react";

import type { AgentDefinitionView, AgentTeamView } from "@client-kit/contracts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../sidebar/dropdown-menu";
import { useUiT } from "../context";
import { IdentityCardSkeleton } from "./identity-card-skeleton";
import { CreateIdentityCard } from "./CreateIdentityCard";
import { TeamIdentityCard } from "./TeamIdentityCard";
import { resolveTeamMembers } from "./teamPersonas";

// Original UnifiedAgentsSection IDENTITY_CARD_GRID_CLASS.
export const IDENTITY_CARD_GRID_CLASS = "w-full grid-cols-1 [@container(min-width:21rem)]:grid-cols-2 [@container(min-width:32rem)]:grid-cols-3 [@container(min-width:43rem)]:grid-cols-4 [@container(min-width:54rem)]:grid-cols-5 grid gap-3";

const TEAM_CARD_COLUMN_CLASS = "w-full";

type TeamsSectionProps = {
  teams: AgentTeamView[];
  definitions: AgentDefinitionView[];
  currentPrincipalId?: string;
  error: string | null;
  isLoading: boolean;
  isPending: boolean;
  /** Snapshot import needs the host's binary transport; without it the entry is absent. */
  canImport: boolean;
  onCreate: () => void;
  onDuplicate: (team: AgentTeamView) => void;
  onEdit: (team: AgentTeamView) => void;
  onDelete: (team: AgentTeamView) => void;
  onAddToChannel: (team: AgentTeamView) => void;
  onShare: (team: AgentTeamView) => void;
  onDiscover: () => void;
  onImport: () => void;
  onRetry?: () => void;
};

export function TeamsSection({
  teams,
  definitions,
  currentPrincipalId,
  error,
  isLoading,
  isPending,
  canImport,
  onCreate,
  onDuplicate,
  onEdit,
  onDelete,
  onAddToChannel,
  onShare,
  onDiscover,
  onImport,
  onRetry,
}: TeamsSectionProps) {
  const t = useUiT();
  return (
    <section className="relative space-y-4" data-testid="agents-library-teams">
      <div className={TEAM_CARD_COLUMN_CLASS}>
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-lg font-semibold tracking-tight">{t("agentTeams.title")}</h2>
          <p className="text-sm font-normal text-muted-foreground">{t("agentTeams.subtitle")}</p>
        </div>
      </div>

      {isLoading ? (
        <div className={IDENTITY_CARD_GRID_CLASS} role="status" aria-label={t("platform.loading")}>
          <IdentityCardSkeleton footerSubtitleWidthClass="w-14" footerTitleWidthClass="w-24" showAction />
          <IdentityCardSkeleton footerSubtitleWidthClass="w-24" footerTitleWidthClass="w-32" showAction />
          <IdentityCardSkeleton footerSubtitleWidthClass="w-20" footerTitleWidthClass="w-28" showAction />
        </div>
      ) : null}

      {!isLoading ? (
        <div className={IDENTITY_CARD_GRID_CLASS}>
          <NewTeamCard canImport={canImport} isPending={isPending} onCreate={onCreate} onDiscover={onDiscover} onImport={onImport} />
          {teams.map((team) => {
            const resolution = resolveTeamMembers(team, definitions);
            const missingCount = resolution.missingMemberCount;
            const hasMissing = resolution.hasMissingMembers;
            const owner = currentPrincipalId !== undefined && team.ownerPrincipalId === currentPrincipalId;
            const deployable = resolution.resolvedMembers.length > 0;
            return (
              <TeamIdentityCard
                actions={
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <button
                        aria-label={t("agentTeams.actions", { name: team.name })}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        data-testid={`team-actions-${team.resourceId}`}
                        type="button"
                      >
                        <EllipsisVertical className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
                      <DropdownMenuItem disabled={isPending || hasMissing || !deployable} onClick={() => onAddToChannel(team)}>
                        <Rocket className="h-4 w-4" />
                        {t("agentTeams.deploy")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {owner ? (
                        <DropdownMenuItem disabled={isPending} onClick={() => onEdit(team)}>
                          <Pencil className="h-4 w-4" />
                          {t("agentTeams.edit")}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem disabled={isPending || hasMissing || !deployable} onClick={() => onDuplicate(team)}>
                        <CopyPlus className="h-4 w-4" />
                        {t("agentTeams.duplicate")}
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={isPending || hasMissing} onClick={() => onShare(team)}>
                        <Share2 className="h-4 w-4" />
                        {t("agentTeams.share")}
                      </DropdownMenuItem>
                      {owner ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive focus:text-destructive" disabled={isPending} onClick={() => onDelete(team)}>
                            <Trash2 className="h-4 w-4" />
                            {t("agentTeams.delete")}
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
                dataTestId={`team-card-${team.resourceId}`}
                description={team.description}
                key={`${team.resourceId}:${team.resourceVersion}`}
                memberCount={team.memberAgentResourceIds.length + team.hiddenMemberCount}
                members={resolution.resolvedMembers}
                teamName={team.name}
              >
                {hasMissing ? (
                  <p className="border-t border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {t(missingCount === 1 ? "agentTeams.missing.one" : "agentTeams.missing.other", { count: missingCount })}
                  </p>
                ) : null}
                {resolution.hiddenMemberCount > 0 ? (
                  <p className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
                    {t(resolution.hiddenMemberCount === 1 ? "agentTeams.hidden.one" : "agentTeams.hidden.other", { count: resolution.hiddenMemberCount })}
                  </p>
                ) : null}
              </TeamIdentityCard>
            );
          })}
        </div>
      ) : null}

      {error ? (
        <div className={`${TEAM_CARD_COLUMN_CLASS} flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive`} role="alert">
          <span className="min-w-0 flex-1">{error}</span>
          {onRetry ? <button className="shrink-0 underline" onClick={onRetry} type="button">{t("platform.retry")}</button> : null}
        </div>
      ) : null}
    </section>
  );
}

function NewTeamCard({ canImport, isPending, onCreate, onDiscover, onImport }: {
  canImport: boolean;
  isPending: boolean;
  onCreate: () => void;
  onDiscover: () => void;
  onImport: () => void;
}) {
  const t = useUiT();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <CreateIdentityCard ariaLabel={t("agentTeams.new")} dataTestId="new-team-card" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onCloseAutoFocus={(event) => event.preventDefault()}>
        <DropdownMenuItem data-testid="team-create" disabled={isPending} onClick={onCreate}>
          {t("agentTeams.create")}
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="team-catalog-open" disabled={isPending} onClick={onDiscover}>
          {t("agentCatalog.chooseFromCatalog")}
        </DropdownMenuItem>
        {canImport ? (
          <DropdownMenuItem data-testid="team-import" disabled={isPending} onClick={onImport}>
            {t("agentTeams.import")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
