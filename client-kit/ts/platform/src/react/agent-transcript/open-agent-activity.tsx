// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/useOpenAgentActivity.ts: the one entry every working
// surface (activity popover, composer chip, member row) uses to open an Agent's
// activity. The host decides where the panel mounts and whether the viewer may
// read it (Installation `audit`, DD-125(6)); without a host it does nothing.
//
// Surfaces outside the channel view (the sidebar popover) reach the panel through
// AgentActivityOpenerHost: the mounted channel view registers its opener for its
// scope; a request for another channel first navigates there (original
// openAgentActivity(pubkey, { channelId })) and is delivered when that view registers.
import * as React from "react";

export type OpenAgentActivityOptions = { channelId?: string | null };

export type AgentActivityOpener = {
  openAgentActivity: (pubkey: string, options?: OpenAgentActivityOptions) => void;
  /** Whether the host can open this Agent's activity for the viewer. */
  canOpenAgentActivity?: (pubkey: string) => boolean;
};

const noop: AgentActivityOpener = {
  openAgentActivity: () => {},
  canOpenAgentActivity: () => false,
};

const AgentActivityOpenerContext = React.createContext<AgentActivityOpener>(noop);

type Registration = { scopeId: string; opener: AgentActivityOpener };
type Relay = { register: (registration: Registration) => () => void };
const AgentActivityRelayContext = React.createContext<Relay | null>(null);

export function AgentActivityOpenerProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: AgentActivityOpener;
}) {
  return (
    <AgentActivityOpenerContext.Provider value={value}>
      {children}
    </AgentActivityOpenerContext.Provider>
  );
}

export function useOpenAgentActivity(): AgentActivityOpener {
  return React.useContext(AgentActivityOpenerContext);
}

/** App-level opener that forwards to the registered channel view. */
export function AgentActivityOpenerHost({
  children,
  navigate,
}: {
  children: React.ReactNode;
  /** Open the channel view with this scope ID (Web: the Workspace). */
  navigate?: (scopeId: string) => void;
}) {
  const current = React.useRef<Registration | null>(null);
  const pending = React.useRef<{ pubkey: string; options?: OpenAgentActivityOptions } | null>(null);
  const navigateRef = React.useRef(navigate);
  navigateRef.current = navigate;
  const relay = React.useMemo<Relay>(() => ({
    register: (registration) => {
      current.current = registration;
      const request = pending.current;
      if (request && (request.options?.channelId ?? registration.scopeId) === registration.scopeId) {
        pending.current = null;
        registration.opener.openAgentActivity(request.pubkey, request.options);
      }
      return () => {
        if (current.current === registration) current.current = null;
      };
    },
  }), []);
  const opener = React.useMemo<AgentActivityOpener>(() => ({
    openAgentActivity: (pubkey, options) => {
      const registration = current.current;
      const target = options?.channelId ?? null;
      if (registration && (target === null || target === registration.scopeId)) {
        registration.opener.openAgentActivity(pubkey, options);
        return;
      }
      if (target !== null && navigateRef.current) {
        pending.current = { pubkey, options };
        navigateRef.current(target);
      }
    },
    canOpenAgentActivity: (pubkey) => current.current?.opener.canOpenAgentActivity?.(pubkey) ?? false,
  }), []);
  return (
    <AgentActivityRelayContext.Provider value={relay}>
      <AgentActivityOpenerContext.Provider value={opener}>{children}</AgentActivityOpenerContext.Provider>
    </AgentActivityRelayContext.Provider>
  );
}

/** A channel view offers its opener to the app-level host while mounted. */
export function useRegisterAgentActivityOpener(scopeId: string | null, opener: AgentActivityOpener) {
  const relay = React.useContext(AgentActivityRelayContext);
  React.useEffect(() => {
    if (!relay || scopeId === null) return;
    return relay.register({ scopeId, opener });
  }, [opener, relay, scopeId]);
}
