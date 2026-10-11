import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { compileFunction } from 'node:vm'
import * as authRefresh from './authRefresh.ts'
import type { AxiosStatic, InternalAxiosRequestConfig } from 'axios'
const axios = createRequire(import.meta.url)('axios/dist/browser/axios.cjs') as AxiosStatic

import {
  StreamAuthError,
  captureAuthRequestContext,
  forceReloginRedirect,
  isStreamAuthError,
  refreshAccessTokenShared,
  resetAuthRefreshStateForTests,
  runStreamWithAuthRetry,
} from './authRefresh.ts'

type Store = Record<string, string>

function installBrowser(pathname = '/chat') {
  const store: Store = {}
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => {
        store[key] = String(value)
      },
      removeItem: (key: string) => {
        delete store[key]
      },
    },
    configurable: true,
    writable: true,
  })
  const location = { pathname, href: `http://localhost${pathname}` }
  Object.defineProperty(globalThis, 'window', {
    value: { location },
    configurable: true,
    writable: true,
  })
  return { store, location }
}

test.afterEach(() => {
  resetAuthRefreshStateForTests()
})

test('isStreamAuthError matches the class and name-only wrappers', () => {
  assert.equal(isStreamAuthError(new StreamAuthError(401)), true)
  assert.equal(isStreamAuthError({ name: 'StreamAuthError', message: 'HTTP 401' }), true)
  assert.equal(isStreamAuthError(new Error('HTTP 401')), false)
  assert.equal(isStreamAuthError('HTTP 401'), false)
})

test('concurrent 401s share a single refresh call', async () => {
  const { store } = installBrowser()
  store.weknora_refresh_token = 'rt-1'
  let calls = 0
  let release!: (value: { success: true; data: { token: string; refreshToken: string } }) => void
  const pending = new Promise<{ success: true; data: { token: string; refreshToken: string } }>(
    (resolve) => {
      release = resolve
    },
  )
  const refresh = async () => {
    calls += 1
    return pending
  }

  const first = refreshAccessTokenShared({ refresh })
  await Promise.resolve()
  const second = refreshAccessTokenShared({ refresh })
  assert.equal(calls, 1)

  release({ success: true, data: { token: 'access-2', refreshToken: 'rt-2' } })
  assert.deepEqual(await Promise.all([first, second]), ['access-2', 'access-2'])
  assert.equal(store.weknora_token, 'access-2')
  assert.equal(store.weknora_refresh_token, 'rt-2')
  assert.equal(calls, 1)
})

test('missing refresh token clears credentials, redirects, and throws an Error', async () => {
  const { store, location } = installBrowser()
  store.weknora_token = 'expired'
  store.weknora_user = '{}'
  store.weknora_selected_tenant_id = '9'

  await assert.rejects(
    () => refreshAccessTokenShared({
      refresh: async () => {
        throw new Error('should not refresh')
      },
      messages: { pleaseRelogin: 'please-relogin', tokenRefreshFailed: 'refresh-failed' },
    }),
    (err: unknown) => err instanceof Error && err.message === 'please-relogin',
  )
  assert.equal(store.weknora_token, undefined)
  assert.equal(store.weknora_selected_tenant_id, undefined)
  assert.equal(location.href, '/login')
})

test('a failed refresh clears the newly irrelevant session and redirects', async () => {
  const { store, location } = installBrowser()
  store.weknora_refresh_token = 'rt-dead'
  store.weknora_token = 'expired'
  store.weknora_selected_tenant_id = '9'

  await assert.rejects(
    () => refreshAccessTokenShared({
      refresh: async () => ({ success: false, message: 'revoked' }),
    }),
    /revoked/,
  )
  assert.equal(store.weknora_refresh_token, undefined)
  assert.equal(store.weknora_selected_tenant_id, undefined)
  assert.equal(location.href, '/login')
})

