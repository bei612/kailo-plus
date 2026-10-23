// Buzz 779af8886caae1317b4de962082429867ab61503:
// ProjectDetailRightPanel / ProjectConversationPanelContext (detached fallback),
// useProjectPanelWidths, useProjectRepositoryPanel and ProjectRightPanelControls.
// Repository and chat modes: the chat mode is the project Agent conversation (DD-130), shown
// only when the host supplies the governed chat transport. The terminal toggle opens the
// Desktop-local Buzz Term and has no governed consumer here.
import * as React from "react";
import { MessageCircle } from "lucide-react";
import { useUiT } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import { DrawerPanelIcon } from "../sidebar/DrawerPanelIcon";
import { useOptionalSidebar } from "../sidebar/sidebar";
import { cn } from "../profile/buzz/shared/lib/cn";
import { useThreadPanelWidth } from "../messages/thread/useThreadPanelWidth";
import { AppTopChromePortal } from "./AppTopChromePortal";
import { ProjectConversationPanelProvider } from "./ProjectConversationPanelContext";
import { useOptionalPulseHost } from "../pulse/host";
import type { SearchHit } from "../search/types";
import { ProjectAgentChatPanel } from "./ProjectAgentChatPanel";
import { ProjectContextRail } from "./ProjectContextRail";
import { ProjectRepositoryActionsPanel, type ProjectRepositoryActionsPanelProps } from "./ProjectRepositoryActionsPanel";
import type { ProjectWorkItemContext } from "./ProjectWorkItemContextDetails";
import { useProjectAgentChatHost } from "./projectAgentChatHost";
import { withProjectSelectionAgentContext, type ProjectDetailAgentContext } from "./lib/projectDetailAgentContext";
import type { ProjectSelectionItem } from "./lib/projectSelection";

const REPOSITORY_PANEL_COLLAPSED_KEY = "buzz.desktop.project-repository-panel-collapsed";
const PROJECT_RIGHT_PANEL_MODE_KEY = "buzz.desktop.project-right-panel-mode";
/** Default width of the project context rail (repository details and overview). */
export const PROJECT_CONTEXT_PANEL_DEFAULT_WIDTH_PX = 280;
const PROJECT_CONTEXT_PANEL_MIN_WIDTH_PX = 240;

export type ProjectRightPanelMode = "chat" | "repository";

function initialCollapsed() {
  try { return globalThis.sessionStorage?.getItem(REPOSITORY_PANEL_COLLAPSED_KEY) === "true"; }
  catch { return false; }
}

function initialMode(): ProjectRightPanelMode {
  try { return globalThis.sessionStorage?.getItem(PROJECT_RIGHT_PANEL_MODE_KEY) === "chat" ? "chat" : "repository"; }
  catch { return "repository"; }
}

/** Original useProjectRepositoryPanel with useProjectPanelWidths. */
export function useProjectRepositoryPanel(ownerKey = "") {
  const [collapsed, setCollapsedState] = React.useState(initialCollapsed);
  const [mode, setModeState] = React.useState<ProjectRightPanelMode>(initialMode);
  const [selectionAgentContext, setSelectionAgentContext] = React.useState<{
    context: ProjectDetailAgentContext;
    ownerKey: string;
  } | null>(null);
  const width = useThreadPanelWidth(undefined, {
    defaultWidthPx: PROJECT_CONTEXT_PANEL_DEFAULT_WIDTH_PX,
    minWidthPx: PROJECT_CONTEXT_PANEL_MIN_WIDTH_PX,
    sessionKey: "buzz.desktop.project-context-width",
  });
  const setCollapsed = React.useCallback((next: boolean) => {
    setCollapsedState(next);
    try { globalThis.sessionStorage?.setItem(REPOSITORY_PANEL_COLLAPSED_KEY, String(next)); }
    catch { /* Original best-effort presentation preference. */ }
  }, []);
  const setMode = React.useCallback((next: ProjectRightPanelMode) => {
    setSelectionAgentContext(null);
    setModeState(next);
    try { globalThis.sessionStorage?.setItem(PROJECT_RIGHT_PANEL_MODE_KEY, next); }
    catch { /* Original best-effort presentation preference. */ }
  }, []);
  React.useEffect(() => {
    setSelectionAgentContext(current => current?.ownerKey === ownerKey ? current : null);
  }, [ownerKey]);
  const openSelectionChat = React.useCallback((context: ProjectDetailAgentContext, items: ProjectSelectionItem[]) => {
    setMode("chat");
    setSelectionAgentContext({ context: withProjectSelectionAgentContext(context, items), ownerKey });
    setCollapsed(false);
  }, [ownerKey, setCollapsed, setMode]);
  return {
    agentContext: (fallback: ProjectDetailAgentContext) =>
      selectionAgentContext?.ownerKey === ownerKey ? selectionAgentContext.context : fallback,
    collapse: React.useCallback(() => setCollapsed(true), [setCollapsed]),
    collapsed,
    expand: React.useCallback(() => setCollapsed(false), [setCollapsed]),
    mode,
    openSelectionChat,
    setMode,
    width,
  };
}

