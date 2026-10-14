import { createFileRoute, notFound, useBlocker } from "@tanstack/react-router";
import { useState } from "react";
import { usePreviewFeatureWarning } from "@client-kit/platform/react/features";
import { translate, resolveLocale } from "@client-kit/platform/i18n";
import {
  ApprovalsPage,
  TasksPage,
} from "@client-kit/platform/react/governance";
import { WorkflowsPage, workflowBlocksNavigation, type WorkflowNavigation, type WorkflowNavigationState, type WorkflowRoute } from "@client-kit/platform/react/workflows";
import { UserProfilePopover } from "@/features/profile/ui/UserProfilePopover";
import {
  AuditPage,
  DevicesPage,
  WorkspaceMembersPage,
} from "@client-kit/platform/react/pages";
import { BusinessOperationsPage, UsageBillingPage } from "@client-kit/platform/react/business-observability";

import {
  isPlatformSection,
  PLATFORM_SECTION_LABEL,
  type PlatformSection,
} from "@/features/platform/platformSections";
import { useNativeSession } from "@/features/platform/activeCommunity";
import { PulseScreen } from "@/features/platform/PulseScreen";
import { ProjectsScreen } from "@/features/platform/ProjectsScreen";
import { AgentDefinitionsPane } from "@/features/platform/AgentDefinitionsPane";
import { desktopWorkflowMessageHost } from "@/features/platform/workflowMessageHost";

export const Route = createFileRoute("/platform/$section")({
  validateSearch: (search: Record<string, unknown>): { workspaceId?: string; projectId?: string;repositoryId?:string;issueId?:string;pullRequestId?:string;tab?:string } => ({
    workspaceId: typeof search.workspaceId === "string" && search.workspaceId.trim()
      ? search.workspaceId : undefined,
    projectId: typeof search.projectId === "string" && search.projectId.trim() ? search.projectId : undefined,
    repositoryId: typeof search.repositoryId === "string" && search.repositoryId.trim() ? search.repositoryId : undefined,
    issueId: typeof search.issueId === "string" && search.issueId.trim() ? search.issueId : undefined,
    pullRequestId: typeof search.pullRequestId === "string" && search.pullRequestId.trim() ? search.pullRequestId : undefined,
    tab: typeof search.tab === "string" && search.tab.trim() ? search.tab : undefined,
  }),
  params: {
    parse: ({ section }) => {
      if (!isPlatformSection(section)) throw notFound();
      return { section };
    },
    stringify: ({ section }) => ({ section }),
  },
  component: PlatformRouteComponent,
});

/**
 * 平台页：与 Buzz Web 渲染的是同一份组件（共用包，ADR-09），数据经
 * Rust 侧的 `platform_api` 到 BFF。本机设备在设备页里被标出。
 */
function PlatformRouteComponent() {
  const { section } = Route.useParams();
  usePreviewFeatureWarning(section);
  const { workspaceId, projectId,repositoryId,issueId,pullRequestId,tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [workflowNavigationState, setWorkflowNavigationState] = useState<WorkflowNavigationState>({ dirty: false, locked: false });
  const workflowBlocker = useBlocker({
    shouldBlockFn: ({ current, next }) => workflowBlocksNavigation(workflowNavigationState, current, next),
    withResolver: true,
    enableBeforeUnload: false,
  });
  return <PlatformScreen section={section} workspaceId={workspaceId} projectId={projectId}
    workItemTarget={{repositoryId,issueId,pullRequestId,tab}}
    workflowNavigation={{ blocker: workflowBlocker, onStateChange: setWorkflowNavigationState }}
    onProjectChange={(id,target)=>navigate({search:{projectId:id??undefined,...target}})}
    onWorkspaceChange={(selected) => { void navigate({ search: { workspaceId: selected } }); }}
    onWorkflowRouteChange={(route) => {
      if (route) void navigate({ to: "/platform/workflows/$workflowId", params: { workflowId: route.workflowId },
        search: { workspaceId: route.workspaceId, view: route.view } });
    }} />;
}

export function PlatformScreen({ section, workspaceId, onWorkspaceChange, projectId, onProjectChange, workflowNavigation,workItemTarget,
  workflowRoute, onWorkflowRouteChange }: {
  section: PlatformSection; workspaceId?: string; onWorkspaceChange: (workspaceId: string) => void;
  workflowRoute?: WorkflowRoute | null; onWorkflowRouteChange?: (route: WorkflowRoute | null, workspaceId?: string) => void;
  projectId?:string;onProjectChange:(id:string|null,target?:import("@client-kit/platform/react/projects").ProjectWorkItemTarget)=>void|Promise<void>;
  workItemTarget:import("@client-kit/platform/react/projects").ProjectWorkItemTarget;
  workflowNavigation: WorkflowNavigation;
}) {
  const session = useNativeSession();
  if (section === "pulse") return <PulseScreen />;
  if (section === "projects") return <ProjectsScreen selectedProjectId={projectId??null} onSelectedProjectChange={onProjectChange} workItemTarget={workItemTarget}/>;
  if (section === "agents") return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="platform-agents">
      <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
        <AgentDefinitionsPane workspaceId={workspaceId} onWorkspaceChange={onWorkspaceChange} />
      </div>
    </div>
  );
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-auto px-6 pb-6 pt-14"
      data-testid={`platform-${section}`}
    >
      <h1 className="mb-4 text-lg font-semibold">
        {translate(resolveLocale(), PLATFORM_SECTION_LABEL[section])}
      </h1>
      {section === "members" ? (
        <WorkspaceMembersPage renderIdentity={(pubkey,children,label)=><UserProfilePopover pubkey={pubkey}
          triggerElement="span" triggerAriaLabel={label}>{children}</UserProfilePopover>}/>
      ) : section === "workflows" ? (
        <WorkflowsPage workspaceId={workspaceId} onWorkspaceChange={onWorkspaceChange} workflowNavigation={workflowNavigation}
          messageHost={desktopWorkflowMessageHost} workflowRoute={workflowRoute} onWorkflowRouteChange={onWorkflowRouteChange} />
      ) : section === "tasks" ? (
        <TasksPage />
      ) : section === "approvals" ? (
        <ApprovalsPage />
      ) : section === "usage" ? (
        <UsageBillingPage />
      ) : section === "operations" ? (
        <BusinessOperationsPage />
      ) : section === "audit" ? (
        <AuditPage />
      ) : (
        <DevicesPage currentDevicePubkey={session.devicePubkey} />
      )}
    </div>
  );
}
