// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectPullRequestFilesChangedPanel.tsx::ProjectDiffFilesPanel and
// ProjectPullRequestFilesChangedPanel. Same file tree, filter, diff rows, focused anchor and the
// original truncation notice. DD-118(5) line comments: the original per-line "Add line comment"
// affordance and ProjectPullRequestInlineCommentThread (current-commit inline comments plus the
// anchored composer) render when the review detail supplies inline-comment controls; they are
// labeled kind-1 PR comments with file/side/line tags, published through the governed host.
import { FileDiff, Files, FolderGit2, GitCommitHorizontal, MessageSquarePlus, Search } from "lucide-react";
import * as React from "react";
import { useUiT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import { BuzzLoadingState } from "./BuzzLoadingState";
import { changedFileIconVisual } from "./projectFileIcons";
import type { ProjectRepoDiff, ProjectRepoDiffFile } from "./projectGit";
import { PROJECT_DETAIL_PANEL_CLASS } from "./projectPanelStyles";
import type { ProjectPullRequest, ProjectPullRequestComment } from "./projectPullRequests.mjs";
import type { UserProfileLookup } from "../messages/system/identity";
import { ProjectPullRequestInlineCommentThread, type ProjectInlineCommentSubmit } from "./ProjectPullRequestInlineComments";

export type ProjectDiffAnchor = { line: number; path: string; side: "old" | "new" };

/** Original InlineCommentControls, owned by the review detail that publishes them. */
export type InlineCommentControls = {
  activeAnchor: ProjectDiffAnchor | null;
  canRequestChanges: boolean;
  comments: ProjectPullRequestComment[];
  isSending: boolean;
  onCancel: () => void;
  onStart: (anchor: ProjectDiffAnchor) => void;
  onSubmit: (anchor: ProjectDiffAnchor, ...args: Parameters<ProjectInlineCommentSubmit>) => Promise<unknown>;
  profiles?: UserProfileLookup;
};

function fileName(path: string) {
  return path.split("/").pop() || path;
}

function directoryName(path: string) {
  const segments = path.split("/");
  segments.pop();
  return segments.join("/");
}

type DiffRow = { content: string; key: string; newLine: number | null; oldLine: number | null; type: "add" | "context" | "delete" | "hunk" };
type FileTreeNode = { children: Map<string, FileTreeNode>; file: ProjectRepoDiffFile | null; name: string; path: string };

function createFileTreeNode(name: string, path: string): FileTreeNode {
  return { children: new Map(), file: null, name, path };
}

function buildFileTree(files: ProjectRepoDiffFile[]) {
  const root = createFileTreeNode("", "");
  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    let node = root;
    segments.forEach((segment, index) => {
      const path = segments.slice(0, index + 1).join("/");
      let child = node.children.get(segment);
      if (!child) {
        child = createFileTreeNode(segment, path);
        node.children.set(segment, child);
      }
      node = child;
    });
    node.file = file;
  }
  return root;
}

function sortedFileTreeChildren(node: FileTreeNode) {
  return [...node.children.values()].sort((left, right) => {
    if (Boolean(left.file) !== Boolean(right.file)) return left.file ? 1 : -1;
    return left.name.localeCompare(right.name);
  });
}

function ChangedFileTreeIcon({ path }: { path: string }) {
  const visual = changedFileIconVisual(path);
  const Icon = visual.Icon;
  return (
    <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center", visual.containerClassName)}>
      <Icon className={cn("h-4 w-4", visual.className)} />
    </span>
  );
}

function ChangedFolderTreeIcon() {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center bg-sky-500/15">
      <FolderGit2 className="h-4 w-4 fill-sky-500/25 text-sky-500" />
    </span>
  );
}

function parseHunkHeader(line: string) {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (!match) return null;
  return { oldLine: Number(match[1]), newLine: Number(match[2]) };
}

