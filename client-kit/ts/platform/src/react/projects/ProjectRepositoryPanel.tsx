// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectRepositoryPanel.tsx::RepositoryFilesPanel/FileContentPanel.
// Same table, breadcrumbs, latest-commit header, paging and preview. No branch/source/sync header:
// this host has no branch listing, local checkout or push. The relay user-search avatar fallback
// is not restored; known profiles and the repository owner remain the avatar sources.
import { ChevronRight, FileDiff } from "lucide-react";
import * as React from "react";
import { useUiT } from "../context";
import type { UserProfileLookup } from "../messages/system/identity";
import { UserAvatar } from "../messages/UserAvatar";
import { normalizePubkey } from "../conversations/pubkey";
import { cn } from "../profile/buzz/shared/lib/cn";
import { BuzzLoadingState } from "./BuzzLoadingState";
import { ProjectPanelState } from "./ProjectPanelState";
import { ProjectRepositoryLatestCommitRow } from "./ProjectRepositoryLatestCommitRow";
import { ProjectSyntaxCode } from "./ProjectSyntaxCode";
import { DIRECTORY_ICON_VISUAL, fileBaseName, repositoryFileIconVisual } from "./projectFileIcons";
import type { ProjectRepoFile, ProjectRepoSnapshot } from "./projectGit";
import { PROJECT_DETAIL_PANEL_CLASS } from "./projectPanelStyles";
import {
  formatFileSize, formatLastChangedAt, nextRepositoryEntryLimit, relativeTime, REPOSITORY_ENTRY_PAGE_SIZE,
} from "./lib/projectsViewHelpers";
import { type RepositoryFileContentSource, useRepositoryFileContent } from "./useRepositoryFileContent";
import { type RepositoryFilesContext, useRepositoryFilesNavigation } from "./useRepositoryFilesNavigation";

function normalizeAuthorLookupValue(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

type CommitAuthorProfile = {
  avatarUrl: string | null;
  displayName: string | null;
  isAgent?: boolean;
  nip05Handle?: string | null;
  ownerPubkey?: string | null;
};

function profileMatchesCommitAuthor(commit: ProjectRepoFile["latestCommit"], profile: CommitAuthorProfile, pubkey?: string) {
  if (!commit) return false;
  const authorName = normalizeAuthorLookupValue(commit.authorName);
  const authorEmail = normalizeAuthorLookupValue(commit.authorEmail);
  if (!authorName && !authorEmail) return false;
  const candidates = [pubkey, profile.displayName, profile.nip05Handle, profile.ownerPubkey].map(normalizeAuthorLookupValue);
  return candidates.includes(authorName) || candidates.includes(authorEmail);
}

function profileForCommitAuthor(commit: ProjectRepoFile["latestCommit"], profiles: UserProfileLookup | undefined) {
  if (!commit || !profiles) return null;
  for (const [pubkey, profile] of Object.entries(profiles)) {
    if (profileMatchesCommitAuthor(commit, profile, pubkey)) return profile;
  }
  return null;
}

function commitAuthorLabel(commit: ProjectRepoFile["latestCommit"], profile?: CommitAuthorProfile | null) {
  if (!commit) return "";
  return profile?.displayName?.trim() || profile?.nip05Handle?.trim() || commit.authorName;
}

function RepositoryCommitCell({ commit, profiles }: { commit: ProjectRepoFile["latestCommit"]; profiles?: UserProfileLookup }) {
  if (!commit) return <span className="text-muted-foreground">—</span>;
  return (
    <p className="truncate text-xs text-foreground">
      {commit.subject}
      <span className="text-muted-foreground">
        {" "}
        · {commitAuthorLabel(commit, profileForCommitAuthor(commit, profiles))}
      </span>
    </p>
  );
}

export const baseName = fileBaseName;

const FILE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  c: "c", cc: "cpp", cpp: "cpp", cs: "csharp", css: "css", dart: "dart", go: "go", h: "c", hpp: "cpp",
  html: "html", java: "java", js: "javascript", json: "json", jsx: "jsx", kt: "kotlin", kts: "kotlin",
  md: "markdown", mjs: "javascript", mts: "typescript", py: "python", rb: "ruby", rs: "rust", sh: "bash",
  sql: "sql", swift: "swift", toml: "toml", ts: "typescript", tsx: "tsx", yaml: "yaml", yml: "yaml", zig: "zig",
};

export function languageForPath(path: string) {
  const fileName = baseName(path).toLowerCase();
  if (fileName === "dockerfile") return "dockerfile";
  if (fileName === "makefile") return "make";
  const extension = fileName.split(".").pop();
  return extension ? FILE_LANGUAGE_BY_EXTENSION[extension] : undefined;
}

