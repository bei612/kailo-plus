import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  ADMIN_SURFACES,
  BUSINESS_HOME,
  NATIVE_ADMIN_PATH_PREFIXES,
  adminSurfaceForPath,
  adminSurfaceText,
  isAdminSurfaceKeyShape,
  isNativeAdminPath,
  resolveAdminSurface,
  unavailableText,
} from './adminSurface'
import { modelSections, parserSections, storageSections } from './adminReadOnly'

const manifest = JSON.parse(
  readFileSync(new URL('../../../fork/release/manifest.native-page.json', import.meta.url), 'utf8'),
)
const entrypoint = readFileSync(new URL('../../docker-entrypoint.sh', import.meta.url), 'utf8')
const nginxTemplate = readFileSync(new URL('../../nginx.conf', import.meta.url), 'utf8')

const RESERVED_FIRST = ['members', 'roles', 'invitations', 'users', 'groups', 'spaces', 'organizations', 'tenants', 'workspaces']
const FIELD_ORDER = ['key', 'adminCategory', 'path', 'requiredPermission', 'access', 'title', 'description']

test('the release declares exactly the build table, in contract field order (07 §4.8.5)', () => {
  const declared = manifest.frontendPresentationContract.adminSurfaces
  assert.equal(manifest.version, '1.7.0-native-page')
  assert.deepEqual(declared, JSON.parse(JSON.stringify(ADMIN_SURFACES)))
  for (const item of declared) assert.deepEqual(Object.keys(item), FIELD_ORDER, item.key)
  assert.equal(manifest.frontendPresentationContract.integrationMode, 'KAILO_EMBED')
  assert.equal(manifest.frontendDelivery.mode, 'NATIVE_PAGE')
})

test('every declaration satisfies the Core contract', () => {
  assert.ok(ADMIN_SURFACES.length <= 12)
  assert.equal(new Set(ADMIN_SURFACES.map((s) => s.key)).size, ADMIN_SURFACES.length)
  for (const s of ADMIN_SURFACES) {
    assert.ok(isAdminSurfaceKeyShape(s.key), s.key)
    const segments = s.key.split('.')
    assert.ok(segments.length >= 2 && segments.length <= 4, s.key)
    assert.ok(!RESERVED_FIRST.includes(segments[0]), s.key)
    assert.ok(!/weknora|knowledge/i.test(s.key), `${s.key} names the component`)
    assert.match(s.path, /^(\/[A-Za-z0-9._~-]+)+$/)
    assert.ok(!s.path.split('/').some((seg) => seg === '.' || seg === '..'))
    assert.ok(s.path.startsWith('/platform/admin/'), s.path)
    assert.ok(['MODELS', 'DATA_SOURCES', 'STORAGE', 'INDEXING', 'INTEGRATIONS', 'SYSTEM'].includes(s.adminCategory))
    assert.ok(['BINDING_MANAGE', 'TENANT_MANAGE'].includes(s.requiredPermission))
    for (const text of [s.title.ZH_CN, s.title.EN]) assert.ok(text.length >= 1 && text.length <= 60, text)
    for (const text of [s.description.ZH_CN, s.description.EN]) assert.ok(text.length >= 1 && text.length <= 200, text)
  }
  const access = Object.fromEntries(ADMIN_SURFACES.map((s) => [s.key, `${s.adminCategory}/${s.access}`]))
  assert.deepEqual(access, {
    'models.catalog': 'MODELS/READ_ONLY',
    'storage.backends': 'STORAGE/READ_ONLY',
    'indexing.parsers': 'INDEXING/READ_ONLY',
    'answers.webSearch': 'INTEGRATIONS/EDITABLE',
  })
  assert.equal(manifest.frontendPresentationContract.adminSurfaces.length, 4)
})

test('DD-163: answer skills and MCP services are no admin surfaces', () => {
  for (const key of ['answers.skills', 'answers.mcpServices']) {
    assert.ok(!ADMIN_SURFACES.some((s) => s.key === key), key)
    assert.ok(!manifest.frontendPresentationContract.adminSurfaces.some((s: { key: string }) => s.key === key), key)
    assert.ok(!entrypoint.includes(key), key)
  }
  // Their former paths are undeclared: no surface renders, nginx sends them home.
  assert.equal(adminSurfaceForPath('/platform/admin/skills'), null)
  assert.equal(adminSurfaceForPath('/platform/admin/mcp-services'), null)
  assert.equal(resolveAdminSurface('/platform/admin/skills', 'answers.skills'), null)
  assert.equal(resolveAdminSurface('/platform/admin/mcp-services', 'answers.mcpServices'), null)
})

