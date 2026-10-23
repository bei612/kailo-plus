// DD-140 Desktop host for the original global ProjectChannelRequestDialog (fixed Buzz
// 779af8886caae1317b4de962082429867ab61503 AgentManagementDialogs mount): the shared dialog over
// this device's native Projects host; without a usable host nothing renders.
import { ProjectChannelRequestDialog } from "@client-kit/platform/react/projects";
import { useProjectsHost } from "@/features/platform/ProjectsScreen";

export function NativeProjectChannelRequests() {
  const host = useProjectsHost();
  return host ? <ProjectChannelRequestDialog host={host} /> : null;
}
