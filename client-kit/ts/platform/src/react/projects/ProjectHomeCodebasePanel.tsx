// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectHomeCodebasePanel.tsx. Same repository picker and file
// tree beside the home channel. Attaching a repository needs the original repository-management
// consumer, so the empty state keeps only its explanation.
import { ChevronDown, FolderGit2 } from "lucide-react";
import { useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../sidebar/dropdown-menu";
import { RepositoryFilesPanel } from "./ProjectRepositoryPanel";
import type { ProjectsHost } from "./projectEnumeration";
import { useProjectRepoSnapshotQuery } from "./projectGitQueries";
import type { Project, Repository } from "./projectModels";
import { useRepositoryFileContentSource } from "./useRepositoryFileContent";
import type { RepositoryFilesContext } from "./useRepositoryFilesNavigation";

export function ProjectHomeCodebasePanel({ host, onFilesContextChange, onOpenCommit, onSelectRepository, project, repository }: {
  host: ProjectsHost;
  onFilesContextChange?: (context: RepositoryFilesContext) => void;
  onOpenCommit?: (commitHash: string) => void;
  onSelectRepository: (repositoryId: string) => void;
  project: Project;
  repository: Repository | null;
}) {
  const t = useUiT();
  const defaultBranch = repository?.defaultBranch ?? null;
  const snapshotQuery = useProjectRepoSnapshotQuery(host, repository, defaultBranch, null, Boolean(repository));
  const fileContentSource = useRepositoryFileContentSource({ activeBranch: defaultBranch, host, pullRequest: null, repository });
  const snapshot = snapshotQuery.data ?? null;
  const files = snapshot?.files ?? [];

  if (!repository) {
    return (
      <div className="space-y-3 px-4 pb-6 pt-1" data-testid="project-home-codebase-empty">
        <p className="text-sm text-muted-foreground">{t("projects.git.attachRepository")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="project-home-codebase-panel">
      {project.repositories.length > 1 ? (
        <div className="shrink-0 px-4 pb-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="h-7 max-w-full justify-start gap-2 px-2 text-sm font-normal" data-testid="project-home-codebase-repo-trigger"
                size="sm" type="button" variant="ghost">
                <FolderGit2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{repository.name}</span>
                <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {project.repositories.map((candidate) => (
                <DropdownMenuItem key={candidate.id} onSelect={() => onSelectRepository(candidate.id)}>{candidate.name}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <RepositoryFilesPanel error={snapshotQuery.error} fallbackAuthorPubkey={repository.owner} fileContentSource={fileContentSource}
          files={files} isLoading={snapshotQuery.isPending} onContextChange={onFilesContextChange} onOpenCommit={onOpenCommit} snapshot={snapshot} />
      </div>
    </div>
  );
}
