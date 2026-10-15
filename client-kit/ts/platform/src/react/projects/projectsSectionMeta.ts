// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/ui/projectsSectionMeta.ts::projectsSectionTitle
// and projectsSectionIcon. Titles resolve through the shared catalog.
import {
  CircleDot,
  FolderGit2,
  Folders,
  GitPullRequest,
  Hash,
  type LucideIcon,
} from "lucide-react";

import type { PlatformMessageKey } from "../../i18n";
import type { ProjectsFilter } from "./ProjectsToolbar";

export function projectsSectionTitleKey(filter: ProjectsFilter): PlatformMessageKey {
  if (filter === "all") return "projects.section.activity";
  if (filter === "prs") return "projects.list.reviews";
  if (filter === "issues") return "projects.list.tasks";
  if (filter === "repositories") return "projects.section.repositories";
  if (filter === "channels") return "sidebar.channels";
  return "platform.tab.projects";
}

export function projectsSectionIcon(filter: ProjectsFilter): LucideIcon {
  if (filter === "prs") return GitPullRequest;
  if (filter === "issues") return CircleDot;
  if (filter === "repositories") return FolderGit2;
  if (filter === "channels") return Hash;
  return Folders;
}
