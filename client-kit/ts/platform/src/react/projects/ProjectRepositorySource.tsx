// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectRepositorySource.tsx::RepositoryBranchDropdown and the
// branch part of RepoSourceHeaderControls. Same picker, Create branch… / Delete <branch> items and
// disabled-reason line and tag snapshots. Desktop local controls live in useProjectLocalCheckout.
// A selected tag hides branch writes, as in the original.
import { ChevronDown, GitBranch, Plus, Tag, Trash2 } from "lucide-react";
import { useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../sidebar/dropdown-menu";
import { PROJECT_PICKER_TRIGGER_CLASS } from "./projectPanelStyles";

/** The branch subset of the original RepoSourceHeaderControls. */
export type RepoBranchHeaderControls = {
  branch: string;
  branchOptions: string[];
  selectedTag?: string | null;
  tagOptions?: Array<{ name: string; commit: string }>;
  onBranchChange: (branch: string) => void;
  onTagChange?: (tag: string) => void;
  onCreateBranch?: () => void;
  createBranchDisabled?: boolean;
  createBranchTitle?: string;
  onDeleteBranch?: () => void;
  deleteBranchDisabled?: boolean;
  deleteBranchTitle?: string;
};

/** Branch picker shared by the readme and files panel headers. */
export function RepositoryBranchDropdown({
  branch,
  branchOptions,
  selectedTag,
  tagOptions = [],
  createBranchDisabled,
  createBranchTitle,
  deleteBranchDisabled,
  deleteBranchTitle,
  onBranchChange,
  onTagChange,
  onCreateBranch,
  onDeleteBranch,
}: RepoBranchHeaderControls) {
  const t = useUiT();
  const selectableBranches = branchOptions.length > 0 ? branchOptions : [branch];
  const selectedValue = selectedTag ? `tag:${selectedTag}` : `branch:${branch}`;
  const RefIcon = selectedTag ? Tag : GitBranch;
  if (!branch) {
    return <span className="truncate text-sm font-semibold text-foreground">—</span>;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={PROJECT_PICKER_TRIGGER_CLASS}
          data-testid="project-repository-branch-trigger"
          size="sm"
          type="button"
          variant="outline"
        >
          <RefIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-left">{selectedTag ?? branch}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuRadioGroup
          onValueChange={(value) => {
            if (value.startsWith("tag:")) {
              onTagChange?.(value.slice("tag:".length));
            } else {
              onBranchChange(value.slice("branch:".length));
            }
          }}
          value={selectedValue}
        >
          <DropdownMenuLabel>{t("projects.branch.branches")}</DropdownMenuLabel>
          {selectableBranches.map((option) => (
            <DropdownMenuRadioItem key={option} value={`branch:${option}`}>
              <GitBranch className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{option}</span>
            </DropdownMenuRadioItem>
          ))}
          {tagOptions.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t("projects.branch.tags")}</DropdownMenuLabel>
              {tagOptions.map((option) => (
                <DropdownMenuRadioItem key={option.name} value={`tag:${option.name}`}>
                  <Tag className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{option.name}</span>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">{option.commit.slice(0, 7)}</span>
                </DropdownMenuRadioItem>
              ))}
            </>
          ) : null}
        </DropdownMenuRadioGroup>
        {!selectedTag && (onCreateBranch || onDeleteBranch) ? (
          <>
            <DropdownMenuSeparator />
            {onCreateBranch ? (
              <>
                <DropdownMenuItem
                  data-testid="project-create-branch"
                  disabled={createBranchDisabled}
                  onSelect={onCreateBranch}
                  title={createBranchTitle}
                >
                  <Plus className="h-4 w-4" />
                  {t("projects.branch.create")}
                </DropdownMenuItem>
                {createBranchDisabled && createBranchTitle ? (
                  <p className="max-w-56 px-2 py-1 text-xs text-muted-foreground">{createBranchTitle}</p>
                ) : null}
              </>
            ) : null}
            {onDeleteBranch ? (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                data-testid="project-delete-branch"
                disabled={deleteBranchDisabled}
                onSelect={onDeleteBranch}
                title={deleteBranchTitle}
              >
                <Trash2 className="h-4 w-4" />
                {t("projects.branch.deleteNamed", { branch })}
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
