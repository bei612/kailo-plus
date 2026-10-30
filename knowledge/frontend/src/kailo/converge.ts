// Kailo DD-163 (design 07 §4.8.8): collaboration and AI exist once, in Kailo.
// In Kailo mode this knowledge page keeps retrieval-based Q&A (the built-in
// quick answer) as its core business; custom agents, agent mode, artifacts,
// memory, IM and web embedding are Kailo Agent's and Kailo's, and the server
// refuses them (internal/middleware/kailo_converge.go). This module holds the
// pure decisions the UI applies; the server remains the authority.

/** The only agent Kailo mode answers with (api/agent BUILTIN_QUICK_ANSWER_ID). */
export const KAILO_QUICK_ANSWER_ID = 'builtin-quick-answer'

/** Product tabs (kailo/page.ts) that do not exist in Kailo mode. */
export const KAILO_CLOSED_TABS: ReadonlySet<string> = new Set(['agents', 'artifacts'])

/** Native menu entries (stores/menu.ts paths) that do not exist in Kailo mode. */
export const KAILO_CLOSED_MENU_PATHS: ReadonlySet<string> = new Set(['agents', 'artifacts'])

/** Route names that redirect to the chat home in Kailo mode. */
export const KAILO_CLOSED_ROUTE_NAMES: ReadonlySet<string> = new Set(['agentList', 'artifactLibrary'])

/** Where a closed route lands: the knowledge Q&A home. */
export const KAILO_BUSINESS_HOME = '/platform/creatChat'

export function kailoClosedTab(id: string, kailoMode: boolean): boolean {
  return kailoMode && KAILO_CLOSED_TABS.has(id)
}

export function kailoClosedMenuPath(path: string, kailoMode: boolean): boolean {
  return kailoMode && KAILO_CLOSED_MENU_PATHS.has(path)
}

export function kailoClosedRoute(name: unknown, kailoMode: boolean): boolean {
  return kailoMode && typeof name === 'string' && KAILO_CLOSED_ROUTE_NAMES.has(name)
}

export interface AgentSelection {
  selectedAgentId?: string
  selectedAgentSourceTenantId?: string | null
  isAgentEnabled: boolean
}

/**
 * The agent selection in effect. Kailo mode always answers with the built-in
 * quick answer in normal (retrieval) mode, whatever a stale localStorage blob,
 * a restored session state or an older agent choice says.
 */
export function effectiveAgentSelection(selection: AgentSelection, kailoMode: boolean): Required<AgentSelection> {
  if (kailoMode) {
    return { selectedAgentId: KAILO_QUICK_ANSWER_ID, selectedAgentSourceTenantId: null, isAgentEnabled: false }
  }
  return {
    selectedAgentId: selection.selectedAgentId || KAILO_QUICK_ANSWER_ID,
    selectedAgentSourceTenantId: selection.selectedAgentSourceTenantId ?? null,
    isAgentEnabled: selection.isAgentEnabled || false,
  }
}

/** Rewrites a stored selection in place for Kailo mode; true when it changed. */
export function normalizeAgentSelection(selection: AgentSelection, kailoMode: boolean): boolean {
  if (!kailoMode) return false
  const changed = selection.selectedAgentId !== KAILO_QUICK_ANSWER_ID ||
    (selection.selectedAgentSourceTenantId ?? null) !== null || selection.isAgentEnabled
  selection.selectedAgentId = KAILO_QUICK_ANSWER_ID
  selection.selectedAgentSourceTenantId = null
  selection.isAgentEnabled = false
  return changed
}

/** The Q&A endpoint. Kailo mode never calls the closed agent-chat endpoint. */
export function chatEndpoint(agentEnabled: boolean, kailoMode: boolean): string {
  return agentEnabled && !kailoMode ? '/api/v1/agent-chat' : '/api/v1/knowledge-chat'
}

/**
 * Agent mode (tool-calling runs: smart reasoning, custom agents, the wiki fix
 * assistant) exists only outside Kailo mode; so do the input area's agent
 * picker and agent-mode switch.
 */
export function agentModeAvailable(kailoMode: boolean): boolean {
  return !kailoMode
}

/**
 * What happens when the quick answer is not ready (no projected chat model
 * chosen). Native builds open the agent editor page; Kailo mode opens the
 * answer settings in place for an admin, and asks anyone else to have an
 * admin finish them (V-SCN-272).
 */
export type QuickAnswerSetupAction = 'agent-editor-page' | 'answer-settings-dialog' | 'ask-admin'

export function quickAnswerSetupAction(kailoMode: boolean, canManage: boolean): QuickAnswerSetupAction {
  if (!kailoMode) return 'agent-editor-page'
  return canManage ? 'answer-settings-dialog' : 'ask-admin'
}

const TEXT = {
  zh: {
    answerSettings: '问答设置',
    askAdmin: '问答尚未完成设置，请联系管理员在问答设置中选择对话模型。',
  },
  en: {
    answerSettings: 'Answer settings',
    askAdmin: 'Answers are not set up yet. Ask an admin to choose a chat model in answer settings.',
  },
}

export function convergeText(key: keyof typeof TEXT.zh, locale: string): string {
  return TEXT[/^zh\b/i.test(locale || '') ? 'zh' : 'en'][key]
}
