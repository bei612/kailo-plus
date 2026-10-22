import assert from 'node:assert/strict'
import test from 'node:test'
import {
  installHostBridge,
  isEmbedded,
  isFramed,
  mapKailoLocale,
  parseHostLocale,
  postToHost,
  readHostPreferences,
  SESSION_LOCALE_KEY,
  SESSION_THEME_KEY,
} from './bridge'
import { normalizeOrigin, parseKailoRuntimeConfig } from './runtime'

const KAILO = 'http://192.168.0.193:58090'

function memoryStorage(initial: Record<string, string> = {}) {
  const data: Record<string, string> = { ...initial }
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => { data[key] = String(value) },
  }
}

function fakeWindow(framed = true) {
  const listeners: Array<(event: any) => void> = []
  const posted: Array<{ message: unknown; origin: string }> = []
  const parent = { postMessage: (message: unknown, origin: string) => { posted.push({ message, origin }) } }
  const win: any = {
    addEventListener: (_type: string, fn: (event: any) => void) => { listeners.push(fn) },
    removeEventListener: (_type: string, fn: (event: any) => void) => {
      const i = listeners.indexOf(fn)
      if (i >= 0) listeners.splice(i, 1)
    },
  }
  win.self = win
  win.top = framed ? parent : win
  win.parent = framed ? parent : win
  const dispatch = (event: any) => listeners.slice().forEach(fn => fn(event))
  return { win, parent, posted, listeners, dispatch }
}

test('runtime config accepts only exact origins and absolute http(s) logout URLs', () => {
  assert.equal(normalizeOrigin(KAILO), KAILO)
  assert.equal(normalizeOrigin(KAILO + '/'), KAILO)
  assert.equal(normalizeOrigin(KAILO + '/app'), '')
  assert.equal(normalizeOrigin('javascript:alert(1)'), '')
  assert.equal(normalizeOrigin('http://user:pw@host'), '')
  const cfg = parseKailoRuntimeConfig({
    KAILO_MODE: 'true',
    PLATFORM_DISPLAY_NAME: ' Kailo ',
    KAILO_ORIGINS: `${KAILO} ${KAILO} https://evil.example/x tauri://localhost`,
    KAILO_LOGOUT_URL: 'javascript:alert(1)',
  })
  assert.equal(cfg.mode, true)
  assert.equal(cfg.displayName, 'Kailo')
  assert.deepEqual(cfg.origins, [KAILO, 'tauri://localhost'])
  assert.equal(cfg.logoutUrl, '')
  assert.equal(parseKailoRuntimeConfig(undefined).mode, false)
  assert.equal(parseKailoRuntimeConfig({ KAILO_MODE: true }).mode, true)
  assert.equal(parseKailoRuntimeConfig({ KAILO_LOGOUT_URL: `${KAILO}/app/logout` }).logoutUrl, `${KAILO}/app/logout`)
})

test('Kailo locale tags map onto the native locales', () => {
  assert.equal(mapKailoLocale('zh-CN'), 'zh-CN')
  assert.equal(mapKailoLocale('zh-Hans'), 'zh-CN')
  assert.equal(mapKailoLocale('en'), 'en-US')
  assert.equal(mapKailoLocale('en-GB'), 'en-US')
  assert.equal(mapKailoLocale('ja'), 'ja-JP')
  assert.equal(mapKailoLocale('ko-KR'), 'ko-KR')
  assert.equal(mapKailoLocale('ru'), 'ru-RU')
  assert.equal(mapKailoLocale('de'), 'zh-CN')
  assert.equal(mapKailoLocale(null), 'zh-CN')
  assert.equal(parseHostLocale('en<script>'), null)
  assert.equal(parseHostLocale('zh-CN'), 'zh-CN')
})

test('URL host preferences are persisted for the OIDC round trip and read back later', () => {
  const storage = memoryStorage()
  const first = readHostPreferences('?kailo_theme=dark&kailo_locale=en&kailo_embed=1', storage)
  assert.deepEqual(first, { theme: 'dark', locale: 'en', embedRequested: true })
  assert.equal(storage.data[SESSION_THEME_KEY], 'dark')
  // After the IdP redirect the query string is gone; the session keeps the values.
  assert.deepEqual(readHostPreferences('', storage), { theme: 'dark', locale: 'en', embedRequested: true })
  // Invalid values are ignored and never stored.
  const other = memoryStorage()
  assert.deepEqual(readHostPreferences('?kailo_theme=neon&kailo_locale=%3Cx%3E', other),
    { theme: null, locale: null, embedRequested: false })
  assert.deepEqual(other.data, {})
})

test('framing detection treats cross-origin top access errors as framed', () => {
  const { win } = fakeWindow(true)
  assert.equal(isFramed(win), true)
  const top = fakeWindow(false).win
  assert.equal(isFramed(top), false)
  assert.equal(isEmbedded(top, { embedRequested: true }), true)
  const throwing = { self: {}, get top(): unknown { throw new Error('cross-origin') } }
  assert.equal(isFramed(throwing), true)
})

test('host messages are accepted only from the parent window and a configured Kailo origin', () => {
  const { win, parent, dispatch } = fakeWindow(true)
  const storage = memoryStorage()
  const themes: string[] = []
  const locales: string[] = []
  const stop = installHostBridge(win, [KAILO], {
    onTheme: t => themes.push(t),
    onLocale: l => locales.push(l),
  }, storage)
  dispatch({ source: parent, origin: 'https://evil.example', data: { type: 'kailo:theme', theme: 'dark' } })
  dispatch({ source: {}, origin: KAILO, data: { type: 'kailo:theme', theme: 'dark' } })
  dispatch({ source: parent, origin: KAILO, data: { type: 'kailo:theme', theme: 'neon' } })
  dispatch({ source: parent, origin: KAILO, data: 'kailo:theme' })
  dispatch({ source: parent, origin: KAILO, data: { type: 'kailo:unknown' } })
  assert.deepEqual(themes, [])
  dispatch({ source: parent, origin: KAILO, data: { type: 'kailo:theme', theme: 'dark' } })
  dispatch({ source: parent, origin: KAILO, data: { type: 'kailo:locale', locale: 'en-US' } })
  dispatch({ source: parent, origin: KAILO, data: { type: 'kailo:locale', locale: '../../x' } })
  assert.deepEqual(themes, ['dark'])
  assert.deepEqual(locales, ['en-US'])
  assert.equal(storage.data[SESSION_THEME_KEY], 'dark')
  assert.equal(storage.data[SESSION_LOCALE_KEY], 'en-US')
  stop()
  dispatch({ source: parent, origin: KAILO, data: { type: 'kailo:theme', theme: 'light' } })
  assert.deepEqual(themes, ['dark'])
})

test('without configured origins the bridge does not listen at all', () => {
  const { win, listeners } = fakeWindow(true)
  installHostBridge(win, [], { onTheme: () => assert.fail('must not listen') })
  assert.equal(listeners.length, 0)
})

test('host messages are addressed to each configured origin, and never sent at top level', () => {
  const framed = fakeWindow(true)
  const sent = postToHost(framed.win, [KAILO, 'tauri://localhost'], { type: 'kailo:auth-required', component: 'knowledge' })
  assert.equal(sent, 2)
  assert.deepEqual(framed.posted.map(p => p.origin), [KAILO, 'tauri://localhost'])
  assert.deepEqual(framed.posted[0].message, { type: 'kailo:auth-required', component: 'knowledge' })
  const top = fakeWindow(false)
  assert.equal(postToHost(top.win, [KAILO], { type: 'kailo:auth-required', component: 'knowledge' }), 0)
})
