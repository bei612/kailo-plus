// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/TeamShareDialog.tsx.
// DD-131(3)(6)(7): sending is the governed `agent.team.export` package as a direct-message
// attachment; "Share to catalog" is `agent.team.share/unshare` (Team owner only; no built-in team).
// The original memory level choice is not rendered.
import * as React from "react";

import type { AgentTeamView } from "@client-kit/contracts";
import { useUiT } from "../context";
import { CatalogShareSection, SnapshotShareDialog, type CatalogShareControl } from "./PersonaShareDialog";
import type { AgentSnapshotHost } from "./agentSnapshotHost";
import type { SnapshotExportTarget } from "./useSnapshotExport";

type TeamShareDialogProps = {
  team: AgentTeamView;
  host: AgentSnapshotHost;
  catalog: CatalogShareControl | null;
  isPending: boolean;
  onExport: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function TeamShareDialog({ team, host, catalog, isPending, onExport, onOpenChange, open }: TeamShareDialogProps) {
  const t = useUiT();
  const target = React.useMemo<SnapshotExportTarget>(() => ({ kind: "team", team }), [team]);
  return (
    <SnapshotShareDialog
      beforeExport={catalog ? <CatalogShareSection control={catalog} description={t("agentCatalog.shareTeamDescription")} testIdPrefix="team-share" /> : null}
      displayName={team.name}
      host={host}
      isPending={isPending}
      onExport={onExport}
      onOpenChange={onOpenChange}
      open={open}
      snapshotKind="team"
      target={target}
      testIdPrefix="team-share"
    />
  );
}
