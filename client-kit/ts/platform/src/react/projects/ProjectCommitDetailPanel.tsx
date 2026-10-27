// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectCommitDetailPanel.tsx. Same header, meta rows, commit
// body, "Discussed in" search, commit share link and full-bleed Files changed.
import { Calendar, GitCommitHorizontal, Hash, UserRound } from "lucide-react";
import { getLocale } from "../../i18n";
import { useUiT } from "../context";
import { DiscussedInChannels } from "./DiscussionChannels";
import { CopyCommitHashButton } from "./ProjectCommitCopyButton";
import { ProjectDetailMetaList, ProjectDetailMetaRow } from "./ProjectDetailMeta";
import { ProjectDetailSection } from "./ProjectDetailSection";
import { ProjectOriginReference } from "./ProjectOriginReference";
import { ProjectDiffFilesPanel } from "./ProjectPullRequestFilesChangedPanel";
import { ProjectRichContent } from "./ProjectRichContent";
import type { ProjectRepoCommit, ProjectRepoDiff } from "./projectGit";
import { ShareLinkButton } from "./ShareLinkButton";
import { commitShareLink } from "./projectShareLinks";
import type { Repository } from "./projectModels";
import { PROJECT_DETAIL_READING_COLUMN_CLASS } from "./projectPanelStyles";

function commitDateLabel(timestamp: number) {
  return new Date(timestamp * 1_000).toLocaleString(getLocale(), { dateStyle: "medium", timeStyle: "short" });
}

/** Chat cites commits by either the full or the abbreviated hash, so match both. */
export function commitDiscussionQuery(commit: { hash: string; shortHash?: string | null }): string {
  const short = commit.shortHash ?? commit.hash.slice(0, 7);
  if (!short || short === commit.hash) return commit.hash;
  return `${commit.hash} OR ${short}`;
}

/**
 * Detail view for a single commit: title and meta header, then collapsible
 * description and the commit-vs-parent diff.
 */
export function ProjectCommitDetailPanel({ commit, commitHash, diff, diffError, diffLoading, originAgentName, originChannelId, project }: {
  project: Repository;
  commit: ProjectRepoCommit | null;
  commitHash: string;
  diff: ProjectRepoDiff | null | undefined;
  diffError: unknown;
  diffLoading: boolean;
  originAgentName?: string | null;
  originChannelId?: string | null;
}) {
  const t = useUiT();
  const shortHash = commit?.shortHash ?? commitHash.slice(0, 7);
  return (
    <div className="flex w-full flex-1 flex-col overflow-hidden" data-project-detail-panel data-testid="project-commit-detail">
      <div className={PROJECT_DETAIL_READING_COLUMN_CLASS}>
        <header className="space-y-1 px-6 pb-3 pt-5">
          <h3 className="line-clamp-2 text-lg font-semibold leading-6 text-foreground">{commit?.subject ?? shortHash}{" "}
            <ShareLinkButton className="ml-0.5 inline-flex h-auto w-auto align-middle hover:bg-transparent"
              label={t("projects.share.copyCommit")} link={commitShareLink(project, commit?.hash ?? commitHash)}
              testId="project-commit-copy-link"/>
          </h3>
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            <span>{t("projects.git.committedLabel")}</span>
            {commit ? (
              <span className="shrink-0 whitespace-nowrap" title={commitDateLabel(commit.timestamp)}>{commitDateLabel(commit.timestamp)}</span>
            ) : null}
            <ProjectOriginReference agentName={originAgentName} channelId={originChannelId} />
          </p>
        </header>
        <ProjectDetailMetaList>
          <ProjectDetailMetaRow icon={Hash} label={t("projects.git.commit")}>
            <span className="inline-flex min-w-0 items-center gap-1 font-mono text-xs">
              {shortHash}
              <CopyCommitHashButton className="h-6 w-6" hash={commit?.hash ?? commitHash} />
            </span>
          </ProjectDetailMetaRow>
          {commit?.authorName ? (
            <ProjectDetailMetaRow icon={UserRound} label={t("projects.git.author")}>
              <span className="min-w-0 truncate text-muted-foreground" title={commit.authorEmail}>{commit.authorName}</span>
            </ProjectDetailMetaRow>
          ) : null}
          {commit ? (
            <ProjectDetailMetaRow icon={Calendar} label={t("projects.git.date")}>
              <span className="text-muted-foreground">{commitDateLabel(commit.timestamp)}</span>
            </ProjectDetailMetaRow>
          ) : null}
          {diff ? (
            <ProjectDetailMetaRow icon={GitCommitHorizontal} label={t("projects.git.changes")}>
              <span className="flex items-center gap-1.5">
                <span className="text-green-500">+{diff.additions}</span>
                <span className="text-destructive">-{diff.deletions}</span>
              </span>
            </ProjectDetailMetaRow>
          ) : null}
        </ProjectDetailMetaList>
        {diff?.commitBody ? (
          <ProjectDetailSection defaultOpen title={t("projects.workItem.description")}>
            <ProjectRichContent content={diff.commitBody} />
          </ProjectDetailSection>
        ) : null}
        <DiscussedInChannels className="mx-6 mb-4" entityLabel={t("projects.git.thisCommit")}
          query={commitDiscussionQuery({ hash: commit?.hash ?? commitHash, shortHash: commit?.shortHash })} testId="commit-discussed-in" />
      </div>
      <ProjectDetailSection className="flex min-h-0 flex-1 flex-col" contentClassName="flex min-h-0 flex-1 flex-col" defaultOpen
        headerClassName="mx-auto max-w-3xl" testId="project-commit-files-section" title={t("projects.git.filesChanged")}>
        {/* Full-bleed: cancel the section's inner padding so the file tree + diff grid spans the whole column. */}
        <div className="-mx-6 -mb-6 flex min-h-0 flex-1 flex-col">
          <ProjectDiffFilesPanel className="min-h-0 flex-1" fileTreeClassName="max-h-none" diff={diff} embedded error={diffError}
            headerLabel={`${commit?.subject ?? t("projects.git.commit")} · ${shortHash}`} isLoading={diffLoading} subject="commit" />
        </div>
      </ProjectDetailSection>
    </div>
  );
}
