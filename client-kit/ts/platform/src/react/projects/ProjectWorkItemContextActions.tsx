// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/ProjectWorkItemContextActions.tsx.
// Original Task branch; PR reviewer and managed-owner consumers remain absent.
import type { ComponentProps } from "react";
import { IssueAssigneesRow } from "./IssueAssigneesRow";

export function ProjectWorkItemContextActions(props:ComponentProps<typeof IssueAssigneesRow>) {
  if(!props.viewerPubkey)return null;
  return <div data-testid="project-context-task-assignment">
    <IssueAssigneesRow {...props} contextActions showAssignees={false} showSelfAssignmentState testIdPrefix="project-context-issue"/>
  </div>;
}