test('a launched key renders only on its own path', () => {
  assert.equal(resolveAdminSurface('/platform/admin/models', 'models.catalog')?.key, 'models.catalog')
  assert.equal(resolveAdminSurface('/platform/admin/models/', 'models.catalog')?.key, 'models.catalog')
  assert.equal(resolveAdminSurface('/platform/admin/web-search', 'answers.webSearch')?.access, 'EDITABLE')
  // Key of another surface, unknown key, missing or malformed key: nothing renders.
  assert.equal(resolveAdminSurface('/platform/admin/models', 'answers.skills'), null)
  assert.equal(resolveAdminSurface('/platform/admin/models', 'models.other'), null)
  assert.equal(resolveAdminSurface('/platform/admin/models', null), null)
  assert.equal(resolveAdminSurface('/platform/admin/models', ''), null)
  assert.equal(resolveAdminSurface('/platform/admin/models', 'Models.catalog'), null)
  assert.equal(resolveAdminSurface('/platform/admin/models', 'models'), null)
  assert.equal(resolveAdminSurface('/platform/admin/models', `models.${'a'.repeat(64)}`), null)
  assert.equal(resolveAdminSurface('/platform/admin/unknown', 'models.catalog'), null)
  assert.equal(resolveAdminSurface('/platform/settings', 'models.catalog'), null)
  assert.equal(adminSurfaceForPath('/platform/admin/parsers')?.key, 'indexing.parsers')
})

test('titles and the unavailable state follow the locale', () => {
  const models = adminSurfaceForPath('/platform/admin/models')!
  assert.equal(adminSurfaceText(models.title, 'zh-CN'), '模型目录')
  assert.equal(adminSurfaceText(models.title, 'en-US'), 'Model catalog')
  assert.equal(unavailableText('zh-CN').title, '该管理项不可用')
  assert.equal(unavailableText('en-US').title, 'This admin item is unavailable')
})

test('native admin console routes are closed in Kailo mode', () => {
  for (const path of [
    '/platform/settings',
    '/platform/settings/',
    '/platform/system',
    '/platform/system/settings',
    '/platform/system/admins',
    '/platform/system/queues',
    '/platform/integrations',
    '/platform/tenant',
  ]) {
    assert.ok(isNativeAdminPath(path), path)
  }
  for (const path of [
    BUSINESS_HOME,
    '/platform/knowledge-bases/kb-1',
    '/platform/agents',
    '/platform/chat/c-1',
    '/platform/admin/models',
    '/platform/settingsx',
  ]) {
    assert.ok(!isNativeAdminPath(path), path)
  }
})

function entrypointTable(): Array<[string, string]> {
  const match = entrypoint.match(/KAILO_ADMIN_SURFACES='([^']*)'/)
  assert.ok(match, 'KAILO_ADMIN_SURFACES missing from docker-entrypoint.sh')
  return match[1].split('\n').map((line) => line.trim().split(/\s+/) as [string, string])
}

test('the nginx allowlist written by docker-entrypoint.sh matches the declarations', () => {
  assert.deepEqual(entrypointTable(), ADMIN_SURFACES.map((s) => [s.path, s.key]))
  const prefixes = entrypoint.match(/KAILO_NATIVE_ADMIN_PREFIXES='([^']*)'/)?.[1].split(/\s+/) ?? []
  for (const prefix of NATIVE_ADMIN_PATH_PREFIXES) assert.ok(prefixes.includes(prefix), prefix)
  // Any other admin path redirects; declared paths are exact locations with the key check.
  assert.ok(prefixes.includes('/platform/admin/'))
  assert.match(entrypoint, new RegExp(`KAILO_HOME_PATH=${BUSINESS_HOME.replace(/\//g, '\\/')}\\n`))
  assert.match(entrypoint, /if \(\\\$arg_kailo_admin_surface != "\$surface_key"\)/)
  assert.match(entrypoint, /if \[ "\$RUNTIME_KAILO_MODE" = true \]/)
  // The template includes the generated file before the SPA fallback.
  const include = nginxTemplate.indexOf('include /etc/nginx/kailo/*.conf;')
  assert.ok(include > 0 && include < nginxTemplate.indexOf('location / {'))
})