type RepositoryFileEntry = {
  file?: ProjectRepoFile;
  fileCount?: number;
  lastChangedAt: number | null;
  latestCommit: ProjectRepoFile["latestCommit"];
  name: string;
  path: string;
  size: number | null;
  type: "directory" | "file";
};

function RepositoryEntryIcon({ entry }: { entry: RepositoryFileEntry }) {
  const visual = entry.type === "directory" ? DIRECTORY_ICON_VISUAL : repositoryFileIconVisual(entry.name);
  const Icon = visual.Icon;
  return (
    <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-md", visual.containerClassName)}
      data-testid="project-repository-entry-icon">
      <Icon className={cn("h-4 w-4", visual.className)} />
    </span>
  );
}

function repositoryEntries(files: ProjectRepoFile[], currentPath: string): RepositoryFileEntry[] {
  const directories = new Map<string, RepositoryFileEntry>();
  const entries: RepositoryFileEntry[] = [];
  const prefix = currentPath ? `${currentPath}/` : "";
  for (const file of files) {
    if (currentPath && !file.path.startsWith(prefix)) continue;
    const relativePath = currentPath ? file.path.slice(prefix.length) : file.path;
    const [name, ...rest] = relativePath.split("/");
    if (!name) continue;
    if (rest.length > 0) {
      const path = currentPath ? `${currentPath}/${name}` : name;
      const existing = directories.get(path);
      if (existing) {
        existing.fileCount = (existing.fileCount ?? 0) + 1;
        if ((file.lastChangedAt ?? 0) > (existing.lastChangedAt ?? 0)) {
          existing.lastChangedAt = file.lastChangedAt;
          existing.latestCommit = file.latestCommit;
        }
      } else {
        directories.set(path, { fileCount: 1, lastChangedAt: file.lastChangedAt, latestCommit: file.latestCommit,
          name, path, size: null, type: "directory" });
      }
      continue;
    }
    entries.push({ file, lastChangedAt: file.lastChangedAt, latestCommit: file.latestCommit, name, path: file.path, size: file.size, type: "file" });
  }
  return [...directories.values(), ...entries].sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

function openRepositoryEntry(entry: RepositoryFileEntry, setCurrentPath: (path: string) => void, setSelectedFile: (file: ProjectRepoFile) => void) {
  if (entry.type === "directory") {
    setCurrentPath(entry.path);
    return;
  }
  if (entry.file) setSelectedFile(entry.file);
}

function handleRepositoryEntryKeyDown(event: React.KeyboardEvent<HTMLTableRowElement>, onOpen: () => void) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onOpen();
}

function BreadcrumbButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button className="truncate rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      onClick={onClick} type="button">
      {children}
    </button>
  );
}

function FileContentPanel({ file, fileContentSource, onOpenPath }: {
  file: ProjectRepoFile;
  fileContentSource?: RepositoryFileContentSource;
  onOpenPath: (path: string) => void;
}) {
  const t = useUiT();
  const fileContent = useRepositoryFileContent(file, fileContentSource);
  const language = languageForPath(file.path);
  const pathSegments = file.path.split("/").filter(Boolean);
  const fileName = pathSegments[pathSegments.length - 1] ?? file.path;
  const directorySegments = pathSegments.slice(0, -1);
  return (
    <div className={PROJECT_DETAIL_PANEL_CLASS} data-project-detail-panel data-testid="project-repository-file">
      <div className="flex min-h-14 items-center gap-1 border-border/50 border-b bg-muted/20 px-4 py-3">
        <BreadcrumbButton onClick={() => onOpenPath("")}>{t("projects.git.files")}</BreadcrumbButton>
        {directorySegments.map((segment, index) => {
          const nextPath = directorySegments.slice(0, index + 1).join("/");
          return (
            <React.Fragment key={nextPath}>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              <BreadcrumbButton onClick={() => onOpenPath(nextPath)}>{segment}</BreadcrumbButton>
            </React.Fragment>
          );
        })}
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        <FileDiff className="h-4 w-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate px-1.5 py-1 font-mono text-xs text-foreground">{fileName}</span>
        <div className="hidden shrink-0 items-center gap-3 text-2xs text-muted-foreground sm:flex">
          <span>{t("projects.git.lastChanged", { time: formatLastChangedAt(file.lastChangedAt) })}</span>
          <span>{formatFileSize(file.size)}</span>
        </div>
        <span className="shrink-0 text-2xs text-muted-foreground sm:hidden">{formatFileSize(file.size)}</span>
      </div>
      <div className="border-border/50 border-b bg-muted/10 px-4 py-2 text-2xs text-muted-foreground sm:hidden">
        {t("projects.git.lastChanged", { time: formatLastChangedAt(file.lastChangedAt) })}
      </div>
      {fileContent.isLoading ? (
        <BuzzLoadingState label={t("projects.git.loadingFile")} />
      ) : fileContent.content ? (
        <pre className="overflow-x-auto bg-background/60 p-4">
          {language ? (
            <ProjectSyntaxCode className="whitespace-pre-wrap break-words text-xs leading-relaxed" code={fileContent.content} language={language} />
          ) : (
            <code className="block min-w-full whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
              {fileContent.content}
            </code>
          )}
        </pre>
      ) : (
        <div className="p-6 text-sm text-muted-foreground">
          {fileContent.error ? t("projects.git.fileError") : t("projects.git.previewUnavailable")}
        </div>
      )}
    </div>
  );
}

