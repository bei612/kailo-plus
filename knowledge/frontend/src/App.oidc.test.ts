import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'

// Compile the actual root template as well as its script: replacing mounted
// hooks with callbacks would miss Vue's child-before-parent mount ordering.
const filename = new URL('./App.vue', import.meta.url)
const { descriptor } = parse(readFileSync(filename, 'utf8'))
const script = compileScript(descriptor, { id: 'oidc-root', inlineTemplate: true }).content
const compiled = ts.transpileModule(script, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await vue.nextTick() }

type KailoCallbackStub = {
  callbackPath: (location: unknown) => string
  resolveOIDCErrorRoute: (code: string, prompt: string | null, returnPath: string, env: unknown) => string | null
  resolveSuccessRoute: (returnPath: string, fallback: string) => string
  nativeInvitationsEnabled?: () => boolean
  nativeLoginNoticeEnabled?: () => boolean
}

// Outside Kailo mode the callback module keeps the native behaviour.
const nativeCallback: KailoCallbackStub = {
  callbackPath: () => '',
  resolveOIDCErrorRoute: () => null,
  resolveSuccessRoute: (_path, fallback) => fallback,
  nativeInvitationsEnabled: () => true,
}

function fixture(callback: 'success' | 'error' | 'none' | { hash: string } = 'success', kailo: KailoCallbackStub = nativeCallback) {
  const userInfo = deferred<any>()
  const navigation = deferred<void>()
  const mounts: Array<{ name: string; token: string; tenant: unknown; path: string }> = []
  const routes: string[] = []
  const errors: string[] = []
  const meRequests: string[] = []
  const invitationScopes: unknown[] = []
  let path = '/'
  const store = vue.reactive({
    token: '', refreshToken: '', user: null as any, tenant: null as any,
    memberships: [] as any[], isLoggedIn: false, hasValidTenant: false,
    setToken(token: string) { this.token = token; this.isLoggedIn = !!token },
    setRefreshToken(token: string) { this.refreshToken = token },
    setUser(user: any) { this.user = user; this.isLoggedIn = true },
    setTenant(tenant: any) { this.tenant = tenant; this.hasValidTenant = !!tenant },
    setMemberships(value: any[]) { this.memberships = value },
    setCanCreateTenant() {}, setSelectedTenant() {},
    fetchPendingInvitationCount() { invitationScopes.push(this.tenant?.id) },
    logout() { this.token = ''; this.user = null; this.tenant = null; this.isLoggedIn = false },
  })
  const child = (name: string) => vue.defineComponent({ setup() {
    vue.onMounted(() => { mounts.push({ name, token: store.token, tenant: store.tenant?.id, path }) })
    return () => null
  } })
  const hash = typeof callback === 'object' ? callback.hash : callback === 'none' ? '' : callback === 'error' ? '#oidc_error=denied' :
    '#oidc_result=' + Buffer.from(JSON.stringify({ success: true, token: 'native-session', refresh_token: 'native-refresh' })).toString('base64url')
  const location = { hash }
  const exports: any = {}
  runInNewContext(compiled, {
    exports, URLSearchParams, Uint8Array, TextDecoder,
    window: {
      location, atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
      history: { replaceState: (_state: unknown, _title: string, nextPath: string) => { path = nextPath; location.hash = '' } },
    },
    document: { title: 'WeKnora' }, sessionStorage: { getItem: () => null },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1,
    console: { error: (_message: string, error: Error) => errors.push(error.message) },
    require(name: string) {
      if (name === 'vue') return vue
      if (name === 'vue-router') return { useRouter: () => ({ replace: async (nextPath: string) => {
        routes.push(nextPath); await navigation.promise; path = nextPath
      } }) }
      if (name === 'vue-i18n') return { useI18n: () => ({ locale: vue.ref('zh-CN'), t: (key: string) => key, tm: () => '' }) }
      if (name === '@/stores/auth') return { useAuthStore: () => store }
      if (name === '@/stores/settings') return { useSettingsStore: () => ({ isAutoCheckUpdateEnabled: false }) }
      if (name === '@/api/auth') return {
        getCurrentUser: () => { meRequests.push(store.token); return userInfo.promise },
        userInfoFromApi: (user: unknown) => user,
      }
      if (name === '@/utils/tenantSwitch') return { consumePendingTenantSwitchToast: () => null }
      if (name === '@/composables/useRoleLabel') return { useRoleLabel: () => ({ formatRole: () => '', roleIcon: () => '' }) }
      if (name === '@/utils/loginNotify') return { notifyLoginSuccess() {} }
      if (name === '@/utils/workspaceNotifyContent') return { renderWorkspaceNotifyContent() {} }
      if (name === '@/kailo/oidcCallback') return { nativeInvitationsEnabled: () => true, nativeLoginNoticeEnabled: () => true, ...kailo }
      if (name === 'tdesign-vue-next') return {
        MessagePlugin: { error: (message: string) => errors.push(message), success() {}, warning() {} },
        NotifyPlugin: { success() {} },
      }
      if (name.startsWith('tdesign-vue-next/esm/locale/')) return { __esModule: true, default: {} }
      if (name.startsWith('@/components/')) return { __esModule: true, default: child(name) }
      throw new Error(`unexpected App dependency: ${name}`)
    },
  })
  const node = () => ({ parent: null as any, children: [] as any[] })
  const detach = (child: any) => {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = null
  }
  const renderer = vue.createRenderer<any, any>({
    createElement: node, createText: node, createComment: node,
    insert(child, parent, anchor) {
      detach(child)
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
      child.parent = parent
    },
    remove: detach, setElementText() {}, setText() {}, patchProp() {},
    parentNode: child => child.parent,
    nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] || null,
  })
  const app = renderer.createApp(exports.default)
  app.component('RouterView', child('RouterView'))
  app.component('t-config-provider', { props: ['globalConfig'], setup: (_props: unknown, { slots }: any) => () => slots.default?.() })
  app.mount(node())
  return { store, mounts, routes, errors, meRequests, invitationScopes, userInfo, navigation, close: () => app.unmount() }
}