function diffRows(file: ProjectRepoDiffFile): DiffRow[] {
  let oldLine = 0;
  let newLine = 0;
  return file.patch
    .trimEnd()
    .split("\n")
    .filter((line) => !line.startsWith("diff --git ") && !line.startsWith("index ") && !line.startsWith("--- ") && !line.startsWith("+++ "))
    .map((line, index) => {
      const hunk = parseHunkHeader(line);
      let row: Omit<DiffRow, "key">;
      if (hunk) {
        oldLine = hunk.oldLine;
        newLine = hunk.newLine;
        row = { content: line, oldLine: null, newLine: null, type: "hunk" };
      } else if (line.startsWith("+")) {
        row = { content: line.slice(1), oldLine: null, newLine: newLine++, type: "add" };
      } else if (line.startsWith("-")) {
        row = { content: line.slice(1), oldLine: oldLine++, newLine: null, type: "delete" };
      } else {
        row = { content: line.startsWith(" ") ? line.slice(1) : line, oldLine: oldLine++, newLine: newLine++, type: "context" };
      }
      // Rows are computed once per patch in source order, so a positional index is a stable key.
      return { ...row, key: `${file.path}:${index}` };
    });
}

function diffLineClassName(type: DiffRow["type"]) {
  if (type === "add") return "border-green-500/10 border-l-2 bg-green-500/10";
  if (type === "delete") return "border-destructive/10 border-l-2 bg-destructive/10";
  if (type === "hunk") return "bg-sky-500/10 text-sky-500";
  return "border-transparent border-l-2";
}

function linePrefix(type: DiffRow["type"]) {
  if (type === "add") return "+";
  if (type === "delete") return "-";
  return " ";
}

function commentAnchorForRow(file: ProjectRepoDiffFile, row: DiffRow): ProjectDiffAnchor | null {
  if (row.type === "hunk") return null;
  const side = row.type === "delete" ? "old" : "new";
  const line = side === "old" ? row.oldLine : row.newLine;
  return line ? { line, path: file.path, side } : null;
}