export function RepositoryFilesPanel({
  files, fileContentSource, initialPath, snapshot, isLoading, error, profiles, fallbackAuthorPubkey, onContextChange, onOpenCommit,
}: {
  files: ProjectRepoFile[];
  fileContentSource?: RepositoryFileContentSource;
  initialPath?: string;
  snapshot: ProjectRepoSnapshot | null | undefined;
  isLoading: boolean;
  error: unknown;
  profiles?: UserProfileLookup;
  fallbackAuthorPubkey?: string;
  onContextChange?: (context: RepositoryFilesContext) => void;
  onOpenCommit?: (commitHash: string) => void;
}) {
  const t = useUiT();
  const { currentPath, openPath, selectedFile, setSelectedFile, setVisibleEntryCount, visibleEntryCount } =
    useRepositoryFilesNavigation({ files, initialPath, onContextChange, pageSize: REPOSITORY_ENTRY_PAGE_SIZE });
  const entries = React.useMemo(() => repositoryEntries(files, currentPath), [currentPath, files]);
  const visibleEntries = entries.slice(0, visibleEntryCount);
  const nextVisibleEntryCount = nextRepositoryEntryLimit(visibleEntryCount, entries.length);
  const nextEntryCount = nextVisibleEntryCount - visibleEntries.length;
  const latestCommit = snapshot?.latestCommit ?? null;
  const knownLatestCommitProfile = React.useMemo(() => profileForCommitAuthor(latestCommit, profiles), [latestCommit, profiles]);
  const fallbackLatestCommitProfile = fallbackAuthorPubkey ? (profiles?.[normalizePubkey(fallbackAuthorPubkey)] ?? null) : null;
  const latestCommitProfile = knownLatestCommitProfile ?? fallbackLatestCommitProfile;
  const latestCommitAuthorLabel = commitAuthorLabel(latestCommit, latestCommitProfile);
  const pathSegments = currentPath ? currentPath.split("/") : [];

  if (isLoading) return <BuzzLoadingState label={t("projects.git.loadingFiles")} />;
  const stateMessage = error ? t("projects.git.treeError") : files.length === 0 ? t("projects.git.noFiles") : null;
  if (stateMessage) {
    return <ProjectPanelState description={error ? t("projects.git.treeErrorHint") : t("projects.git.noFilesHint")}
      error={Boolean(error)} title={stateMessage} />;
  }
  if (selectedFile) return <FileContentPanel file={selectedFile} fileContentSource={fileContentSource} onOpenPath={openPath} />;

  return (
    <div className={PROJECT_DETAIL_PANEL_CLASS} data-project-detail-panel data-testid="project-repository-files">
      {pathSegments.length > 0 ? (
        <div className="flex min-h-14 min-w-0 items-center gap-1 border-border/50 border-b px-4 py-3">
          <BreadcrumbButton onClick={() => openPath("")}>{t("projects.git.files")}</BreadcrumbButton>
          {pathSegments.map((segment, index) => {
            const nextPath = pathSegments.slice(0, index + 1).join("/");
            return (
              <React.Fragment key={nextPath}>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                <BreadcrumbButton onClick={() => openPath(nextPath)}>{segment}</BreadcrumbButton>
              </React.Fragment>
            );
          })}
        </div>
      ) : null}

      <div className="overflow-x-auto px-2 pb-2">
        <table className="w-full border-collapse caption-bottom text-sm">
          <thead>
            <ProjectRepositoryLatestCommitRow commitShortHash={latestCommit?.shortHash}
              onOpen={latestCommit && onOpenCommit ? () => onOpenCommit(latestCommit.hash) : undefined}>
              <th className="px-4 py-3 text-left font-normal" colSpan={3}>
                {latestCommit ? (
                  <div className="flex min-w-0 items-center justify-between gap-3 text-xs" data-testid="project-repository-latest-commit-summary">
                    <div className="flex min-w-0 items-center gap-2">
                      <UserAvatar accent={latestCommitProfile?.isAgent === true} avatarUrl={latestCommitProfile?.avatarUrl ?? null}
                        displayName={latestCommitAuthorLabel} shape={latestCommitProfile?.isAgent ? "squircle" : "circle"} size="sm" />
                      <p className="min-w-0 flex-1 truncate text-foreground">
                        <span className="font-semibold">{latestCommitAuthorLabel}</span>
                        <span className="text-muted-foreground"> {t("projects.git.committed")}</span>
                        <span className="font-medium"> {latestCommit.subject}</span>
                        <code className="mx-1.5 rounded-md bg-background/60 px-1.5 py-0.5 text-2xs text-muted-foreground" title={latestCommit.hash}>
                          {latestCommit.shortHash}
                        </code>
                        <span className="text-muted-foreground">
                          · {t(files.length === 1 ? "projects.git.fileCountOne" : "projects.git.fileCountMany", { count: files.length })}
                        </span>
                      </p>
                    </div>
                    <time className="shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground"
                      dateTime={new Date(latestCommit.timestamp * 1_000).toISOString()}>
                      {relativeTime(latestCommit.timestamp)}
                    </time>
                  </div>
                ) : (
                  <p className="truncate text-sm font-medium text-foreground">{t("projects.git.trackedFiles", { count: files.length })}</p>
                )}
              </th>
            </ProjectRepositoryLatestCommitRow>
          </thead>
          <tbody>
            {visibleEntries.map((entry) => {
              const entryCommit = entry.latestCommit;
              const openEntry = () => openRepositoryEntry(entry, openPath, setSelectedFile);
              return (
                <tr aria-label={t(entry.type === "directory" ? "projects.git.openDirectory" : "projects.git.openFile", { name: entry.name })}
                  className="group/repository-entry cursor-pointer text-xs focus-visible:outline-hidden"
                  data-testid="project-repository-entry-row" key={`${entry.type}:${entry.path}`}
                  onClick={openEntry} onKeyDown={(event) => handleRepositoryEntryKeyDown(event, openEntry)} tabIndex={0}>
                  <td className="min-w-52 px-3 py-2 align-middle transition-colors group-hover/repository-entry:rounded-l-md group-hover/repository-entry:bg-muted/35 group-focus-visible/repository-entry:rounded-l-md group-focus-visible/repository-entry:bg-muted/35">
                    <div className="flex min-w-0 items-center gap-2">
                      <RepositoryEntryIcon entry={entry} />
                      <span className="truncate font-medium text-foreground">{entry.name}</span>
                    </div>
                  </td>
                  <td className="max-w-96 p-2 align-middle transition-colors group-hover/repository-entry:bg-muted/35 group-focus-visible/repository-entry:bg-muted/35">
                    <RepositoryCommitCell commit={entryCommit} profiles={profiles} />
                  </td>
                  <td className="w-36 whitespace-nowrap p-2 text-right align-middle text-muted-foreground transition-colors group-hover/repository-entry:rounded-r-md group-hover/repository-entry:bg-muted/35 group-focus-visible/repository-entry:rounded-r-md group-focus-visible/repository-entry:bg-muted/35">
                    {entryCommit ? (
                      <time dateTime={new Date(entryCommit.timestamp * 1_000).toISOString()}>{relativeTime(entryCommit.timestamp)}</time>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {entries.length > visibleEntries.length ? (
        <div className="flex items-center justify-between gap-3 border-border/50 border-t px-4 py-3 text-2xs text-muted-foreground">
          <span aria-live="polite">{t("projects.git.showingEntries", { visible: visibleEntries.length, total: entries.length })}</span>
          <button aria-label={t("projects.git.showNextLabel", { count: nextEntryCount, limit: nextVisibleEntryCount, total: entries.length })}
            className="shrink-0 font-medium text-foreground hover:underline"
            onClick={() => setVisibleEntryCount((current) => nextRepositoryEntryLimit(current, entries.length))} type="button">
            {t("projects.git.showNext", { count: nextEntryCount })}
          </button>
        </div>
      ) : null}
    </div>
  );
}
