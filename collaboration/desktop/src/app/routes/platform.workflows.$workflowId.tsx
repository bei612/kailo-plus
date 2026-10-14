import { createFileRoute, useBlocker } from "@tanstack/react-router";
import { useState } from "react";
import { usePreviewFeatureWarning } from "@client-kit/platform/react/features";
import { workflowBlocksNavigation, type WorkflowNavigationState } from "@client-kit/platform/react/workflows";
import { PlatformScreen } from "./platform.$section";

// Buzz 779af8886caae1317b4de962082429867ab61503 app/routes/workflows.$workflowId.tsx:
// the URL-addressable workflow target in the same shared Workflows page. The
// shared page proves it through the existing authorized automation read.
export const Route = createFileRoute("/platform/workflows/$workflowId")({
  validateSearch: (search: Record<string, unknown>): { workspaceId?: string; view?: "edit" | "duplicate" } => ({
    workspaceId: typeof search.workspaceId === "string" && search.workspaceId.trim() ? search.workspaceId : undefined,
    view: search.view === "edit" || search.view === "duplicate" ? search.view : undefined,
  }),
  component: WorkflowRouteComponent,
});

function WorkflowRouteComponent() {
  usePreviewFeatureWarning("workflows");
  const { workflowId } = Route.useParams();
  const { workspaceId, view } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [workflowNavigationState, setWorkflowNavigationState] = useState<WorkflowNavigationState>({ dirty: false, locked: false });
  const workflowBlocker = useBlocker({
    shouldBlockFn: ({ current, next }) => workflowBlocksNavigation(workflowNavigationState, current, next),
    withResolver: true,
    enableBeforeUnload: false,
  });
  return <PlatformScreen section="workflows" workspaceId={workspaceId} workItemTarget={{}}
    workflowNavigation={{ blocker: workflowBlocker, onStateChange: setWorkflowNavigationState }}
    onProjectChange={() => undefined}
    onWorkspaceChange={(selected) => { void navigate({ to: "/platform/$section", params: { section: "workflows" }, search: { workspaceId: selected } }); }}
    workflowRoute={{ workflowId, view, workspaceId }}
    onWorkflowRouteChange={(route, selected) => {
      void (route
        ? navigate({ to: "/platform/workflows/$workflowId", params: { workflowId: route.workflowId },
          search: { workspaceId: route.workspaceId, view: route.view } })
        : navigate({ to: "/platform/$section", params: { section: "workflows" }, search: { workspaceId: selected } }));
    }} />;
}
