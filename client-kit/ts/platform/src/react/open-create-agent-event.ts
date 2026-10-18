// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/openCreateAgentEvent.ts: contextual entry points (search Actions)
// ask the Agents page to open its governed create dialog; a request made before the page mounts
// is consumed once on mount. Presentation only: Core admits agent.definition.create.
const OPEN_CREATE_AGENT_EVENT = "buzz:open-create-agent";

let pendingOpenCreateAgent = false;

export function requestOpenCreateAgent(): void {
  pendingOpenCreateAgent = true;
  window.dispatchEvent(new CustomEvent(OPEN_CREATE_AGENT_EVENT));
}

export function consumePendingOpenCreateAgent(): boolean {
  const pending = pendingOpenCreateAgent;
  pendingOpenCreateAgent = false;
  return pending;
}

export function subscribeOpenCreateAgent(handler: () => void): () => void {
  function handleOpenCreateAgent() {
    pendingOpenCreateAgent = false;
    handler();
  }
  window.addEventListener(OPEN_CREATE_AGENT_EVENT, handleOpenCreateAgent);
  return () => window.removeEventListener(OPEN_CREATE_AGENT_EVENT, handleOpenCreateAgent);
}
