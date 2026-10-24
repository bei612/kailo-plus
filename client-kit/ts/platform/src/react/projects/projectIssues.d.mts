import type { PulseEvent as RelayEvent } from "../pulse/host";

export type ProjectIssueStatus =
  | "Triage"
  | "Backlog"
  | "In Progress"
  | "In Review"
  | "Done"
  | "Closed";

export type ProjectTaskCategory = "issue" | "change-request" | "improvement";

/** DD-157(8): a labeled assignment comment's `t` operation and `p` assignees. */
export type ProjectIssueCommentAssignment = {
  operation: "assign" | "unassign";
  assignees: string[];
};

export type ProjectIssueComment = {
  id: string;
  content: string;
  tags: string[][];
  author: string;
  createdAt: number;
  /** Absent on comments built outside the reducer (optimistic rows, fixtures). */
  assignment?: ProjectIssueCommentAssignment | null;
};

export type ProjectIssue = {
  id: string;
  title: string;
  content: string;
  tags: string[][];
  author: string;
  createdAt: number;
  repoAddress: string | null;
  channelId: string | null;
  originAgentName: string | null;
  labels: string[];
  category: ProjectTaskCategory;
  recipients: string[];
  assignees: string[];
  assigneeOperationHeads: Record<string, string>;
  status: ProjectIssueStatus;
  statusEventId: string | null;
  updatedAt: number;
  comments: ProjectIssueComment[];
};

export const ISSUE_ASSIGNMENT_LABEL: "assignment";
export const ISSUE_UNASSIGNMENT_LABEL: "unassignment";

export const PROJECT_ISSUE_STATUS: {
  TRIAGE: "Triage";
  BACKLOG: "Backlog";
  IN_PROGRESS: "In Progress";
  IN_REVIEW: "In Review";
  DONE: "Done";
  CLOSED: "Closed";
};

export function getTag(event: RelayEvent, name: string): string | undefined;
export function getAllTags(event: RelayEvent, name: string): string[];
export function getImetaTags(event: RelayEvent): string[][];
export function eventToProjectIssue(
  issue: RelayEvent,
  statusEvents?: RelayEvent[],
  commentEvents?: RelayEvent[],
): ProjectIssue;
export function projectIssueEventsToIssues(
  issueEvents: RelayEvent[],
  statusEvents?: RelayEvent[],
  commentEvents?: RelayEvent[],
): ProjectIssue[];
export function nextProjectIssueCommentCreatedAt(
  issue: ProjectIssue,
  now: number,
  author: string,
): number;
export function buildGitIssueTags(input: {
  repoAddress: string;
  repoOwner: string;
  title: string;
  labels?: string[];
}): string[][];
export function buildGitStatusTags(input: {
  issueId: string;
  repoAddress?: string | null;
  repoOwner?: string | null;
}): string[][];
