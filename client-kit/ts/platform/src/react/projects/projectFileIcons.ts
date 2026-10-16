// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/
// ProjectRepositoryPanel.tsx::fileIconVisual and ProjectPullRequestFilesChangedPanel.tsx::
// changedFileIconVisual. Same order, classes and extension sets; the two originals differ only in
// the code set (`h`/`hpp`) and image set (`heic` vs `avif`), kept per caller.
import {
  Braces, CodeXml, Database, FileArchive, FileAudio, FileCode2, FileCog, FileImage, FileJson, FileLock2,
  FileSpreadsheet, FileText, FileType, FileVideo, FolderGit2, Package, Settings, Terminal, type LucideIcon,
} from "lucide-react";

export type FileIconVisual = { Icon: LucideIcon; className: string; containerClassName: string };

const CODE = ["c", "cc", "cpp", "cs", "dart", "go", "java", "js", "jsx", "kt", "kts", "mjs", "mts", "py", "rb", "rs", "swift", "ts", "tsx", "zig"];
const REPOSITORY_CODE_EXTENSIONS = new Set(CODE);
const CHANGED_CODE_EXTENSIONS = new Set([...CODE, "h", "hpp"]);
const REPOSITORY_IMAGE_EXTENSIONS = new Set(["gif", "heic", "jpeg", "jpg", "png", "svg", "webp"]);
const CHANGED_IMAGE_EXTENSIONS = new Set(["avif", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const ARCHIVE_EXTENSIONS = new Set(["7z", "bz2", "gz", "rar", "tar", "tgz", "zip"]);
const AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "ogg", "wav"]);
const VIDEO_EXTENSIONS = new Set(["avi", "m4v", "mov", "mp4", "webm"]);
const SPREADSHEET_EXTENSIONS = new Set(["csv", "ods", "tsv", "xls", "xlsx"]);
const TEXT_EXTENSIONS = new Set(["md", "mdx", "rst", "txt"]);

export function fileBaseName(path: string) {
  return path.split("/").pop() || path;
}

function extensionForPath(path: string) {
  const name = fileBaseName(path).toLowerCase();
  if (!name.includes(".")) return "";
  return name.split(".").pop() ?? "";
}

export const DIRECTORY_ICON_VISUAL: FileIconVisual = { Icon: FolderGit2, className: "fill-sky-500/25 text-sky-500", containerClassName: "bg-sky-500/15" };

function visualForFile(path: string, code: Set<string>, images: Set<string>): FileIconVisual {
  const name = fileBaseName(path).toLowerCase();
  const extension = extensionForPath(path);
  if (name === "dockerfile" || name === "containerfile" || name === "package.json")
    return { Icon: Package, className: "fill-orange-500/20 text-orange-500", containerClassName: "bg-orange-500/15" };
  if (name.includes("lock") || extension === "pem" || extension === "key")
    return { Icon: FileLock2, className: "fill-amber-500/20 text-amber-500", containerClassName: "bg-amber-500/15" };
  if (extension === "json")
    return { Icon: FileJson, className: "fill-yellow-500/20 text-yellow-500", containerClassName: "bg-yellow-500/15" };
  if (["yaml", "yml", "toml", "ini", "conf", "config", "env"].includes(extension))
    return { Icon: Settings, className: "fill-zinc-500/20 text-zinc-500", containerClassName: "bg-zinc-500/15" };
  if (["html", "xml"].includes(extension))
    return { Icon: CodeXml, className: "fill-rose-500/20 text-rose-500", containerClassName: "bg-rose-500/15" };
  if (extension === "css")
    return { Icon: Braces, className: "fill-violet-500/20 text-violet-500", containerClassName: "bg-violet-500/15" };
  if (code.has(extension))
    return { Icon: FileCode2, className: "fill-blue-500/20 text-blue-500", containerClassName: "bg-blue-500/15" };
  if (images.has(extension))
    return { Icon: FileImage, className: "fill-pink-500/20 text-pink-500", containerClassName: "bg-pink-500/15" };
  if (ARCHIVE_EXTENSIONS.has(extension))
    return { Icon: FileArchive, className: "fill-orange-500/20 text-orange-500", containerClassName: "bg-orange-500/15" };
  if (AUDIO_EXTENSIONS.has(extension))
    return { Icon: FileAudio, className: "fill-purple-500/20 text-purple-500", containerClassName: "bg-purple-500/15" };
  if (VIDEO_EXTENSIONS.has(extension))
    return { Icon: FileVideo, className: "fill-red-500/20 text-red-500", containerClassName: "bg-red-500/15" };
  if (SPREADSHEET_EXTENSIONS.has(extension))
    return { Icon: FileSpreadsheet, className: "fill-emerald-500/20 text-emerald-500", containerClassName: "bg-emerald-500/15" };
  if (extension === "sql" || extension === "db" || extension === "sqlite")
    return { Icon: Database, className: "fill-cyan-500/20 text-cyan-500", containerClassName: "bg-cyan-500/15" };
  if (["bash", "fish", "sh", "zsh"].includes(extension))
    return { Icon: Terminal, className: "fill-lime-500/20 text-lime-500", containerClassName: "bg-lime-500/15" };
  if (TEXT_EXTENSIONS.has(extension))
    return { Icon: FileText, className: "fill-slate-500/20 text-slate-500", containerClassName: "bg-slate-500/15" };
  if (extension === "pdf")
    return { Icon: FileType, className: "fill-red-500/20 text-red-500", containerClassName: "bg-red-500/15" };
  return { Icon: FileCog, className: "fill-muted-foreground/20 text-muted-foreground", containerClassName: "bg-muted/70" };
}

export function repositoryFileIconVisual(path: string) {
  return visualForFile(path, REPOSITORY_CODE_EXTENSIONS, REPOSITORY_IMAGE_EXTENSIONS);
}

export function changedFileIconVisual(path: string) {
  return visualForFile(path, CHANGED_CODE_EXTENSIONS, CHANGED_IMAGE_EXTENSIONS);
}