test('native OIDC hydrates identity and scope and completes navigation before mounting business consumers', async () => {
  const f = fixture()
  try {
    assert.deepEqual(f.meRequests, ['native-session'])
    assert.deepEqual(f.mounts, [])
    await flush()
    assert.deepEqual(f.invitationScopes, [], 'polling also waits for the native scope')
    f.userInfo.resolve({ success: true, data: {
      user: { id: 'native-human', tenant_id: 'native-scope' },
      tenant: { id: 'native-scope', name: 'Workspace' }, memberships: [],
    } })
    await flush()
    assert.deepEqual(f.routes, ['/platform/knowledge-bases'])
    assert.deepEqual(f.mounts, [], 'navigation must finish before the old route can mount')
    f.navigation.resolve()
    await flush()
    assert.equal(f.mounts.length, 4)
    for (const mount of f.mounts) {
      assert.equal(mount.token, 'native-session')
      assert.equal(mount.tenant, 'native-scope')
      assert.equal(mount.path, '/platform/knowledge-bases')
    }
    assert.deepEqual(f.errors, [])
    assert.deepEqual(f.invitationScopes, ['native-scope'])
    f.store.logout()
    await flush()
    f.store.setToken('later-login')
    await flush()
    assert.equal(f.invitationScopes.length, 2, 'later login restarts the original watcher')
  } finally { f.close() }
})

test('failed native user hydration logs out and completes login navigation before releasing consumers', async () => {
  const f = fixture()
  try {
    f.userInfo.reject(new Error('native identity rejected'))
    await flush()
    assert.deepEqual(f.mounts, [])
    assert.equal(f.store.token, '')
    assert.deepEqual(f.routes, ['/login'])
    f.navigation.resolve()
    await flush()
    assert.equal(f.mounts.length, 4)
    assert.ok(f.mounts.every(mount => mount.token === '' && mount.path === '/login'))
  } finally { f.close() }
})

