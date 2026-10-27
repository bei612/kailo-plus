// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/useRepositoryFilesNavigation.ts, unchanged.
import * as React from "react";
import type { ProjectRepoFile } from "./projectGit";

export type RepositoryFilesContext = {
  kind: "file" | "folder";
  onBack?: () => void;
  path: string;
};

export function useRepositoryFilesNavigation({
  files,
  initialPath,
  onContextChange,
  pageSize,
}: {
  files: ProjectRepoFile[];
  initialPath?: string;
  onContextChange?: (context: RepositoryFilesContext) => void;
  pageSize: number;
}) {
  const [currentPath, setCurrentPath] = React.useState("");
  const [selectedFile, setSelectedFile] = React.useState<ProjectRepoFile | null>(null);
  const [visibleEntryCount, setVisibleEntryCount] = React.useState(pageSize);
  const openPath = React.useCallback(
    (path: string) => {
      setCurrentPath(path);
      setSelectedFile(null);
      setVisibleEntryCount(pageSize);
    },
    [pageSize],
  );
  const contextBack = React.useMemo(() => {
    if (selectedFile) return () => setSelectedFile(null);
    if (!currentPath) return undefined;
    return () => {
      const segments = currentPath.split("/");
      openPath(segments.slice(0, -1).join("/"));
    };
  }, [currentPath, openPath, selectedFile]);

  React.useEffect(() => {
    onContextChange?.({
      kind: selectedFile ? "file" : "folder",
      onBack: contextBack,
      path: selectedFile?.path ?? currentPath,
    });
  }, [contextBack, currentPath, onContextChange, selectedFile]);

  const filesKey = React.useMemo(() => files.map((file) => file.path).join("\0"), [files]);
  const initialFile = React.useMemo(
    () => (initialPath ? (files.find((file) => file.path === initialPath) ?? null) : null),
    [files, initialPath],
  );
  React.useEffect(() => {
    if (!filesKey) return;
    const initialDirectory = initialFile
      ? initialFile.path.split("/").slice(0, -1).join("/")
      : (initialPath ?? "");
    setCurrentPath(initialDirectory);
    setSelectedFile(initialFile);
    setVisibleEntryCount(pageSize);
  }, [filesKey, initialFile, initialPath, pageSize]);

  return {
    currentPath,
    openPath,
    // A ref refresh can retain every path while changing its preview bytes.
    // Keep the selected path, but always render the current snapshot row.
    selectedFile: selectedFile ? files.find(file => file.path === selectedFile.path) ?? null : null,
    setSelectedFile,
    setVisibleEntryCount,
    visibleEntryCount,
  };
}