test('model catalog lists routed models read-only, without opaque ids or hidden providers', () => {
  const sections = modelSections([
    { id: 'm1', name: '0b5f8e2c-1111-4222-8333-444455556666', type: 'KnowledgeQA', is_default: true,
      managed_by: 'kailo-model-route', parameters: { provider: 'openai', context_window: 128000, supports_vision: true } },
    { id: 'm2', name: 'bge-m3', display_name: 'BGE M3', type: 'Embedding', parameters: { provider: 'generic', embedding_parameters: { dimension: 1024 } } },
    { id: 'm3', name: 'cloud', type: 'KnowledgeQA', parameters: { provider: 'weknoracloud' } },
  ], 'zh-CN', new Set(['weknoracloud']))
  assert.deepEqual(sections.map((s) => s.title), ['对话模型', '向量模型'])
  const chat = sections[0].items
  assert.equal(chat.length, 1)
  assert.equal(chat[0].title, '默认模型')
  assert.equal(chat[0].badge, '默认')
  assert.ok(!JSON.stringify(chat).includes('0b5f8e2c'))
  assert.deepEqual(chat[0].rows.find((r) => r.label === '来源')?.value, '平台模型路由')
  assert.deepEqual(chat[0].rows.find((r) => r.label === '上下文窗口')?.value, '128,000 tokens')
  const embedding = sections[1].items[0]
  assert.equal(embedding.title, 'BGE M3')
  assert.deepEqual(embedding.rows.map((r) => [r.label, r.value]), [
    ['模型', 'bge-m3'], ['提供方', 'generic'], ['来源', '工作区'], ['向量维度', '1024'],
  ])
  const empty = modelSections([], 'en-US')
  assert.equal(empty.length, 1)
  assert.equal(empty[0].items.length, 0)
  assert.match(empty[0].empty, /model routing/)
})

test('storage lists backends and vector stores without connection secrets', () => {
  const sections = storageSections(
    [{ id: 'sb1', name: 'Primary', provider: 'minio', source: 'env', status: 'active',
      config: { endpoint: 'minio:9000', bucket_name: 'kb', access_key_id: 'AKID', secret_access_key: 'SECRET' } as never }],
    'sb1',
    [{ id: 'vs1', name: 'Vectors', engine_type: 'postgres', source: 'env', connection_config: { password: 'pw' } } as never],
    'en-US',
  )
  const text = JSON.stringify(sections)
  for (const secret of ['AKID', 'SECRET', 'pw']) assert.ok(!text.includes(secret), secret)
  assert.equal(sections[0].items[0].badge, 'Default')
  assert.deepEqual(sections[0].items[0].rows.map((r) => r.label), ['Type', 'Endpoint', 'Bucket', 'Status', 'Source'])
  assert.equal(sections[0].items[0].rows.find((r) => r.label === 'Source')?.value, 'Deployment')
  assert.deepEqual(sections[1].items[0].rows, [{ label: 'Engine', value: 'postgres' }, { label: 'Source', value: 'Deployment' }])
  const none = storageSections([], null, [], 'zh-CN')
  assert.ok(none.every((s) => s.items.length === 0 && s.empty))
})

test('parsers fold the built-in engine into the parsing service entry', () => {
  const naming = { name: (n: string) => (n === 'builtin' ? '内置解析' : n.toUpperCase()), description: (_: string, f: string) => f }
  const sections = parserSections({
    connected: true,
    docreader_transport: 'grpc',
    data: [
      { Name: 'builtin', Description: 'local', FileTypes: ['pdf', 'docx'], Available: true },
      { Name: 'mineru', Description: 'remote', FileTypes: ['pdf'], Available: false, UnavailableReason: 'not configured' },
      { Name: 'weknoracloud', FileTypes: ['pdf'], Available: true },
    ],
  }, 'zh-CN', naming, new Set(['weknoracloud']))
  assert.equal(sections[0].items.length, 1)
  assert.deepEqual(sections[0].items[0].rows.map((r) => [r.label, r.value]), [
    ['连接状态', '已连接'], ['连接方式', 'gRPC'], ['文件类型', 'pdf, docx'], ['说明', 'local'],
  ])
  assert.deepEqual(sections[1].items.map((i) => i.title), ['MINERU'])
  assert.equal(sections[1].items[0].rows[0].value, '不可用 · not configured')
})