export type ProjectRepositoryPanelState = ReturnType<typeof useProjectRepositoryPanel>;

/** Original ProjectChatPanelControl; rendered only with the governed chat transport. */
export function ProjectChatPanelControl({ collapsed, mode, onCollapse, onExpand, onModeChange }: {
  collapsed: boolean;
  mode: ProjectRightPanelMode;
  onCollapse: () => void;
  onExpand: () => void;
  onModeChange: (mode: ProjectRightPanelMode) => void;
}) {
  const t = useUiT();
  const chatOpen = !collapsed && mode === "chat";
  return (
    <Button
      aria-label={t(chatOpen ? "projects.agentChat.hide" : "projects.agentChat.show")}
      aria-pressed={chatOpen}
      className="h-7 w-7 text-sidebar-foreground hover:bg-sidebar-accent"
      data-testid="project-right-panel-chat-tab"
      onClick={() => {
        if (chatOpen) { onCollapse(); return; }
        onModeChange("chat");
        onExpand();
      }}
      size="icon"
      title={t("projects.agentChat.title")}
      type="button"
      variant="ghost"
    >
      <MessageCircle className={cn("h-4 w-4 transition-opacity duration-200 ease-linear", chatOpen ? "opacity-100" : "opacity-60")} />
    </Button>
  );
}

/** Original ProjectRightPanelControls: the chat (when available) and repository context toggles. */
export function ProjectRightPanelControls({ collapsed, mode = "repository", onCollapse, onExpand, onModeChange, chatAvailable = false }: {
  collapsed: boolean;
  mode?: ProjectRightPanelMode;
  onCollapse: () => void;
  onExpand: () => void;
  onModeChange?: (mode: ProjectRightPanelMode) => void;
  chatAvailable?: boolean;
}) {
  const t = useUiT();
  const changeMode = chatAvailable ? onModeChange : undefined;
  const repositoryOpen = !collapsed && (!changeMode || mode === "repository");
  return (
    <div className="flex items-center gap-0.5">
      {changeMode ? <ProjectChatPanelControl collapsed={collapsed} mode={mode} onCollapse={onCollapse} onExpand={onExpand}
        onModeChange={changeMode} /> : null}
      <Button
        aria-label={t(repositoryOpen ? "projects.context.hide" : "projects.context.show")}
        aria-pressed={repositoryOpen}
        className="h-7 w-7 text-sidebar-foreground hover:bg-sidebar-accent"
        data-testid="project-right-panel-repository-tab"
        onClick={() => {
          if (repositoryOpen) { onCollapse(); return; }
          changeMode?.("repository");
          onExpand();
        }}
        size="icon"
        title={t("projects.context.title")}
        type="button"
        variant="ghost"
      >
        <DrawerPanelIcon className="-scale-x-100" side={repositoryOpen ? "left" : "right"} testId="project-right-panel-repository-icon"/>
      </Button>
    </div>
  );
}

export type ProjectChatPanelWidth = ReturnType<typeof useThreadPanelWidth>;

/**
 * The rail with the chat mode: original useProjectPanelWidths("chat") gives the chat the thread
 * panel width. Mounted only with the governed chat transport.
 */
function ProjectDetailChatAwareRail({ panel, chatPanel, state }: {
  panel: React.ReactNode;
  chatPanel: (width: ProjectChatPanelWidth) => React.ReactNode;
  state: ProjectRepositoryPanelState;
}) {
  const chatWidth = useThreadPanelWidth();
  const chat = state.mode === "chat";
  const width = chat ? chatWidth : state.width;
  return (
    <ProjectContextRail open={!state.collapsed} panelWidthPx={width.widthPx} resizing={width.isResizing}>
      {chat ? chatPanel(chatWidth) : panel}
    </ProjectContextRail>
  );
}