test('IdP error never starts user hydration or mounts the callback route', async () => {
  const f = fixture('error')
  try {
    assert.deepEqual(f.meRequests, [])
    assert.deepEqual(f.mounts, [])
    f.navigation.resolve()
    await flush()
    assert.ok(f.mounts.every(mount => mount.path === '/login'))
    assert.deepEqual(f.errors, ['OIDC login failed'])
  } finally { f.close() }
})

test('ordinary startup mounts the original consumers without an OIDC request', async () => {
  const f = fixture('none')
  try {
    await flush()
    assert.equal(f.mounts.length, 4)
    assert.deepEqual(f.meRequests, [])
    assert.deepEqual(f.routes, [])
  } finally { f.close() }
})

const successHash = '#oidc_result=' + Buffer.from(JSON.stringify({ success: true, token: 'native-session', refresh_token: 'native-refresh' })).toString('base64url')

test('Kailo mode: a silent IdP failure routes to the neutral re-auth state without a login form or toast', async () => {
  const calls: Array<{ code: string; prompt: string | null; returnPath: string }> = []
  const f = fixture({ hash: '#oidc_error=login_required&oidc_prompt=none' }, {
    callbackPath: () => '/platform/agents',
    resolveOIDCErrorRoute: (code, prompt, returnPath) => {
      calls.push({ code, prompt, returnPath })
      return '/login?kailo_state=reauth&redirect=%2Fplatform%2Fagents'
    },
    resolveSuccessRoute: (_path, fallback) => fallback,
  })
  try {
    assert.deepEqual(calls, [{ code: 'login_required', prompt: 'none', returnPath: '/platform/agents' }])
    assert.deepEqual(f.meRequests, [])
    assert.deepEqual(f.routes, ['/login?kailo_state=reauth&redirect=%2Fplatform%2Fagents'])
    f.navigation.resolve()
    await flush()
    assert.deepEqual(f.errors, [], 'no native error toast in Kailo mode')
  } finally { f.close() }
})

test('Kailo mode: an interactive restart navigates away without routing inside the SPA', async () => {
  const f = fixture({ hash: '#oidc_error=login_required&oidc_prompt=none' }, {
    callbackPath: () => '/platform/agents',
    resolveOIDCErrorRoute: () => '',
    resolveSuccessRoute: (_path, fallback) => fallback,
  })
  try {
    await flush()
    assert.deepEqual(f.routes, [])
    assert.deepEqual(f.errors, [])
    assert.deepEqual(f.meRequests, [])
  } finally { f.close() }
})

test('Kailo mode: a successful callback lands on the originally requested page', async () => {
  const f = fixture({ hash: successHash }, {
    callbackPath: () => '/platform/agents?tab=mine',
    resolveOIDCErrorRoute: () => null,
    resolveSuccessRoute: (path) => path,
  })
  try {
    f.userInfo.resolve({ success: true, data: {
      user: { id: 'native-human', tenant_id: 'native-scope' },
      tenant: { id: 'native-scope', name: 'Workspace' }, memberships: [],
    } })
    await flush()
    assert.deepEqual(f.routes, ['/platform/agents?tab=mine'])
  } finally { f.close() }
})

test('Kailo mode: a failed user hydration shows the neutral error state instead of restarting sign-in', async () => {
  const f = fixture({ hash: successHash }, {
    callbackPath: () => '/platform/agents',
    resolveOIDCErrorRoute: (code) => code === 'login_failed' ? '/login?kailo_state=error&redirect=%2Fplatform%2Fagents' : null,
    resolveSuccessRoute: (path) => path,
    nativeLoginNoticeEnabled: () => false,
  })
  try {
    f.userInfo.reject(new Error('native identity rejected'))
    await flush()
    assert.equal(f.store.token, '')
    assert.deepEqual(f.routes, ['/login?kailo_state=error&redirect=%2Fplatform%2Fagents'])
    f.navigation.resolve()
    await flush()
    assert.deepEqual(f.errors, ['native identity rejected'], 'only the console error is recorded, no toast')
  } finally { f.close() }
})
