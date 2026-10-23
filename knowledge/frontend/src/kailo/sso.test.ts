import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildOIDCStartURL,
  claimSilentAttempt,
  decideLogoutAction,
  decideOIDCErrorAction,
  DEFAULT_RETURN_PATH,
  handOverReauth,
  sanitizeReturnTo,
  signInRoute,
  SILENT_GUARD_KEY,
  SILENT_GUARD_MS,
} from './sso'
import { callbackPath, nativeInvitationsEnabled, nativeLoginNoticeEnabled, resolveOIDCErrorRoute, resolveSuccessRoute } from './oidcCallback'
import { parseKailoRuntimeConfig } from './runtime'
import { fakeRuntime } from './fakeKailoEmbed'

const KAILO = 'http://192.168.0.193:58090'
const kailoMode = parseKailoRuntimeConfig({ KAILO_MODE: 'true' }, KAILO)
const nativeMode = parseKailoRuntimeConfig({})

function memoryStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial }
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => { data[key] = String(value) },
  }
}

/** Page with the platform runtime; `embedded` mirrors <html data-kailo-embedded>. */
function page(embedded: boolean) {
  const fake = fakeRuntime()
  const replaced: string[] = []
  const win = { KailoEmbed: fake.runtime, location: { replace: (url: string) => { replaced.push(url) } } }
  const doc = { documentElement: { hasAttribute: (name: string) => embedded && name === 'data-kailo-embedded' } }
  return { win, doc, fake, replaced }
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

test('silent failure in the frame calls KailoEmbed.requestTopLevelSignIn and leaves the prompt to Kailo (V-SCN-226)', () => {
  const { win, doc, fake, replaced } = page(true)
  const route = resolveOIDCErrorRoute('login_required', 'none', '/platform/agents', { win, doc, config: kailoMode })
  assert.equal(route, '/login?kailo_state=host&redirect=%2Fplatform%2Fagents')
  assert.equal(fake.calls.signIn, 1)
  assert.deepEqual(replaced, [])
})

test('the frame explains the expired session itself only when Kailo could not be asked', () => {
  const { win, doc, fake } = page(true)
  fake.runtime.requestTopLevelSignIn = () => false
  assert.equal(resolveOIDCErrorRoute('login_required', 'none', '/platform/agents', { win, doc, config: kailoMode }),
    '/login?kailo_state=reauth&redirect=%2Fplatform%2Fagents')
  assert.equal(handOverReauth(null), 'reauth', 'no runtime: no host to prompt')
  assert.equal(handOverReauth(fakeRuntime().runtime), 'host')
  assert.equal(signInRoute('host'), '/login?kailo_state=host')
})

test('silent failure at top level restarts OIDC interactively and stays out of the SPA router', () => {
  const { win, doc, fake, replaced } = page(false)
  const route = resolveOIDCErrorRoute('login_required', 'none', '/platform/agents', { win, doc, config: kailoMode })
  assert.equal(route, '')
  assert.deepEqual(replaced, ['/api/v1/auth/oidc/start?return_to=%2Fplatform%2Fagents'])
  assert.equal(fake.calls.signIn, 0)
})

test('real login errors show the neutral error state; native mode keeps native handling', () => {
  const { win, doc, fake } = page(true)
  assert.equal(resolveOIDCErrorRoute('kailo_org_missing', null, '/platform/agents', { win, doc, config: kailoMode }),
    '/login?kailo_state=error&redirect=%2Fplatform%2Fagents')
  assert.equal(fake.calls.signIn, 0)
  assert.equal(resolveOIDCErrorRoute('login_required', 'none', '/x', { win, doc, config: nativeMode }), null)
})

test('successful callbacks land on the requested page in Kailo mode only', () => {
  assert.equal(callbackPath({ pathname: '/platform/agents', search: '?tab=1' }), '/platform/agents?tab=1')
  assert.equal(callbackPath({}), '')
  assert.equal(resolveSuccessRoute('/platform/agents?tab=1', '/platform/knowledge-bases', kailoMode), '/platform/agents?tab=1')
  assert.equal(resolveSuccessRoute('//evil', '/platform/knowledge-bases', kailoMode), '/platform/knowledge-bases')
  assert.equal(resolveSuccessRoute('/platform/agents', '/platform/knowledge-bases', nativeMode), '/platform/knowledge-bases')
  assert.equal(nativeInvitationsEnabled(kailoMode), false)
  assert.equal(nativeInvitationsEnabled(nativeMode), true)
  assert.equal(nativeLoginNoticeEnabled(kailoMode), false)
  assert.equal(nativeLoginNoticeEnabled(nativeMode), true)
})

test('logout always ends at Kailo Web and never at the native sign-in page', () => {
  assert.deepEqual(decideLogoutAction(`${KAILO}/app/logout`, [KAILO], false), { kind: 'navigate', url: `${KAILO}/app/logout` })
  assert.deepEqual(decideLogoutAction('', [KAILO], false), { kind: 'navigate', url: `${KAILO}/app/` })
  assert.deepEqual(decideLogoutAction(`${KAILO}/app/logout`, [KAILO], true), { kind: 'show-reauth' })
  assert.deepEqual(decideLogoutAction('', [], false), { kind: 'show-reauth' })
  assert.equal(signInRoute('reauth'), '/login?kailo_state=reauth')
  assert.equal(signInRoute('loading'), '/login')
})