test('runStreamWithAuthRetry refreshes once and replays with the new token', async () => {
  installBrowser()
  const tokens: string[] = []
  const result = await runStreamWithAuthRetry({
    initialToken: 'expired',
    isEmbed: false,
    isCurrent: () => true,
    refreshAccessToken: async () => 'fresh',
    reloginMessage: 'please-relogin',
    run: async (token) => {
      tokens.push(token)
      if (token === 'expired') throw new StreamAuthError(401)
      return `ok:${token}`
    },
  })
  assert.deepEqual(tokens, ['expired', 'fresh'])
  assert.equal(result, 'ok:fresh')
})

test('embed visitors are not refreshed or redirected', async () => {
  let refreshed = 0
  await assert.rejects(
    () => runStreamWithAuthRetry({
      initialToken: 'embed-token',
      isEmbed: true,
      isCurrent: () => true,
      refreshAccessToken: async () => {
        refreshed += 1
        return 'nope'
      },
      reloginMessage: 'please-relogin',
      run: async () => {
        throw new StreamAuthError(401)
      },
    }),
    (err: unknown) => err instanceof StreamAuthError,
  )
  assert.equal(refreshed, 0)
})

test('a second handshake 401 after a successful refresh does not wipe tokens', async () => {
  const { store, location } = installBrowser()
  store.weknora_token = 'expired'
  store.weknora_refresh_token = 'rt-1'
  location.href = 'http://localhost/chat'

  await assert.rejects(
    () => runStreamWithAuthRetry({
      initialToken: 'expired',
      isEmbed: false,
      isCurrent: () => true,
      refreshAccessToken: async () => {
        const token = await refreshAccessTokenShared({
          refresh: async () => ({
            success: true,
            data: { token: 'fresh', refreshToken: 'rt-2' },
          }),
        })
        return token
      },
      reloginMessage: 'please-relogin',
      run: async () => {
        throw new StreamAuthError(401)
      },
    }),
    (err: unknown) => err instanceof Error && err.message === 'please-relogin',
  )
  assert.equal(store.weknora_token, 'fresh')
  assert.equal(store.weknora_refresh_token, 'rt-2')
  assert.equal(location.href, 'http://localhost/chat')
})

test('a superseded send skips the replay', async () => {
  let runs = 0
  const result = await runStreamWithAuthRetry({
    initialToken: 'expired',
    isEmbed: false,
    isCurrent: () => false,
    refreshAccessToken: async () => 'fresh',
    reloginMessage: 'please-relogin',
    run: async () => {
      runs += 1
      throw new StreamAuthError(401)
    },
  })
  assert.equal(runs, 1)
  assert.equal(result, undefined)
})

test('forceReloginRedirect does not bounce embed visitors to /login', () => {
  const { store, location } = installBrowser('/embed/ch-1')
  store.weknora_token = 'jwt'
  forceReloginRedirect()
  assert.equal(store.weknora_token, undefined)
  assert.equal(location.href, 'http://localhost/embed/ch-1')
})

test('chat stream wires the shared retry and keeps the abort controller', () => {
  const source = readFileSync(new URL('../api/chat/streame.ts', import.meta.url), 'utf8')
  assert.match(source, /runStreamWithAuthRetry/)
  assert.match(source, /isStreamAuthError/)
  assert.match(source, /streamAbort/)
  assert.doesNotMatch(source, /forceReloginRedirect/)
  assert.match(source, /context: authContext/)
  assert.match(source, /onmessage:[\s\S]*?authContext\?\.assertCurrent/)
})

