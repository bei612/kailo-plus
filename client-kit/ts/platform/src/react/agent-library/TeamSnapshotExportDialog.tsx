// Reused from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/agents/ui/TeamSnapshotExportDialog.tsx.
// DD-131(3)(4): the governed `agent.team.export` (Team owner and every affected member owner
// approve; members are exported at their current published Version). File format kept; the
// Memories choice and plaintext memory warning are not rendered.
import * as React from "react";

import type { AgentTeamView, ExportPackageView } from "@client-kit/contracts";
import { SnapshotExportDialog } from "./AgentSnapshotExportDialog";
import type { SnapshotExportTarget } from "./useSnapshotExport";

type TeamSnapshotExportDialogProps = {
  open: boolean;
  team: AgentTeamView;
  onSaveFile: (pkg: ExportPackageView) => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
};

export function TeamSnapshotExportDialog({ open, team, onSaveFile, onOpenChange }: TeamSnapshotExportDialogProps) {
  const target = React.useMemo<SnapshotExportTarget>(() => ({ kind: "team", team }), [team]);
  return <SnapshotExportDialog target={target} name={team.name} open={open} onSaveFile={onSaveFile}
    onOpenChange={onOpenChange} testIdPrefix="team-snapshot" unavailable={null} />;
}
