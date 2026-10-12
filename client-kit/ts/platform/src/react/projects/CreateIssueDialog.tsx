// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/CreateIssueDialog.tsx.
import { useUiT } from "../context";
import { CreateProjectWorkItemDialog, type CreateProjectWorkItemDialogInput } from "./CreateProjectWorkItemDialog";

export function CreateIssueDialog({ isCreating, onCreate, onOpenChange, open, projectName }: {
  isCreating: boolean;
  onCreate: (input: CreateProjectWorkItemDialogInput) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  projectName: string;
}) {
  const t = useUiT();
  return <CreateProjectWorkItemDialog bodyPlaceholder={t("projects.issue.bodyPlaceholder")}
    description={t("projects.issue.inRepository", {name: projectName})} isCreating={isCreating} itemName="issue"
    onCreate={onCreate} onOpenChange={onOpenChange} open={open}
    title={t("projects.issue.dialogTitle")} titlePlaceholder={t("projects.issue.titlePlaceholder")}/>;
}