for (const outcome of ['success', 'failure'] as const) {
  test(`late ${outcome} of A refresh cannot overwrite or clear B login`, async () => {
    const { store, location } = installBrowser()
    store.weknora_token = 'access-A'
    store.weknora_refresh_token = 'refresh-A'
    const context = captureAuthRequestContext()
    let complete!: (result: { success: boolean; data?: { token: string; refreshToken: string } }) => void
    const pending = refreshAccessTokenShared({ context, refresh: () => new Promise(resolve => { complete = resolve }) })
    store.weknora_token = 'access-B'
    store.weknora_refresh_token = 'refresh-B'
    store.weknora_selected_tenant_id = 'B-scope'
    complete(outcome === 'success'
      ? { success: true, data: { token: 'rotated-A', refreshToken: 'rotated-refresh-A' } }
      : { success: false })
    await assert.rejects(pending)
    assert.equal(store.weknora_token, 'access-B')
    assert.equal(store.weknora_refresh_token, 'refresh-B')
    assert.equal(store.weknora_selected_tenant_id, 'B-scope')
    assert.equal(location.href, 'http://localhost/chat')
  })
}

test('new session refresh is independent of an in-flight old refresh', async () => {
  const { store } = installBrowser()
  store.weknora_token = 'A'
  store.weknora_refresh_token = 'RA'
  let finishA!: (result: { success: boolean }) => void
  const a = refreshAccessTokenShared({ refresh: () => new Promise(resolve => { finishA = resolve }) })
  store.weknora_token = 'B'
  store.weknora_refresh_token = 'RB'
  const b = await refreshAccessTokenShared({ refresh: async token => {
    assert.equal(token, 'RB')
    return { success: true, data: { token: 'B2', refreshToken: 'RB2' } }
  } })
  finishA({ success: false })
  await assert.rejects(a)
  assert.equal(b, 'B2')
  assert.equal(store.weknora_token, 'B2')
})

test('late 401 uses the proven rotation without refreshing twice', async () => {
  const { store } = installBrowser()
  store.weknora_token = 'A'
  store.weknora_refresh_token = 'RA'
  const first = captureAuthRequestContext()
  const delayed = captureAuthRequestContext()
  const refresh = async () => ({ success: true, data: { token: 'A2', refreshToken: 'RA2' } })
  await refreshAccessTokenShared({ context: first, refresh })
  assert.equal(await refreshAccessTokenShared({ context: delayed, refresh: async () => {
    assert.fail('already rotated credentials must not refresh again')
  } }), 'A2')
  assert.equal(delayed.token, 'A2')
})

test('scope change preserves same-login token rotation but rejects the old request', async () => {
  const { store, location } = installBrowser()
  store.weknora_token = 'A'
  store.weknora_refresh_token = 'RA'
  store.weknora_selected_tenant_id = 'scope-A'
  const context = captureAuthRequestContext()
  let complete!: (result: { success: boolean; data: { token: string; refreshToken: string } }) => void
  const pending = refreshAccessTokenShared({ context, refresh: () => new Promise(resolve => { complete = resolve }) })
  store.weknora_selected_tenant_id = 'scope-B'
  complete({ success: true, data: { token: 'A2', refreshToken: 'RA2' } })
  await assert.rejects(pending)
  assert.equal(store.weknora_token, 'A2')
  assert.equal(store.weknora_refresh_token, 'RA2')
  assert.equal(captureAuthRequestContext().token, 'A2')
  assert.equal(location.href, 'http://localhost/chat')
})

for (const change of ['login', 'same-human-login', 'logout', 'scope'] as const) {
  test(`old request cannot refresh or replay after ${change}`, async () => {
    const { store, location } = installBrowser()
    store.weknora_token = 'A'
    store.weknora_refresh_token = 'RA'
    store.weknora_user = '{"id":"human-A"}'
    store.weknora_selected_tenant_id = 'scope-A'
    const context = captureAuthRequestContext()
    if (change === 'logout') {
      delete store.weknora_token
      delete store.weknora_refresh_token
    } else if (change === 'scope') {
      store.weknora_selected_tenant_id = 'scope-B'
    } else {
      store.weknora_token = 'new-login'
      store.weknora_refresh_token = 'new-refresh'
      if (change === 'login') store.weknora_user = '{"id":"human-B"}'
    }
    const expected = { ...store }
    const runs: string[] = []
    await assert.rejects(runStreamWithAuthRetry({
      initialToken: 'A', isEmbed: false, isCurrent: () => true, reloginMessage: 'relogin',
      run: async token => { runs.push(token); throw new StreamAuthError(401) },
      refreshAccessToken: () => refreshAccessTokenShared({ context, refresh: async () => {
        assert.fail('old request must not refresh the new session')
      } }),
    }), /relogin/)
    assert.deepEqual(runs, ['A'])
    assert.deepEqual(store, expected)
    assert.equal(location.href, 'http://localhost/chat')
    assert.throws(() => context.assertCurrent())
  })
}

