// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/CreateProjectDialog.tsx. Original dialog;
// the existing governed form additionally resumes its unchanged frozen intent.
import { Dialog } from "../composer/shared/ui/dialog";
import { CreateProjectFormContent } from "./CreateProjectFormContent";
import type { CreateProjectInput } from "./createProject";

export function CreateProjectDialog({
  isCreating,
  onCreate,
  onOpenChange,
  open,
  frozen,
}: {
  isCreating: boolean;
  onCreate: (input: CreateProjectInput) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  frozen?: CreateProjectInput;
}) {
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isCreating) return;
        onOpenChange(nextOpen);
      }}
      open={open}
    >
      <CreateProjectFormContent
        active={open}
        frozen={frozen}
        isCreating={isCreating}
        onBack={() => onOpenChange(false)}
        onCreate={onCreate}
        onCreated={() => onOpenChange(false)}
      />
    </Dialog>
  );
}
