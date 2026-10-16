// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectRepositoryLatestCommitRow.tsx, unchanged except copy.
import type * as React from "react";
import { useUiT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";

/** Interactive table-header row that opens the repository's latest commit. */
export function ProjectRepositoryLatestCommitRow({
  children,
  commitShortHash,
  onOpen,
}: {
  children: React.ReactNode;
  commitShortHash?: string;
  onOpen?: () => void;
}) {
  const t = useUiT();
  return (
    <tr
      aria-label={commitShortHash ? t("projects.git.openCommit", { hash: commitShortHash }) : undefined}
      className={cn(
        "bg-muted/20",
        onOpen &&
          "cursor-pointer transition-colors hover:bg-muted/35 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      )}
      data-testid="project-repository-latest-commit"
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onOpen();
            }
          : undefined
      }
      tabIndex={onOpen ? 0 : undefined}
    >
      {children}
    </tr>
  );
}
