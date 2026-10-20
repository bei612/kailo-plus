// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/projects/ui/useProjectsOverviewAgentContext.ts.
// The overview chat context follows the visible section while it is the overview context; a
// selection context stays as chosen. The context object is stable for an unchanged payload,
// so recomputed section arrays do not churn the open panel.
import * as React from "react";
import {
  buildProjectsOverviewAgentContext,
  projectDetailAgentContextBlock,
  type ProjectDetailAgentContext,
} from "./lib/projectDetailAgentContext";
import { buildProjectsViewAgentContextItems, type ProjectsViewAgentContextInput } from "./buildProjectsViewAgentContext";

export const PROJECTS_OVERVIEW_AGENT_CONTEXT_ADDRESS = "projects:overview";

export function useProjectsOverviewAgentContext(sectionTitle: string, input: ProjectsViewAgentContextInput) {
  const [agentContext, setAgentContext] = React.useState<ProjectDetailAgentContext | null>(null);
  const built = buildProjectsOverviewAgentContext(sectionTitle, buildProjectsViewAgentContextItems(input));
  const payload = projectDetailAgentContextBlock(built);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the payload is the identity of the context
  const overviewContext = React.useMemo(() => built, [payload]);
  React.useEffect(() => {
    setAgentContext(context => context?.repoAddress === PROJECTS_OVERVIEW_AGENT_CONTEXT_ADDRESS ? overviewContext : context);
  }, [overviewContext]);
  return { agentContext, overviewContext, setAgentContext };
}
