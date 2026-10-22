import assert from 'node:assert/strict'
import test from 'node:test'
import {
  connectHost,
  identityLocaleForRuntime,
  isEmbedded,
  kailoEmbed,
  mapKailoLocale,
  offerIdentityLocale,
  requestTopLevelSignIn,
} from './bridge'
import { fakeRuntime } from './fakeKailoEmbed'
import { normalizeOrigin, parseKailoRuntimeConfig, parseWebOrigins } from './runtime'

const KAILO = 'http://192.168.0.193:58090'

test('runtime config: logout URL validation and Kailo Web origins from the meta only', () => {
  assert.equal(normalizeOrigin(KAILO), KAILO)
  assert.equal(normalizeOrigin(KAILO + '/'), KAILO)
  assert.equal(normalizeOrigin(KAILO + '/app'), '')
  assert.equal(normalizeOrigin('tauri://localhost'), '')
  assert.equal(normalizeOrigin('http://user:pw@host'), '')
  assert.deepEqual(parseWebOrigins(`${KAILO} ${KAILO} https://x.example/app __KAILO_WEB_ORIGIN__`), [KAILO])
  assert.deepEqual(parseWebOrigins(''), [])
  const cfg = parseKailoRuntimeConfig({
    KAILO_MODE: 'true',
    PLATFORM_DISPLAY_NAME: ' Kailo ',
    KAILO_LOGOUT_URL: 'javascript:alert(1)',
  }, KAILO)
  assert.equal(cfg.mode, true)
  assert.equal(cfg.displayName, 'Kailo')
  assert.deepEqual(cfg.origins, [KAILO])
  assert.equal(cfg.logoutUrl, '')
  assert.equal(parseKailoRuntimeConfig(undefined).mode, false)
  assert.deepEqual(parseKailoRuntimeConfig(undefined).origins, [])
  assert.equal(parseKailoRuntimeConfig({ KAILO_LOGOUT_URL: `${KAILO}/app/` }).logoutUrl, `${KAILO}/app/`)
})

test('the adapter only accepts a wire v1 runtime', () => {
  const { runtime } = fakeRuntime()
  assert.equal(kailoEmbed({ KailoEmbed: runtime }), runtime)
  assert.equal(kailoEmbed({}), null)
  assert.equal(kailoEmbed({ KailoEmbed: { ...runtime, version: 2 } }), null)
  assert.equal(kailoEmbed(undefined), null)
})

test('embedded is the runtime marker on <html>', () => {
  const doc = (attrs: string[]) => ({ documentElement: { hasAttribute: (n: string) => attrs.includes(n) } })
  assert.equal(isEmbedded(doc(['data-kailo-embedded'])), true)
  assert.equal(isEmbedded(doc([])), false)
  assert.equal(isEmbedded(undefined), false)
})

test('only the two Kailo locales map onto native locales', () => {
  assert.equal(mapKailoLocale('zh-CN'), 'zh-CN')
  assert.equal(mapKailoLocale('en'), 'en-US')
  assert.equal(mapKailoLocale('en-US'), null)
  assert.equal(mapKailoLocale('ja'), null)
  assert.equal(mapKailoLocale(undefined), null)
  assert.equal(identityLocaleForRuntime('zh-CN'), 'zh-CN')
  assert.equal(identityLocaleForRuntime('zh'), 'zh-CN')
  assert.equal(identityLocaleForRuntime('en'), 'en')
  assert.equal(identityLocaleForRuntime('en-GB'), 'en')
  assert.equal(identityLocaleForRuntime('de'), null)
  assert.equal(identityLocaleForRuntime(null), null)
})

test('connectHost applies the current state, then follows runtime changes until unsubscribed', () => {
  const { runtime, host } = fakeRuntime({ theme: 'dark', locale: 'en' })
  const themes: string[] = []
  const locales: string[] = []
  const stop = connectHost(runtime, { onTheme: t => themes.push(t), onLocale: l => locales.push(l) })
  assert.deepEqual(themes, ['dark'])
  assert.deepEqual(locales, ['en-US'])
  host.setTheme('light')
  host.setLocale('zh-CN')
  assert.deepEqual(themes, ['dark', 'light'])
  assert.deepEqual(locales, ['en-US', 'zh-CN'])
  stop()
  host.setTheme('dark')
  assert.deepEqual(themes, ['dark', 'light'])
})

test('identity locale is offered to the runtime in its vocabulary and ignored once Kailo supplied one', () => {
  const fresh = fakeRuntime()
  const locales: string[] = []
  connectHost(fresh.runtime, { onTheme: () => {}, onLocale: l => locales.push(l) })
  assert.equal(offerIdentityLocale(fresh.runtime, 'en-GB'), true)
  assert.deepEqual(fresh.calls.identity, ['en'])
  assert.deepEqual(locales, ['zh-CN', 'en-US'])
  assert.equal(offerIdentityLocale(fresh.runtime, 'de'), false, 'unsupported tags are not offered')
  assert.deepEqual(fresh.calls.identity, ['en'])
  const supplied = fakeRuntime({ supplied: true })
  assert.equal(offerIdentityLocale(supplied.runtime, 'en'), false)
  assert.equal(offerIdentityLocale(null, 'en'), false)
})

test('top-level sign-in is requested through the runtime only', () => {
  const { runtime, calls } = fakeRuntime()
  assert.equal(requestTopLevelSignIn(runtime), true)
  assert.equal(calls.signIn, 1)
  assert.equal(requestTopLevelSignIn(null), false)
})