// Execute the original transport modules; substitute only their imported host
// and network dependencies. No duplicate implementation of their interceptors.
function loadTransport(path: string, imports: Record<string, Record<string, unknown>>) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const code = stripTypeScriptTypes(source, { mode: 'transform' })
    .replace(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/g, (_match, bindings: string, name: string) => {
      assert.ok(name in imports, `unexpected transport dependency: ${name}`)
      const [defaultName] = bindings.split(',')
      const named = bindings.match(/\{([\s\S]*?)\}/)?.[1]
      return (!bindings.trimStart().startsWith('{') ? `const ${defaultName.trim()} = imports[${JSON.stringify(name)}].default;` : '') +
        (named ? `const {${named}} = imports[${JSON.stringify(name)}];` : '')
    })
    .replace(/export\s*\{[^}]*\};?/g, '')
    .replace(/\bexport\s+/g, '')
  return compileFunction(`${code}\nreturn typeof useStream === 'function' ? { useStream } : typeof useAuthStore === 'function' ? { useAuthStore } : typeof refreshToken === 'function' ? { refreshToken } : { get, post };`, ['imports'])(imports)
}

test('original axios interceptors reject old-scope responses and old-login 401 without replay', async () => {
  const { store } = installBrowser()
  store.weknora_token = 'A'
  store.weknora_refresh_token = 'RA'
  store.weknora_selected_tenant_id = 'scope-A'
  let request!: (config: any) => any
  let success!: (response: any) => any
  let failure!: (error: any) => Promise<unknown>
  let refreshCalls = 0
  const instance = Object.assign(() => { assert.fail('must not replay old request') }, {
    interceptors: {
      request: { use: (handler: typeof request, onError: (error: Error) => unknown, options: { synchronous: boolean }) => {
        assert.equal(options.synchronous, true)
        const rejection = new Error('dispatch rejected')
        assert.throws(() => onError(rejection), error => error === rejection)
        request = handler
      } },
      response: { use: (ok: typeof success, fail: typeof failure) => { success = ok; failure = fail } },
    },
  })
  await loadTransport('./request.ts', {
    axios: { default: { create: () => instance } },
    './index': { generateRandomString: () => 'request', MAX_FILE_SIZE_MB: 1, MAX_SKILL_BUNDLE_SIZE_MB: 1 },
    '@/i18n': { default: { global: { t: (key: string) => key, locale: { value: 'zh-CN' } } } },
    './api-base': { getApiBaseUrl: () => '/api' },
    './uploadLimit': { isSkillBundleUploadUrl: () => false },
    './requestTimeouts': { isTimeoutError: () => false, uploadTimeoutMs: () => 1 },
    './authRefresh': { ...authRefresh, refreshAccessTokenShared: async () => { refreshCalls++; return 'B' } },
  })
  const original = request({ url: '/knowledge', headers: {} })
  assert.equal(original.headers.Authorization, 'Bearer A')
  store.weknora_selected_tenant_id = 'scope-B'
  assert.throws(() => success({ config: original, status: 200, data: { secret: 'A-result' } }))
  assert.throws(() => request(original))
  store.weknora_token = 'B'
  store.weknora_refresh_token = 'RB'
  await assert.rejects(failure({ config: original, response: { status: 401, data: {} } }))
  assert.equal(refreshCalls, 0)
  const current = request({ url: '/knowledge', headers: {} })
  assert.equal(current.headers.Authorization, 'Bearer B')
  assert.equal(current.headers['X-Tenant-ID'], 'scope-B')
})

