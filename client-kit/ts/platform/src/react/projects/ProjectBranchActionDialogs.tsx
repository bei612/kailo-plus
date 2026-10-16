// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectBranchActionDialogs.tsx. A retained unconfirmed change
// (DD-118) is the dialog's subject until it settles.
import type { useProjectBranchActions } from "./branchMutations";
import { CreateProjectBranchDialog, DeleteProjectBranchDialog } from "./ProjectBranchDialogs";

export function ProjectBranchActionDialogs({
  actions,
  activeBranch,
  activeBranchCommit,
  existingBranches,
}: {
  actions: ReturnType<typeof useProjectBranchActions>;
  activeBranch: string | null;
  activeBranchCommit: string | null;
  existingBranches: string[];
}) {
  return (
    <>
      <CreateProjectBranchDialog
        existingBranches={existingBranches}
        onCreate={actions.handleCreate}
        onOpenChange={actions.setCreateOpen}
        open={actions.createOpen}
        pending={actions.createPending}
        retainedBranch={actions.retainedCreate?.branch ?? null}
        sourceBranch={actions.retainedCreate?.sourceBranch ?? activeBranch ?? ""}
        sourceCommit={actions.retainedCreate?.expectedCommit ?? activeBranchCommit}
      />
      <DeleteProjectBranchDialog
        branch={actions.retainedDelete?.branch ?? activeBranch ?? ""}
        onDelete={actions.handleDelete}
        onOpenChange={actions.setDeleteOpen}
        open={actions.deleteOpen}
        pending={actions.deletePending}
        retained={Boolean(actions.retainedDelete)}
      />
    </>
  );
}
