// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/ProjectReadmePanel.tsx and ProjectOverviewPanel.tsx. Same README
// discovery, HTML normalization, loading/empty/unavailable states and rendering; Markdown goes
// through the host renderer like other project rich content. External-host, clone and Agent-chat
// branches need consumers this host does not have and are not rendered.
import { BookOpen } from "lucide-react";
import { useUiT } from "../context";
import { BuzzLoadingState } from "./BuzzLoadingState";
import { ProjectPanelState } from "./ProjectPanelState";
import { baseName, languageForPath } from "./ProjectRepositoryPanel";
import { ProjectRepositoryUnavailableState } from "./ProjectRepositoryUnavailableState";
import { ProjectRichContent } from "./ProjectRichContent";
import { ProjectSyntaxCode } from "./ProjectSyntaxCode";
import type { ProjectRepoFile } from "./projectGit";
import type { ProjectRepoUnavailableReason } from "./lib/projectRepoAvailability";
import { formatLastChangedAt } from "./lib/projectsViewHelpers";
import { type RepositoryFileContentSource, useRepositoryFileContent } from "./useRepositoryFileContent";

export type GitDataState = "checking" | "available" | "empty" | "unavailable";

export function findReadmeFile(files: ProjectRepoFile[]) {
  const readmes = files.filter((file) => /^readme(?:\.(?:md|markdown|mdx|txt))?$/i.test(baseName(file.path)));
  return readmes.find((file) => !file.path.includes("/")) ?? readmes[0] ?? null;
}

function decodeHtmlEntities(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function htmlInlineToMarkdown(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<img\b([^>]*)>/gi, (_match: string, attrs: string) => {
      const src = attrs.match(/\bsrc=["']([^"']+)["']/i)?.[1];
      const alt = attrs.match(/\balt=["']([^"']*)["']/i)?.[1] ?? "";
      return src ? `![${alt}](${src})` : "";
    })
    .replace(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_match: string, href: string, label: string) => `[${htmlInlineToMarkdown(label).trim()}](${href})`)
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<sub\b[^>]*>([\s\S]*?)<\/sub>/gi, "$1")
    .replace(/<span\b[^>]*>([\s\S]*?)<\/span>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function normalizeReadmeMarkdown(content: string) {
  return content
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_match, depth: string, value: string) => `${"#".repeat(Number(depth))} ${htmlInlineToMarkdown(value)}\n\n`)
    .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_match, value: string) => `${htmlInlineToMarkdown(value)}\n\n`)
    .replace(/<div\b[^>]*>([\s\S]*?)<\/div>/gi, (_match, value: string) => `${htmlInlineToMarkdown(value)}\n\n`)
    .replace(/<center\b[^>]*>([\s\S]*?)<\/center>/gi, (_match, value: string) => `${htmlInlineToMarkdown(value)}\n\n`)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function ReadmePanel({ file, fileContentSource, gitDataState, hideHeader, unavailableReason, onRetry, retryPending }: {
  file: ProjectRepoFile | null;
  fileContentSource?: RepositoryFileContentSource;
  gitDataState: GitDataState;
  /** Skip the header rows entirely — the workspace layout renders them itself. */
  hideHeader?: boolean;
  unavailableReason?: ProjectRepoUnavailableReason;
  /** Original unavailable-state Retry delegates to the repository Fetch. */
  onRetry?: () => void;
  retryPending?: boolean;
}) {
  const t = useUiT();
  const fileContent = useRepositoryFileContent(file, fileContentSource);
  const header = hideHeader ? null : (
    <div className="flex min-h-10 items-center gap-2 border-border/50 border-b bg-muted/20 px-4">
      <BookOpen className="h-4 w-4 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{file ? baseName(file.path) : "README"}</span>
      {file ? (
        <span className="hidden shrink-0 text-2xs text-muted-foreground sm:block">
          {t("projects.git.lastChanged", { time: formatLastChangedAt(file.lastChangedAt) })}
        </span>
      ) : null}
    </div>
  );

  if (gitDataState === "checking") {
    return (
      <section className="overflow-hidden">
        {header}
        <BuzzLoadingState label={t("projects.git.loadingRepository")} />
      </section>
    );
  }
  if (gitDataState === "unavailable") {
    return (
      <section className="overflow-hidden">
        <ProjectRepositoryUnavailableState reason={unavailableReason} onRetry={onRetry} retryPending={retryPending} />
      </section>
    );
  }
  if (fileContent.isLoading) {
    return (
      <section className="overflow-hidden">
        {header}
        <BuzzLoadingState label={t("projects.git.loadingReadme")} />
      </section>
    );
  }
  if (!file || !fileContent.content) {
    const loadError = Boolean(fileContent.error);
    const emptyRepository = gitDataState === "empty";
    return (
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="project-readme-empty">
        {header}
        <ProjectPanelState
          description={t(loadError ? "projects.git.readmeErrorHint" : emptyRepository ? "projects.git.emptyRepositoryHint" : "projects.git.noReadmeHint")}
          error={loadError}
          panel={false}
          title={t(loadError ? "projects.git.readmeError" : emptyRepository ? "projects.git.emptyRepository" : "projects.git.noReadme")}
        />
      </section>
    );
  }

  const language = languageForPath(file.path);
  const isMarkdown = /\.(?:md|markdown|mdx)$/i.test(file.path);
  const readmeContent = isMarkdown ? normalizeReadmeMarkdown(fileContent.content) : fileContent.content;
  return (
    <section className="overflow-hidden" data-testid="project-readme">
      {header}
      <div className="min-w-0 px-8 py-6">
        {isMarkdown ? (
          <ProjectRichContent className="text-sm" content={readmeContent} />
        ) : language ? (
          <pre className="overflow-x-auto bg-muted/40 p-4">
            <ProjectSyntaxCode className="text-xs leading-relaxed" code={fileContent.content} language={language} />
          </pre>
        ) : (
          <pre className="overflow-x-auto bg-muted/40 p-4">
            <code className="block min-w-full whitespace-pre font-mono text-xs leading-relaxed text-foreground">{fileContent.content}</code>
          </pre>
        )}
      </div>
    </section>
  );
}

/** Original ProjectOverviewPanel: the repository workspace's README column. */
export function ProjectOverviewPanel(props: Parameters<typeof ReadmePanel>[0]) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ReadmePanel {...props} />
    </div>
  );
}