function anchorsEqual(left: ProjectDiffAnchor | null, right: ProjectDiffAnchor | null) {
  return Boolean(left && right && left.line === right.line && left.path === right.path && left.side === right.side);
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : null;
  if (!message) return null;
  // Backend errors can carry raw paths; strip absolute paths so the UI doesn't leak them.
  return message.replace(/(^|[\s'"`])(?:[A-Za-z]:)?[\\/][^\s'"`]+/g, "$1…");
}

function DiffPreview({ file, focusedAnchor, inlineComments }: {
  file: ProjectRepoDiffFile;
  focusedAnchor?: ProjectDiffAnchor | null;
  inlineComments?: InlineCommentControls;
}) {
  const t = useUiT();
  const rows = diffRows(file);
  const focusedRowRef = React.useRef<HTMLDivElement | null>(null);
  const [highlightedAnchor, setHighlightedAnchor] = React.useState<ProjectDiffAnchor | null>(null);

  React.useEffect(() => {
    if (!focusedAnchor || focusedAnchor.path !== file.path) {
      setHighlightedAnchor(null);
      return;
    }
    setHighlightedAnchor(focusedAnchor);
    let isListeningForInteraction = false;
    const clearHighlight = () => setHighlightedAnchor(null);
    const clearHighlightOnKeyDown = (event: KeyboardEvent) => {
      if (["Alt", "Control", "Meta", "Shift"].includes(event.key)) return;
      clearHighlight();
    };
    const frame = window.requestAnimationFrame(() => {
      focusedRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      focusedRowRef.current?.focus({ preventScroll: true });
      window.addEventListener("pointerdown", clearHighlight, true);
      window.addEventListener("keydown", clearHighlightOnKeyDown, true);
      isListeningForInteraction = true;
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (isListeningForInteraction) {
        window.removeEventListener("pointerdown", clearHighlight, true);
        window.removeEventListener("keydown", clearHighlightOnKeyDown, true);
      }
    };
  }, [file.path, focusedAnchor]);

  if (rows.length === 0) {
    return <div className="bg-muted/20 px-4 py-4 text-sm text-muted-foreground">{t("projects.git.noTextDiff")}</div>;
  }
  return (
    <div className="overflow-x-auto bg-background/70 font-mono text-xs leading-5" data-testid="project-diff-preview">
      {file.truncated ? (
        <div className="border-border/40 border-b bg-amber-500/10 px-4 py-2 text-amber-600 dark:text-amber-400" data-testid="project-diff-truncated">
          {t("projects.git.diffTruncated", { count: rows.length })}
        </div>
      ) : null}
      {rows.map((row) => {
        const anchor = commentAnchorForRow(file, row);
        const comments = anchor && inlineComments
          ? inlineComments.comments.filter((comment) => comment.anchor && anchorsEqual(comment.anchor, anchor)) : [];
        const isActive = anchorsEqual(inlineComments?.activeAnchor ?? null, anchor);
        const isFocused = anchorsEqual(highlightedAnchor, anchor);
        return (
          <React.Fragment key={row.key}>
            <div
              className={cn("group grid min-h-5 grid-cols-[3rem_3rem_2rem_1.5rem_minmax(0,1fr)]", diffLineClassName(row.type),
                isFocused && "bg-primary/10 ring-1 ring-primary/40 ring-inset")}
              data-line={anchor?.line}
              data-path={anchor?.path}
              data-side={anchor?.side}
              data-testid={isFocused ? "project-diff-focused-line" : anchor ? "project-diff-line" : undefined}
              ref={isFocused ? focusedRowRef : undefined}
              tabIndex={isFocused ? -1 : undefined}
            >
              <span className="select-none border-border/40 border-r px-2 text-right text-muted-foreground/70">{row.oldLine ?? " "}</span>
              <span className="select-none border-border/40 border-r px-2 text-right text-muted-foreground/70">{row.newLine ?? " "}</span>
              <span className="flex select-none items-center justify-center">
                {anchor && inlineComments ? (
                  <button
                    aria-label={t("projects.review.lineComment.commentOn", { path: anchor.path, side: anchor.side, line: anchor.line })}
                    className={cn("flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-primary hover:text-primary-foreground focus-visible:opacity-100 focus-visible:outline-hidden group-hover:opacity-100",
                      (comments.length > 0 || isActive) && "opacity-100")}
                    data-testid="project-diff-add-comment"
                    onClick={() => inlineComments.onStart(anchor)}
                    title={t("projects.review.lineComment.add")}
                    type="button"
                  >
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </span>
              <span className={cn("select-none px-2", row.type === "add" && "text-green-500", row.type === "delete" && "text-destructive")}>
                {linePrefix(row.type)}
              </span>
              <code className="min-w-0 whitespace-pre pr-3 text-foreground">{row.content || " "}</code>
            </div>
            {anchor && inlineComments ? (
              <ProjectPullRequestInlineCommentThread
                activeAnchor={isActive ? anchor : null}
                canRequestChanges={inlineComments.canRequestChanges}
                comments={comments}
                isSending={inlineComments.isSending}
                onCancel={inlineComments.onCancel}
                onSubmit={(...args) => inlineComments.onSubmit(anchor, ...args)}
                profiles={inlineComments.profiles}
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function FileTreeItems({ node, onSelect, selectedPath, depth = 0 }: {
  node: FileTreeNode;
  onSelect: (path: string) => void;
  selectedPath: string | null;
  depth?: number;
}): React.ReactNode {
  return sortedFileTreeChildren(node).map((child) => {
    if (child.file) {
      return (
        <button
          className={cn(
            "flex w-full min-w-0 items-center gap-2 py-1.5 pr-3 text-left text-xs text-muted-foreground hover:bg-muted/35 hover:text-foreground focus-visible:bg-muted/35 focus-visible:outline-hidden",
            selectedPath === child.file.path && "bg-muted/45 text-foreground",
          )}
          key={child.path}
          onClick={() => onSelect(child.file?.path ?? child.path)}
          style={{ paddingLeft: `${0.75 + depth * 0.9}rem` }}
          type="button"
        >
          <ChangedFileTreeIcon path={child.file.path} />
          <span className="min-w-0 flex-1 truncate">{child.name}</span>
        </button>
      );
    }
    return (
      <div key={child.path}>
        <div className="flex min-w-0 items-center gap-2 py-1.5 pr-3 text-xs font-medium text-muted-foreground" style={{ paddingLeft: `${0.75 + depth * 0.9}rem` }}>
          <ChangedFolderTreeIcon />
          <span className="min-w-0 flex-1 truncate">{child.name}</span>
        </div>
        <FileTreeItems depth={depth + 1} node={child} onSelect={onSelect} selectedPath={selectedPath} />
      </div>
    );
  });
}

/** What the review detail hands its Files changed body: the shown review, focus and line-comment controls. */
export type ReviewFilesChangedControls = {
  pullRequest: ProjectPullRequest;
  focusedAnchor?: ProjectDiffAnchor | null;
  inlineComments?: InlineCommentControls;
};

export function ProjectPullRequestFilesChangedPanel({ error, diff, focusedAnchor, inlineComments, isLoading, pullRequest }: {
  error: unknown;
  diff: ProjectRepoDiff | null | undefined;
  focusedAnchor?: ProjectDiffAnchor | null;
  /** Present when the review detail can publish line comments for this review. */
  inlineComments?: InlineCommentControls;
  isLoading: boolean;
  pullRequest: ProjectPullRequest | null;
}) {
  const t = useUiT();
  return (
    <ProjectDiffFilesPanel
      diff={pullRequest ? diff : null}
      embedded
      error={error}
      focusedAnchor={focusedAnchor}
      headerLabel={pullRequest ? `${pullRequest.title} · ${pullRequest.commit?.slice(0, 7) ?? t("projects.git.reviewLabel")}` : ""}
      inlineComments={pullRequest ? inlineComments : undefined}
      isLoading={isLoading}
      subject="review"
    />
  );
}

export function ProjectDiffFilesPanel({ className, error, diff, fileTreeClassName, isLoading, embedded = false, focusedAnchor, headerLabel, inlineComments, subject }: {
  /** Extra classes for the file-tree/diff grid container. */
  className?: string;
  /** Overrides the file tree's default `max-h-96` cap, e.g. for full-height layouts. */
  fileTreeClassName?: string;
  error: unknown;
  diff: ProjectRepoDiff | null | undefined;
  isLoading: boolean;
  /** Render without an outer border, for nesting inside an existing card. */
  embedded?: boolean;
  focusedAnchor?: ProjectDiffAnchor | null;
  headerLabel: string;
  inlineComments?: InlineCommentControls;
  subject: "review" | "commit";
}) {
  const t = useUiT();
  const outerBorderClass = embedded ? "" : PROJECT_DETAIL_PANEL_CLASS;
  const [query, setQuery] = React.useState("");
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const files = React.useMemo(() => diff?.files ?? [], [diff]);
  const filteredFiles = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return files;
    return files.filter((file) => file.path.toLowerCase().includes(normalizedQuery));
  }, [files, query]);
  const stats = { additions: diff?.additions ?? 0, deletions: diff?.deletions ?? 0 };
  const fileTree = React.useMemo(() => buildFileTree(filteredFiles), [filteredFiles]);
  const selectedFile = filteredFiles.find((file) => file.path === selectedPath) ?? filteredFiles[0] ?? null;

  React.useEffect(() => {
    if (!focusedAnchor) return;
    setQuery("");
    setSelectedPath(focusedAnchor.path);
  }, [focusedAnchor]);

  React.useEffect(() => {
    const first = filteredFiles[0];
    if (!first) {
      setSelectedPath(null);
      return;
    }
    if (!selectedPath || !filteredFiles.some((file) => file.path === selectedPath)) setSelectedPath(first.path);
  }, [filteredFiles, selectedPath]);

  if (isLoading && !diff) return <BuzzLoadingState label={t("projects.git.loadingChangedFiles")} />;

  if (error && !diff) {
    const message = errorMessage(error);
    return (
      <div className={cn("space-y-1 p-4 text-sm text-muted-foreground", outerBorderClass)} data-project-detail-panel={embedded ? undefined : true}
        data-testid="project-diff-error">
        <p>{t(subject === "review" ? "projects.git.changedFilesErrorReview" : "projects.git.changedFilesErrorCommit")}</p>
        {message ? <p className="font-mono text-xs text-muted-foreground/80">{message}</p> : null}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className={cn("p-6 text-center text-sm text-muted-foreground", outerBorderClass)} data-project-detail-panel={embedded ? undefined : true}
        data-testid="project-diff-empty">
        {t(subject === "review" ? "projects.git.noChangedFilesReview" : "projects.git.noChangedFilesCommit")}
      </div>
    );
  }

  return (
    <div className={cn("grid min-h-0 overflow-hidden lg:grid-cols-[17rem_minmax(0,1fr)]", outerBorderClass, className)}
      data-project-detail-panel={embedded ? undefined : true} data-testid="project-diff-files">
      <aside className="border-border/50 border-b bg-background/30 lg:border-r lg:border-b-0">
        <div className="space-y-3 p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Files className="h-3.5 w-3.5" />
            <span>{t("projects.git.changedFilesCount", { count: files.length })}</span>
          </div>
          <label className="flex h-8 items-center gap-2 border border-border/60 bg-background/70 px-2 text-xs text-muted-foreground">
            <Search className="h-3.5 w-3.5" />
            <input className="min-w-0 flex-1 bg-transparent text-foreground outline-hidden placeholder:text-muted-foreground"
              onChange={(event) => setQuery(event.currentTarget.value)} placeholder={t("projects.git.filterFiles")} value={query} />
          </label>
        </div>
        <nav className={cn("max-h-96 overflow-auto border-border/50 border-t py-1", fileTreeClassName)}>
          <FileTreeItems node={fileTree} onSelect={setSelectedPath} selectedPath={selectedPath} />
        </nav>
      </aside>

      <section className="min-w-0">
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-border/50 border-b bg-background/30 px-4 py-2 text-xs text-muted-foreground">
          <div className="flex min-w-0 items-center gap-2">
            <GitCommitHorizontal className="h-3.5 w-3.5" />
            <span className="truncate">{headerLabel}</span>
          </div>
          <div className="flex items-center gap-3">
            <span>{t("projects.git.filesChangedCount", { count: files.length })}</span>
            <span className="text-green-500">+{stats.additions}</span>
            <span className="text-destructive">-{stats.deletions}</span>
          </div>
        </div>

        <div className="p-3">
          {selectedFile ? (
            <article className="overflow-hidden border border-border/60 bg-background/45" data-testid="project-diff-file">
              <header className="flex min-h-10 items-center justify-between gap-3 border-border/50 border-b bg-muted/20 px-3 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <FileDiff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium text-foreground">{fileName(selectedFile.path)}</span>
                  {directoryName(selectedFile.path) ? <span className="truncate text-muted-foreground">{directoryName(selectedFile.path)}</span> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
                  <span className={cn(selectedFile.additions > 0 && "text-green-500")}>+{selectedFile.additions}</span>
                  <span className="text-destructive">-{selectedFile.deletions}</span>
                </div>
              </header>
              <DiffPreview file={selectedFile} focusedAnchor={focusedAnchor} inlineComments={inlineComments} />
            </article>
          ) : (
            <div className="border border-border/60 bg-background/45 p-4 text-sm text-muted-foreground">{t("projects.git.noFilterMatch")}</div>
          )}
        </div>
      </section>
    </div>
  );
}
