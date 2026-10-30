// Kailo DD-163 (07 §4.8.8): one collaboration and one AI system. The knowledge
// page keeps the built-in quick answer; Agent, 产物 and agent mode are gone.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  agentModeAvailable,
  chatEndpoint,
  convergeText,
  effectiveAgentSelection,
  KAILO_BUSINESS_HOME,
  KAILO_QUICK_ANSWER_ID,
  kailoClosedMenuPath,
  kailoClosedRoute,
  kailoClosedTab,
  normalizeAgentSelection,
  quickAnswerSetupAction,
} from './converge'

test('Kailo mode closes the Agent and 产物 tabs, menu entries and routes; native keeps them', () => {
  for (const id of ['agents', 'artifacts']) {
    assert.equal(kailoClosedTab(id, true), true)
    assert.equal(kailoClosedTab(id, false), false)
    assert.equal(kailoClosedMenuPath(id, true), true)
    assert.equal(kailoClosedMenuPath(id, false), false)
  }
  for (const id of ['chat', 'knowledge-bases']) assert.equal(kailoClosedTab(id, true), false)
  for (const path of ['creatChat', 'knowledge-bases']) assert.equal(kailoClosedMenuPath(path, true), false)
  assert.equal(kailoClosedRoute('agentList', true), true)
  assert.equal(kailoClosedRoute('artifactLibrary', true), true)
  assert.equal(kailoClosedRoute('agentList', false), false)
  assert.equal(kailoClosedRoute('chat', true), false)
  assert.equal(kailoClosedRoute(undefined, true), false)
  assert.equal(KAILO_BUSINESS_HOME, '/platform/creatChat')
})

test('Kailo mode always answers with the quick answer in retrieval mode', () => {
  const stale = { selectedAgentId: 'custom-agent-1', selectedAgentSourceTenantId: '42', isAgentEnabled: true }
  assert.deepEqual(effectiveAgentSelection(stale, true), {
    selectedAgentId: KAILO_QUICK_ANSWER_ID, selectedAgentSourceTenantId: null, isAgentEnabled: false,
  })
  assert.deepEqual(effectiveAgentSelection(stale, false), stale, 'native builds keep the choice')
  assert.deepEqual(effectiveAgentSelection({ isAgentEnabled: false }, false), {
    selectedAgentId: KAILO_QUICK_ANSWER_ID, selectedAgentSourceTenantId: null, isAgentEnabled: false,
  })

  const stored = { ...stale }
  assert.equal(normalizeAgentSelection(stored, false), false)
  assert.deepEqual(stored, stale)
  assert.equal(normalizeAgentSelection(stored, true), true)
  assert.deepEqual(stored, { selectedAgentId: KAILO_QUICK_ANSWER_ID, selectedAgentSourceTenantId: null, isAgentEnabled: false })
  assert.equal(normalizeAgentSelection(stored, true), false, 'already normalized')
})

test('Kailo mode never calls agent-chat and renders no agent picker', () => {
  assert.equal(chatEndpoint(true, true), '/api/v1/knowledge-chat')
  assert.equal(chatEndpoint(false, true), '/api/v1/knowledge-chat')
  assert.equal(chatEndpoint(true, false), '/api/v1/agent-chat')
  assert.equal(chatEndpoint(false, false), '/api/v1/knowledge-chat')
  assert.equal(agentModeAvailable(true), false)
  assert.equal(agentModeAvailable(false), true)
})

test('an unset quick answer: admins get answer settings in place, others ask an admin (V-SCN-272)', () => {
  assert.equal(quickAnswerSetupAction(true, true), 'answer-settings-dialog')
  assert.equal(quickAnswerSetupAction(true, false), 'ask-admin')
  assert.equal(quickAnswerSetupAction(false, false), 'agent-editor-page')
  assert.equal(convergeText('answerSettings', 'zh-CN'), '问答设置')
  assert.match(convergeText('askAdmin', 'en'), /admin/)
})
