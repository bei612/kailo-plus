// Called presentation helpers from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/lib/projectsViewHelpers.ts. No access decision
// or missing Git activity producer is migrated into this presentation module.
import { getLocale, platformTimeSeconds, translate, type PlatformLocale } from "../../../i18n";
import type {ProjectsFilter} from "../ProjectsToolbar";
import type {Project} from "../projectModels";
import {normalizePubkey} from "../../conversations/pubkey";
import type {ProjectActivitySummary} from "./projectActivitySummaries";
export type ProjectsViewMode = "grid" | "list";
export type ProjectsSort = "updated" | "created" | "name";
export function formatExactTimestamp(createdAt: number) {
  return new Date(createdAt * 1_000).toLocaleString(getLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}
const PROJECTS_VIEW_MODE_STORAGE_KEY = "buzz.projects.viewMode";
const PROJECTS_FILTER_STORAGE_KEY = "buzz.projects.filter";
const PROJECTS_SORT_STORAGE_KEY = "buzz.projects.sort";

export function readStoredSort(): ProjectsSort {
  try {
    const value = globalThis.localStorage?.getItem(PROJECTS_SORT_STORAGE_KEY);
    return value === "created" || value === "name" ? value : "updated";
  } catch {
    return "updated";
  }
}

export function writeStoredSort(sort: ProjectsSort) {
  try {
    globalThis.localStorage?.setItem(PROJECTS_SORT_STORAGE_KEY, sort);
  } catch {
    // Persistence is best-effort; the in-memory toggle still works.
  }
}
export function readStoredFilter():ProjectsFilter {
  try {
    const value=globalThis.localStorage?.getItem(PROJECTS_FILTER_STORAGE_KEY);
    // Original default is Activity.
    return value==="projects"||value==="repositories"||value==="channels"||value==="issues"||value==="prs"?value:"all";
  } catch {return "all";}
}
export function writeStoredFilter(filter:ProjectsFilter) {
  try {globalThis.localStorage?.setItem(PROJECTS_FILTER_STORAGE_KEY,filter);}
  catch { /* Persistence is best-effort; the in-memory toggle still works. */ }
}

export function readStoredViewMode(): ProjectsViewMode | null {
  try {
    const value = globalThis.localStorage?.getItem(PROJECTS_VIEW_MODE_STORAGE_KEY);
    return value === "grid" || value === "list" ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredViewMode(viewMode: ProjectsViewMode) {
  try {
    globalThis.localStorage?.setItem(PROJECTS_VIEW_MODE_STORAGE_KEY, viewMode);
  } catch {
    // Persistence is best-effort; the in-memory toggle still works.
  }
}

export function markdownToPlainText(input: string): string {
  return input
    .replace(/```[^\n]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])[ \t]+/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/([*_])(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

export function listRowDescription(
  value: string | null | undefined,
  title?: string,
): string | undefined {
  const text = markdownToPlainText(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length === 0) return undefined;
  if (title && text.localeCompare(title.trim(), undefined, { sensitivity: "accent" }) === 0) {
    return undefined;
  }
  return text;
}

// Original relativeTime: floor/clamp elapsed time and switch to a calendar date
// after seven days. The existing catalog supplies Chinese/English wording.
export function relativeTime(createdAt:number,nowSeconds=Math.floor(Date.now()/1_000),locale:PlatformLocale=getLocale()) {
  const elapsedSeconds=Math.max(1,Math.floor(nowSeconds-createdAt));
  const units=[
    {label:"day",seconds:platformTimeSeconds.day},
    {label:"hour",seconds:platformTimeSeconds.hour},
    {label:"minute",seconds:platformTimeSeconds.minute},
    {label:"second",seconds:1},
  ] as const;
  if(elapsedSeconds>=7*platformTimeSeconds.day){
    const createdDate=new Date(createdAt*1_000),nowDate=new Date(nowSeconds*1_000);
    return createdDate.toLocaleDateString(locale,{month:"short",day:"numeric",
      ...(createdDate.getFullYear()===nowDate.getFullYear()?{}:{year:"numeric"})});
  }
  for(const unit of units){
    const value=Math.floor(elapsedSeconds/unit.seconds);
    if(value>=1){
      if(unit.label==="day"&&value===1)return translate(locale,"projects.time.oneDay",{count:value});
      return translate(locale,`platform.time.past.${unit.label}.${value===1?"one":"other"}`,{count:value});
    }
  }
  return translate(locale,"platform.time.now");
}

// Original projectsViewHelpers.ts::projectPeople, getProjectUpdatedAt and
// isProjectMine, unchanged.
export function projectPeople(
  project: Project,
  summary?: ProjectActivitySummary,
): string[] {
  return [
    ...new Set(
      [
        project.owner,
        ...project.repositories.flatMap((repository) => [
          repository.owner,
          ...repository.contributors,
        ]),
        ...(summary?.participantPubkeys ?? []),
      ].map(normalizePubkey),
    ),
  ];
}

export function getProjectUpdatedAt(
  project: Project,
  summary: ProjectActivitySummary | undefined,
) {
  // A summary with no recorded activity has `updatedAt: 0` — fall back to
  // the announcement's creation time rather than rendering the Unix epoch.
  return summary?.updatedAt || project.createdAt;
}

export function isProjectMine(
  project: Project,
  currentPubkey: string | undefined,
) {
  if (!currentPubkey) return false;
  const normalizedCurrentPubkey = normalizePubkey(currentPubkey);
  return (
    normalizePubkey(project.owner) === normalizedCurrentPubkey ||
    project.repositories.some(
      (repository) =>
        normalizePubkey(repository.owner) === normalizedCurrentPubkey ||
        repository.contributors.some(
          (pubkey) => normalizePubkey(pubkey) === normalizedCurrentPubkey,
        ),
    )
  );
}