test('original SSE consumer rejects post-switch chunks before delivering them', async () => {
  const { store } = installBrowser()
  store.weknora_token = 'A'
  store.weknora_refresh_token = 'RA'
  let received = 0
  const module = await loadTransport('../api/chat/streame.ts', {
    '@microsoft/fetch-event-source': { fetchEventSource: async (_url: string, options: any) => {
      await options.onopen({ status: 200, ok: true })
      store.weknora_token = 'B'
      store.weknora_refresh_token = 'RB'
      options.onmessage({ data: '{"type":"answer","content":"A-secret"}' })
    } },
    vue: { ref: (value: unknown) => ({ value }), onUnmounted: () => {} },
    '@/utils/index': { generateRandomString: () => 'request' },
    '@/i18n': { default: { global: { t: (key: string) => key, locale: { value: 'zh-CN' } } } },
    '@/utils/api-base': { getApiBaseUrl: () => '/api' },
    '@/utils/chatRequestDebug': { sanitizeStreamRequestBody: (body: unknown) => body },
    '@/utils/authRefresh': authRefresh,
  })
  const stream = (module as unknown as { useStream: () => any }).useStream()
  stream.onChunk(() => { received++ })
  await stream.startStream({ method: 'POST', url: '/chat', session_id: 'session', query: 'query' })
  assert.equal(received, 0)
  assert.equal(stream.error.value, 'error.pleaseRelogin')
  assert.equal(store.weknora_token, 'B')
})

test('original auth store invalidates old requests even when a new login has identical token bytes', async () => {
  const { store } = installBrowser()
  store.weknora_token = 'same-second-access'
  store.weknora_refresh_token = 'same-second-refresh'
  const context = captureAuthRequestContext()
  const module = loadTransport('../stores/auth.ts', {
    pinia: { defineStore: (_name: string, setup: () => unknown) => setup },
    vue: { ref: (value: unknown) => ({ value }), computed: (getter: () => unknown) => ({ get value() { return getter() } }) },
    '@/api/auth': { userInfoFromApi: (user: unknown) => user },
    '@/i18n': { default: { global: { t: (key: string) => key } } },
    '@/composables/useFont': { reloadFontFromStorage: () => {} },
    '@/composables/useTheme': { reloadThemeFromStorage: () => {} },
    '@/composables/preferenceStorage': { resetMigrationLatch: () => {} },
    '@/api/agent': { BUILTIN_QUICK_ANSWER_ID: 'builtin' },
    '@/stores/chatResources': { useChatResourcesStore: () => ({ invalidate() {} }) },
    '@/stores/editorResources': { useEditorResourcesStore: () => ({ invalidate() {} }) },
    '@/stores/organization': { useOrganizationStore: () => ({ clearState() {} }) },
    '@/utils/authRefresh': authRefresh,
  })
  const auth = module.useAuthStore()
  auth.setToken('same-second-access')
  auth.setRefreshToken('same-second-refresh')
  assert.throws(() => context.assertCurrent())
  const next = captureAuthRequestContext()
  assert.equal(next.token, 'same-second-access')
  auth.logout()
  // Simulate an identical credential pair restored after the explicit logout.
  store.weknora_token = 'same-second-access'
  store.weknora_refresh_token = 'same-second-refresh'
  assert.throws(() => next.assertCurrent())
})