/** Original detached repository layout: the content pod beside the context rail. */
export function ProjectDetailPanelLayout({ panel, chatPanel, state, children, resetKey = "" }: {
  panel: React.ReactNode;
  /** Original controller resetKey: a different detail context closes the conversation. */
  resetKey?: string;
  /** The chat mode content; absent when the host has no governed chat transport. */
  chatPanel?: (width: ProjectChatPanelWidth) => React.ReactNode;
  state: ProjectRepositoryPanelState;
  children: React.ReactNode;
}) {
  const sidebar = useOptionalSidebar();
  // Original ProjectConversationPanelController: a "Discussed in" hit replaces the context rail
  // with the channel conversation until closed (only when the host renders governed threads).
  const renderConversation = useOptionalPulseHost()?.discussions?.renderConversation;
  const [hit, setHit] = React.useState<SearchHit | null>(null);
  const conversationWidth = useThreadPanelWidth();
  const openConversation = React.useCallback((next: SearchHit) => setHit(next), []);
  React.useEffect(() => { setHit(null); }, [resetKey]);
  const conversation = hit && renderConversation ? renderConversation({ hit, onClose: () => setHit(null),
    widthPx: conversationWidth.widthPx, canResetWidth: conversationWidth.canReset,
    onResetWidth: conversationWidth.onResetWidth, onResizeStart: conversationWidth.onResizeStart }) : null;
  return (
    <ProjectConversationPanelProvider onOpenConversation={openConversation}>
    <div className={cn("relative flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden bg-sidebar pb-2 pr-2 pt-px", sidebar?.open === false && "pl-2")}
      data-detached="true" data-project-context-detached="true" data-project-detail-screen data-testid="project-panel-layout">
      <div className="relative ml-px flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl bg-background" data-testid="project-content-pod">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden [container-type:inline-size]">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-none px-4 pb-4" data-testid="project-detail-scroll">
            <div className="flex min-h-full w-full flex-col space-y-3">{children}</div>
          </div>
        </div>
      </div>
      {conversation ?? (chatPanel ? <ProjectDetailChatAwareRail chatPanel={chatPanel} panel={panel} state={state} />
        : <ProjectContextRail open={!state.collapsed} panelWidthPx={state.width.widthPx} resizing={state.width.isResizing}>{panel}</ProjectContextRail>)}
    </div>
    </ProjectConversationPanelProvider>
  );
}

type RightPanelChat = { openSelectionChat: (items: ProjectSelectionItem[]) => void };
const RightPanelChatContext = React.createContext<RightPanelChat | null>(null);

/** Work-item context actions open the chat with the selected item (original onChatWithAgent). */
export function useProjectRightPanelChat() {
  return React.useContext(RightPanelChatContext);
}

/** A selected Task/Review: the same rail with the work-item context card or the Agent chat. */
export function ProjectDetailRightPanel({ children, agentContext, ...panel }: ProjectWorkItemContext & Pick<ProjectRepositoryActionsPanelProps, "actions" | "onCreateTask"> & {
  children: React.ReactNode;
  /** This work item's page context (DD-130); absent → repository mode only. */
  agentContext?: ProjectDetailAgentContext;
}) {
  const chatHost = useProjectAgentChatHost();
  const state = useProjectRepositoryPanel(agentContext?.repoAddress ?? "");
  const chatContext = chatHost ? agentContext : undefined;
  const { openSelectionChat } = state;
  const chat = React.useMemo<RightPanelChat | null>(() => chatContext
    ? { openSelectionChat: items => openSelectionChat(chatContext, items) } : null,
  [chatContext, openSelectionChat]);
  return <>
    <AppTopChromePortal><div className="ml-auto flex shrink-0 items-center gap-0.5">
      <ProjectRightPanelControls chatAvailable={Boolean(chatContext)} collapsed={state.collapsed} mode={state.mode}
        onCollapse={state.collapse} onExpand={state.expand} onModeChange={state.setMode}/>
    </div></AppTopChromePortal>
    <RightPanelChatContext.Provider value={chat}>
      <ProjectDetailPanelLayout state={state} resetKey={panel.issue ? `issue:${panel.issue.id}` : `review:${panel.pullRequest.id}`}
        chatPanel={chatContext ? width => <ProjectAgentChatPanel canResetWidth={width.canReset} constrainToAvailableSpace={false}
          context={state.agentContext(chatContext)} onClose={state.collapse} onResetWidth={width.onResetWidth}
          onResizeStart={width.onResizeStart} widthPx={width.widthPx}/> : undefined}
        panel={<ProjectRepositoryActionsPanel {...panel} widthPx={state.width.widthPx}
          onResizeStart={state.width.onResizeStart} canResetWidth={state.width.canReset} onResetWidth={state.width.onResetWidth}/>}>
        {children}
      </ProjectDetailPanelLayout>
    </RightPanelChatContext.Provider>
  </>;
}
