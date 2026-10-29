// Buzz 779af8886caae1317b4de962082429867ab61503: ProjectRightPanelControls' terminal toggle and
// ProjectDetailScreen's useTerminalContextOverride. DD-161: the terminal is a Desktop-local PTY,
// so the shared Projects surface only renders the host's toggle and reports the project channel
// as terminal context; Web supplies no host and shows neither.
import * as React from "react";

export type ProjectTerminalContext = { channelId: string; channelName: string };

export type ProjectTerminalHost = {
  /** The host's toggle button (original Buzz Term ⌘J control). */
  Toggle: React.ComponentType;
  /** The original context override: the project's channel while its page is shown. */
  setContext: (context: ProjectTerminalContext | null) => void;
};

const ProjectTerminalHostContext = React.createContext<ProjectTerminalHost | null>(null);

export function ProjectTerminalHostProvider({ host, children }: { host: ProjectTerminalHost | null; children: React.ReactNode }) {
  return <ProjectTerminalHostContext.Provider value={host}>{children}</ProjectTerminalHostContext.Provider>;
}

export function ProjectTerminalToggle() {
  const host = React.useContext(ProjectTerminalHostContext);
  return host ? <host.Toggle /> : null;
}

export function useProjectTerminalContext(context: ProjectTerminalContext | null) {
  const host = React.useContext(ProjectTerminalHostContext);
  const channelId = context?.channelId ?? null;
  const channelName = context?.channelName ?? null;
  React.useEffect(() => {
    if (!host) return;
    host.setContext(channelId && channelName ? { channelId, channelName } : null);
    return () => host.setContext(null);
  }, [host, channelId, channelName]);
}