test('locked axios freezes identity before the first microtask and stops rejected redispatch', async () => {
  const { store } = installBrowser()
  store.weknora_token = 'A'
  store.weknora_refresh_token = 'RA'
  let sent!: InternalAxiosRequestConfig
  let finish!: (response: any) => void
  let calls = 0
  let client!: ReturnType<typeof axios.create>
  const module = loadTransport('./request.ts', {
    axios: { default: { create: (config: any) => (client = axios.create({ ...config,
      adapter: (request: InternalAxiosRequestConfig) => {
        calls++
        sent = request
        return new Promise(resolve => { finish = resolve })
      },
    })) } },
    './index': { generateRandomString: () => 'request', MAX_FILE_SIZE_MB: 1, MAX_SKILL_BUNDLE_SIZE_MB: 1 },
    '@/i18n': { default: { global: { t: (key: string) => key, locale: { value: 'zh-CN' } } } },
    './api-base': { getApiBaseUrl: () => '/api' },
    './uploadLimit': { isSkillBundleUploadUrl: () => false },
    './requestTimeouts': { isTimeoutError: () => false, uploadTimeoutMs: () => 1 },
    './authRefresh': authRefresh,
  })
  const pending = module.get('/knowledge')
  store.weknora_token = 'B'
  store.weknora_refresh_token = 'RB'
  assert.equal(calls, 1, 'request must capture and dispatch synchronously, before switching login')
  assert.equal(sent.headers.Authorization, 'Bearer A')
  finish({ config: sent, status: 200, statusText: 'OK', headers: {}, data: { content: 'A' } })
  await assert.rejects(pending)
  await assert.rejects(client(sent))
  assert.equal(calls, 1, 'failed synchronous interceptor must not continue into dispatch')
})

for (const change of ['scope', 'login', 'logout'] as const) {
  test(`original auth API and axios keep refresh owned by login across ${change}`, async () => {
    const { store, location } = installBrowser()
    store.weknora_token = 'A'
    store.weknora_refresh_token = 'RA'
    store.weknora_selected_tenant_id = 'scope-A'
    const context = captureAuthRequestContext()
    let sent!: InternalAxiosRequestConfig
    let finish!: (response: any) => void
    let calls = 0
    const transport = loadTransport('./request.ts', {
      axios: { default: { create: (config: any) => axios.create({ ...config,
        adapter: (request: InternalAxiosRequestConfig) => {
          calls++
          sent = request
          return new Promise(resolve => { finish = resolve })
        },
      }) } },
      './index': { generateRandomString: () => 'request', MAX_FILE_SIZE_MB: 1, MAX_SKILL_BUNDLE_SIZE_MB: 1 },
      '@/i18n': { default: { global: { t: (key: string) => key, locale: { value: 'zh-CN' } } } },
      './api-base': { getApiBaseUrl: () => '/api' },
      './uploadLimit': { isSkillBundleUploadUrl: () => false },
      './requestTimeouts': { isTimeoutError: () => false, uploadTimeoutMs: () => 1 },
      './authRefresh': authRefresh,
    })
    const api = loadTransport('../api/auth/index.ts', {
      '@/utils/request': transport,
      '@/i18n': { default: { global: { t: (key: string) => key } } },
    })
    const pending = refreshAccessTokenShared({ context, refresh: api.refreshToken })
    assert.equal(sent.url, '/api/v1/auth/refresh')
    assert.deepEqual(JSON.parse(sent.data), { refreshToken: 'RA' })
    assert.equal(sent.headers.Authorization, 'Bearer A')
    if (change === 'scope') {
      store.weknora_selected_tenant_id = 'scope-B'
    } else if (change === 'login') {
      store.weknora_token = 'B'
      store.weknora_refresh_token = 'RB'
    } else {
      authRefresh.clearAuthStorage()
    }
    finish({ config: sent, status: 200, statusText: 'OK', headers: {}, data: {
      success: true, access_token: 'A2', refresh_token: 'RA2',
    } })
    await assert.rejects(pending)
    assert.equal(calls, 1, 'the old business request must not replay under another scope or login')
    assert.equal(store.weknora_token, change === 'scope' ? 'A2' : change === 'login' ? 'B' : undefined)
    assert.equal(store.weknora_refresh_token, change === 'scope' ? 'RA2' : change === 'login' ? 'RB' : undefined)
    assert.equal(location.href, 'http://localhost/chat')
  })
}
