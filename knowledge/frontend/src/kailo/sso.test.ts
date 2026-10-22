import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildOIDCStartURL,
  claimSilentAttempt,
  decideLogoutAction,
  decideOIDCErrorAction,
  DEFAULT_RETURN_PATH,
  sanitizeReturnTo,
  signInRoute,
  SILENT_GUARD_KEY,
  SILENT_GUARD_MS,
} from './sso'
import { callbackPath, nativeInvitationsEnabled, resolveOIDCErrorRoute, resolveSuccessRoute } from './oidcCallback'
import { parseKailoRuntimeConfig } from './runtime'

const KAILO = 'http://192.168.0.193:58090'
const kailoMode = parseKailoRuntimeConfig({ KAILO_MODE: 'true', KAILO_ORIGINS: KAILO })
const nativeMode = parseKailoRuntimeConfig({})

function memoryStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial }
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => { data[key] = String(value) },
  }
}

function fakeWindow(framed: boolean, search = '') {
  const posted: Array<{ message: unknown; origin: string }> = []
  const replaced: string[] = []
  const parent = { postMessage: (message: unknown, origin: string) => { posted.push({ message, origin }) } }
  const win: any = {
    location: { search, replace: (url: string) => replaced.push(url) },
    sessionStorage: memoryStorage(),
    addEventListener() {}, removeEventListener() {},
  }
  win.self = win
  win.top = framed ? parent : win
  win.parent = framed ? parent : win
  return { win, posted, replaced }
}

test('return paths are restricted to same-origin application paths', () => {
  assert.equal(sanitizeReturnTo('/platform/agents?tab=mine'), '/platform/agents?tab=mine')
  assert.equal(sanitizeReturnTo('/platform/agents#frag'), '/platform/agents')
  for (const bad of ['//evil.example/x', 'https://evil.example', '/\\evil', 'platform', '/login', '/register?x=1', '/', '/a\nb', undefined, 42]) {
    assert.equal(sanitizeReturnTo(bad), DEFAULT_RETURN_PATH, String(bad))
  }
})

test('OIDC start URL carries return_to and prompt=none only for silent attempts', () => {
  assert.equal(buildOIDCStartURL('/platform/agents', true),
    '/api/v1/auth/oidc/start?return_to=%2Fplatform%2Fagents&prompt=none')
  assert.equal(buildOIDCStartURL('/platform/agents', false),
    '/api/v1/auth/oidc/start?return_to=%2Fplatform%2Fagents')
  assert.equal(buildOIDCStartURL('//evil', false, '/app/'),
    '/app/api/v1/auth/oidc/start?return_to=%2Fplatform%2Fknowledge-bases')
})

test('silent attempts are limited to one per guard window per tab', () => {
  const storage = memoryStorage()
  assert.equal(claimSilentAttempt(storage, 1_000), true)
  assert.equal(storage.data[SILENT_GUARD_KEY], '1000')
  assert.equal(claimSilentAttempt(storage, 1_000 + SILENT_GUARD_MS - 1), false)
  assert.equal(claimSilentAttempt(storage, 1_000 + SILENT_GUARD_MS), true)
  assert.equal(claimSilentAttempt(null, 5), true, 'no storage never blocks sign-in')
})

test('IdP error decisions: host re-auth in the frame, interactive restart at top level, errors stay errors', () => {
  for (const code of ['login_required', 'interaction_required', 'consent_required', 'account_selection_required']) {
    assert.deepEqual(decideOIDCErrorAction({ code, prompt: 'none', embedded: true, returnTo: '/platform/agents' }),
      { kind: 'request-host-reauth' })
  }
  assert.deepEqual(decideOIDCErrorAction({ code: 'login_required', prompt: 'none', embedded: false, returnTo: '/platform/agents' }),
    { kind: 'interactive', url: '/api/v1/auth/oidc/start?return_to=%2Fplatform%2Fagents' })
  assert.deepEqual(decideOIDCErrorAction({ code: 'login_required', prompt: null, embedded: false, returnTo: '/x/y' }),
    { kind: 'error' }, 'a failed interactive attempt never loops')
  for (const code of ['login_failed', 'invalid_state', 'kailo_org_missing', 'access_denied']) {
    assert.deepEqual(decideOIDCErrorAction({ code, prompt: 'none', embedded: true, returnTo: '/x/y' }), { kind: 'error' })
  }
})

test('callback in the frame asks the Kailo host to sign in again and shows the neutral state', () => {
  const { win, posted, replaced } = fakeWindow(true)
  const route = resolveOIDCErrorRoute('login_required', 'none', '/platform/agents', { win, config: kailoMode })
  assert.equal(route, '/login?kailo_state=reauth&redirect=%2Fplatform%2Fagents')
  assert.deepEqual(posted, [{ message: { type: 'kailo:auth-required', component: 'knowledge' }, origin: KAILO }])
  assert.deepEqual(replaced, [])
})

test('callback at top level restarts OIDC interactively and stays out of the SPA router', () => {
  const { win, posted, replaced } = fakeWindow(false)
  const route = resolveOIDCErrorRoute('login_required', 'none', '/platform/agents', { win, config: kailoMode })
  assert.equal(route, '')
  assert.deepEqual(replaced, ['/api/v1/auth/oidc/start?return_to=%2Fplatform%2Fagents'])
  assert.deepEqual(posted, [])
})

test('real login errors show the neutral error state; native mode keeps native handling', () => {
  const { win } = fakeWindow(true)
  assert.equal(resolveOIDCErrorRoute('kailo_org_missing', null, '/platform/agents', { win, config: kailoMode }),
    '/login?kailo_state=error&redirect=%2Fplatform%2Fagents')
  assert.equal(resolveOIDCErrorRoute('login_required', 'none', '/x', { win, config: nativeMode }), null)
})

test('successful callbacks land on the requested page in Kailo mode only', () => {
  assert.equal(callbackPath({ pathname: '/platform/agents', search: '?tab=1' }), '/platform/agents?tab=1')
  assert.equal(callbackPath({}), '')
  assert.equal(resolveSuccessRoute('/platform/agents?tab=1', '/platform/knowledge-bases', kailoMode), '/platform/agents?tab=1')
  assert.equal(resolveSuccessRoute('//evil', '/platform/knowledge-bases', kailoMode), '/platform/knowledge-bases')
  assert.equal(resolveSuccessRoute('/platform/agents', '/platform/knowledge-bases', nativeMode), '/platform/knowledge-bases')
  assert.equal(nativeInvitationsEnabled(kailoMode), false)
  assert.equal(nativeInvitationsEnabled(nativeMode), true)
})

test('logout always ends at Kailo and never at the native sign-in page', () => {
  assert.deepEqual(decideLogoutAction(`${KAILO}/app/logout`, [KAILO], false), { kind: 'navigate', url: `${KAILO}/app/logout` })
  assert.deepEqual(decideLogoutAction('', [KAILO], false), { kind: 'navigate', url: `${KAILO}/` })
  assert.deepEqual(decideLogoutAction('', ['tauri://localhost', KAILO], false), { kind: 'navigate', url: `${KAILO}/` })
  assert.deepEqual(decideLogoutAction(`${KAILO}/app/logout`, [KAILO], true), { kind: 'request-host-logout' })
  assert.deepEqual(decideLogoutAction('', [], false), { kind: 'show-reauth' })
  assert.equal(signInRoute('reauth'), '/login?kailo_state=reauth')
  assert.equal(signInRoute('loading'), '/login')
})
