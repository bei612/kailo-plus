import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { createRenderer, h, nextTick, reactive, ref, watch } from 'vue'

const require = createRequire(import.meta.url)
const filename = fileURLToPath(new URL('./DataSourceEditorDialog.vue', import.meta.url))
const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
const script = compileScript(descriptor, { id: 'datasource-editor-test' }).content
  .replace('__expose();', '')
  .replace('return __returned__', '__expose(__returned__); return __returned__')
const compiled = ts.transpileModule(script, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

async function fixture({ configured = true, create = false, fileStorage = false, sources = [
  { external_id: 'd0350000-0000-4000-8000-000000000001', name: 'Approved source', type: 'file_storage.folder', description: '', url: '' },
  { external_id: 'd0350000-0000-4000-8000-000000000002', name: 'Another source', type: 'file_storage.folder', description: '', url: '' },
] } = {}) {
  const calls: Array<{ method: string; args: any[] }> = []
  let storedToken = configured ? 'expired-token' : ''
  const api = {
    async getConnectorTypes(kbId: string) {
      if (!fileStorage) return []
      calls.push({ method: 'getConnectorTypes', args: [kbId] })
      return { data: sources.length === 0 ? [] : [{ type: 'file_storage', resources: sources }] }
    },
    async createDataSource(data: any) {
      calls.push({ method: 'createDataSource', args: [JSON.parse(JSON.stringify(data))] })
      return { data: { id: 'source-draft' } }
    },
    async listResources(id: string) {
      calls.push({ method: 'listResources', args: [id] })
      return { data: sources }
    },
    async triggerSync(id: string) {
      calls.push({ method: 'triggerSync', args: [id] })
    },
    async deleteDataSource(id: string) {
      calls.push({ method: 'deleteDataSource', args: [id] })
    },
    async validateCredentials(type: string, credentials: Record<string, string>) {
      calls.push({ method: 'validateCredentials', args: [type, { ...credentials }] })
      if (credentials.access_token !== 'rotated-token') throw new Error('gitlab API /user: status 401')
    },
    async validateConnection(id: string) {
      calls.push({ method: 'validateConnection', args: [id] })
      if (storedToken !== 'rotated-token') throw new Error('gitlab API /user: status 401')
    },
    async updateDataSource(id: string, data: any) {
      calls.push({ method: 'updateDataSource', args: [id, JSON.parse(JSON.stringify(data))] })
      // The main update endpoint deliberately preserves stored credentials.
    },
    async putDataSourceCredentials(id: string, credentials: Record<string, string>) {
      calls.push({ method: 'putDataSourceCredentials', args: [id, { ...credentials }] })
      storedToken = credentials.access_token
    },
  }
  const props = reactive({
    visible: false, kbId: 'kb-one',
    dataSource: create ? null : {
      id: 'source-one', name: 'GitLab', type: fileStorage ? 'file_storage' : 'gitlab',
      credentials: { credentials: { configured } },
      config: { resource_ids: [], settings: { projects: [{ project_id: '123', paths: [] }] } },
      sync_schedule: '0 0 */6 * * *', sync_mode: 'incremental',
      conflict_strategy: 'overwrite', sync_deletions: true,
    },
  })
  const exports: any = {}
  runInNewContext(compiled, {
    exports,
    require(name: string) {
      if (name === 'vue') return require('vue')
      if (name === 'vue-i18n') return { useI18n: () => ({ t: (key: string) => key }) }
      if (name === 'tdesign-vue-next') return { MessagePlugin: { warning() {}, success() {}, error() {} } }
      if (name === '@/api/datasource') return api
      return { default: {} }
    },
    URL, console,
  })
  const component = exports.default
  component.render = () => null
  const renderer = createRenderer<any, any>({
    createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
    insert() {}, remove() {}, setElementText() {}, setText() {}, patchProp() {},
    parentNode: () => null, nextSibling: () => null,
  })
  const instance = ref<any>()
  const app = renderer.createApp({ render: () => h(component, { ...props, ref: instance }) })
  app.mount({})
  props.visible = true
  await nextTick()
  await nextTick()
  const vm = instance.value
  async function replace(token = 'rotated-token') {
    vm.enterReplaceCredentials()
    vm.form.config.credentials = { base_url: 'https://gitlab.example.com', access_token: token }
    await nextTick()
  }
  return { vm, props, api, calls, replace, storedToken: () => storedToken, close: () => app.unmount() }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('rotated GitLab credentials are tested without updating the saved data source', async () => {
  const f = await fixture()
  try {
    await f.replace()
    await f.vm.testConnection()
    assert.equal(f.vm.testResult, 'success')
    assert.deepEqual(f.calls, [{ method: 'validateCredentials', args: ['gitlab', {
      base_url: 'https://gitlab.example.com', access_token: 'rotated-token',
    }] }])
    assert.equal(f.storedToken(), 'expired-token')
  } finally { f.close() }
})

test('Next tests the replacement and final save commits credentials before settings', async () => {
  const f = await fixture()
  try {
    await f.replace()
    await f.vm.nextStep()
    assert.equal(f.vm.step, 2)
    await f.vm.nextStep()
    assert.equal(f.vm.step, 3)
    await f.vm.handleSubmit()
    assert.deepEqual(f.calls.map(call => call.method), [
      'validateCredentials', 'putDataSourceCredentials', 'updateDataSource',
    ])
    assert.equal(f.storedToken(), 'rotated-token')
    assert.deepEqual(f.calls[2].args[1].config.credentials, {})
  } finally { f.close() }
})

test('invalid replacement stays on the credentials step and can be corrected', async () => {
  const f = await fixture()
  try {
    await f.replace('invalid-token')
    await f.vm.nextStep()
    assert.equal(f.vm.step, 1)
    assert.equal(f.vm.testResult, 'error')
    assert.match(f.vm.testErrorMsg, /401/)
    assert.equal(f.storedToken(), 'expired-token')
    await f.replace()
    await f.vm.nextStep()
    assert.equal(f.vm.step, 2)
  } finally { f.close() }
})

test('testing unchanged credentials still validates the stored token', async () => {
  const f = await fixture()
  try {
    await f.vm.testConnection()
    assert.equal(f.vm.testResult, 'error')
    assert.deepEqual(f.calls.map(call => call.method), ['updateDataSource', 'validateConnection'])
  } finally { f.close() }
})

test('an existing data source with no saved credentials tests the entered token', async () => {
  const f = await fixture({ configured: false })
  try {
    await f.replace()
    await f.vm.testConnection()
    assert.equal(f.vm.testResult, 'success')
    assert.deepEqual(f.calls.map(call => call.method), ['validateCredentials'])
    assert.equal(f.storedToken(), '')
  } finally { f.close() }
})

test('new GitLab data sources continue to test credentials without persistence', async () => {
  const f = await fixture({ create: true })
  try {
    f.vm.selectType(f.vm.connectorDefs.find((def: any) => def.type === 'gitlab'))
    await f.replace()
    await f.vm.testConnection()
    assert.equal(f.vm.testResult, 'success')
    assert.deepEqual(f.calls.map(call => call.method), ['validateCredentials'])
  } finally { f.close() }
})

test('governed file-storage discovery preserves every original connector and hides ungranted sources', async () => {
  const f = await fixture({ create: true, fileStorage: true, sources: [] })
  try {
    assert.deepEqual(Array.from(f.vm.connectorDefs, (def: any) => def.type), [
      'feishu', 'lark', 'feishu_drive', 'lark_drive', 'notion', 'confluence',
      'yuque', 'dingtalk', 'ima', 'rss', 'gitlab',
    ])
  } finally { f.close() }
})

test('file-storage connection detection reads current authorized sources without credentials or persistence', async () => {
  const f = await fixture({ create: true, fileStorage: true })
  try {
    f.vm.selectType(f.vm.connectorDefs.find((def: any) => def.type === 'file_storage'))
    f.calls.length = 0
    await f.vm.testConnection()
    assert.equal(f.vm.testResult, 'success')
    assert.deepEqual(f.calls, [{ method: 'getConnectorTypes', args: ['kb-one'] }])
  } finally { f.close() }
})

test('the original paused draft and resource picker save only the chosen governed sources', async () => {
  const f = await fixture({ create: true, fileStorage: true })
  try {
    f.vm.selectType(f.vm.connectorDefs.find((def: any) => def.type === 'file_storage'))
    f.calls.length = 0
    await f.vm.loadResources()
    assert.deepEqual(f.calls.map(call => call.method), ['getConnectorTypes', 'createDataSource', 'listResources'])
    const draft = f.calls[1].args[0]
    assert.equal(draft.status, 'paused')
    assert.deepEqual(draft.config.resource_ids, [
      'd0350000-0000-4000-8000-000000000001', 'd0350000-0000-4000-8000-000000000002',
    ])
    assert.deepEqual(draft.config.credentials, {})
    assert.deepEqual(draft.config.settings, {})
    assert.equal(f.vm.selectedResourceIds.length, 0)
    f.vm.toggleResource('d0350000-0000-4000-8000-000000000002')
    await f.vm.handleSubmit()
    const saved = f.calls.find(call => call.method === 'updateDataSource')!
    assert.deepEqual(saved.args[1].config.resource_ids, ['d0350000-0000-4000-8000-000000000002'])
    assert.deepEqual(f.calls.at(-1), { method: 'triggerSync', args: ['source-draft'] })
  } finally { f.close() }
})

test('empty and revoked file-storage selections do not leave the original resource step', async () => {
  const f = await fixture({ create: true, fileStorage: true })
  try {
    f.vm.selectType(f.vm.connectorDefs.find((def: any) => def.type === 'file_storage'))
    await f.vm.loadResources()
    f.vm.step = 2
    await f.vm.nextStep()
    assert.equal(f.vm.step, 2)
    f.vm.selectedResourceIds = ['d0350000-0000-4000-8000-000000000003']
    await f.vm.nextStep()
    assert.equal(f.vm.step, 2)
    f.vm.selectedResourceIds = ['d0350000-0000-4000-8000-000000000001']
    await f.vm.nextStep()
    assert.equal(f.vm.step, 3)
  } finally { f.close() }
})

test('revoked discovery does not create an empty paused draft or pass a credentials test', async () => {
  const sources = [
    { external_id: 'd0350000-0000-4000-8000-000000000001', name: 'Source', type: '', description: '', url: '' },
  ]
  const f = await fixture({ create: true, fileStorage: true, sources })
  try {
    f.vm.selectType(f.vm.connectorDefs.find((def: any) => def.type === 'file_storage'))
    sources.length = 0
    f.calls.length = 0
    await f.vm.testConnection()
    assert.equal(f.vm.testResult, 'error')
    await f.vm.loadResources()
    assert.deepEqual(f.calls.map(call => call.method), ['getConnectorTypes', 'getConnectorTypes'])
    assert.equal(f.vm.tempDsId, '')
    assert.equal(f.vm.connectorDefs.some((def: any) => def.type === 'file_storage'), false)
  } finally { f.close() }
})

test('same-KB close and reopen cannot consume an older governed directory response', async () => {
  const f = await fixture({ create: true, fileStorage: true })
  try {
    const oldDirectory = deferred<any>()
    const original = f.api.getConnectorTypes
    let calls = 0
    f.api.getConnectorTypes = async kbId => ++calls === 1 ? oldDirectory.promise : original(kbId)
    const pending = f.vm.refreshConnectorMetadata()
    f.props.visible = false
    await nextTick()
    const refreshed = deferred<void>()
    const stop = watch(() => f.vm.connectorMetadata.length, count => {
      if (count > 0) refreshed.resolve()
    }, { flush: 'sync' })
    f.props.visible = true
    await refreshed.promise
    stop()
    assert.equal(f.vm.connectorMetadata[0].resources.length, 2)
    oldDirectory.resolve({ data: [{ type: 'file_storage', resources: [{ external_id: 'old-source' }] }] })
    await pending
    assert.equal(f.vm.connectorMetadata[0].resources.length, 2)
    assert.notEqual(f.vm.connectorMetadata[0].resources[0].external_id, 'old-source')
  } finally { f.close() }
})

test('a newer revoked directory response cannot be undone by an older request in the same editor', async () => {
  const f = await fixture({ create: true, fileStorage: true })
  try {
    const oldDirectory = deferred<any>()
    let calls = 0
    f.api.getConnectorTypes = async () => ++calls === 1 ? oldDirectory.promise : { data: [] }
    const pending = f.vm.refreshConnectorMetadata()
    await f.vm.refreshConnectorMetadata()
    oldDirectory.resolve({ data: [{ type: 'file_storage', resources: [{ external_id: 'old-source' }] }] })
    await pending
    assert.equal(f.vm.connectorMetadata.length, 0)
    assert.equal(f.vm.connectorDefs.some((def: any) => def.type === 'file_storage'), false)
  } finally { f.close() }
})

test('KB changes while a paused draft is being created clean only the known old draft without listing it', async () => {
  const f = await fixture({ create: true, fileStorage: true })
  try {
    f.vm.selectType(f.vm.connectorDefs.find((def: any) => def.type === 'file_storage'))
    const created = deferred<any>()
    const started = deferred<void>()
    f.api.createDataSource = async data => {
      f.calls.push({ method: 'createDataSource', args: [JSON.parse(JSON.stringify(data))] })
      started.resolve()
      return created.promise
    }
    const pending = f.vm.loadResources()
    await started.promise
    f.props.kbId = 'kb-two'
    await nextTick()
    created.resolve({ data: { id: 'old-paused-draft' } })
    await pending
    assert.equal(f.vm.tempDsId, '')
    assert.equal(f.vm.form.type, '')
    assert.equal(f.vm.resources.length, 0)
    assert.equal(f.calls.some(call => call.method === 'listResources'), false)
    assert.deepEqual(f.calls.at(-1), { method: 'deleteDataSource', args: ['old-paused-draft'] })
    assert.equal(f.calls.find(call => call.method === 'createDataSource')!.args[0].knowledge_base_id, 'kb-one')
  } finally { f.close() }
})

test('old listing and cleanup completion cannot replace or clear a reopened editor draft', async () => {
  const f = await fixture({ create: true, fileStorage: true })
  try {
    f.vm.selectType(f.vm.connectorDefs.find((def: any) => def.type === 'file_storage'))
    const listed = deferred<any>()
    const started = deferred<void>()
    const deleted = deferred<void>()
    f.api.listResources = async id => {
      f.calls.push({ method: 'listResources', args: [id] })
      started.resolve()
      return listed.promise
    }
    f.api.deleteDataSource = async id => {
      f.calls.push({ method: 'deleteDataSource', args: [id] })
      return deleted.promise
    }
    const pending = f.vm.loadResources()
    await started.promise
    f.props.visible = false
    await nextTick()
    f.props.visible = true
    await nextTick()
    await nextTick()
    f.vm.tempDsId = 'new-paused-draft'
    deleted.resolve()
    listed.resolve({ data: [{ external_id: 'old-source' }] })
    await pending
    assert.equal(f.vm.tempDsId, 'new-paused-draft')
    assert.equal(f.vm.resources.length, 0)
    assert.equal(f.vm.loadingResources, false)
    assert.deepEqual(f.calls.filter(call => call.method === 'deleteDataSource'), [
      { method: 'deleteDataSource', args: ['source-draft'] },
    ])
  } finally { f.close() }
})

test('an old connection test does not advance a reopened original credential editor', async () => {
  const f = await fixture({ configured: false })
  try {
    await f.replace()
    const validated = deferred<void>()
    const started = deferred<void>()
    f.api.validateCredentials = async () => { started.resolve(); return validated.promise }
    const pending = f.vm.nextStep()
    await started.promise
    f.props.visible = false
    await nextTick()
    f.props.visible = true
    await nextTick()
    validated.resolve()
    await pending
    assert.equal(f.vm.step, 1)
    assert.equal(f.vm.testResult, '')
    assert.equal(f.vm.testing, false)
  } finally { f.close() }
})

test('credential replacement completion after a KB change cannot update the new scope', async () => {
  const f = await fixture()
  try {
    await f.replace()
    const replaced = deferred<void>()
    const started = deferred<void>()
    f.api.putDataSourceCredentials = async id => {
      f.calls.push({ method: 'putDataSourceCredentials', args: [id] })
      started.resolve()
      return replaced.promise
    }
    const pending = f.vm.handleSubmit()
    await started.promise
    f.props.kbId = 'kb-two'
    await nextTick()
    replaced.resolve()
    await pending
    assert.equal(f.calls.some(call => call.method === 'updateDataSource'), false)
    assert.equal(f.vm.submitting, false)
    assert.deepEqual(f.calls[0], { method: 'putDataSourceCredentials', args: ['source-one'] })
  } finally { f.close() }
})

test('closing during activation never deletes a possibly active draft or syncs from a reopened editor', async () => {
  const f = await fixture({ create: true, fileStorage: true })
  try {
    f.vm.selectType(f.vm.connectorDefs.find((def: any) => def.type === 'file_storage'))
    await f.vm.loadResources()
    f.vm.toggleResource('d0350000-0000-4000-8000-000000000001')
    const updated = deferred<void>()
    const started = deferred<void>()
    f.api.updateDataSource = async (id, data) => {
      f.calls.push({ method: 'updateDataSource', args: [id, JSON.parse(JSON.stringify(data))] })
      started.resolve()
      return updated.promise
    }
    const pending = f.vm.handleSubmit()
    await started.promise
    f.props.visible = false
    await nextTick()
    f.props.visible = true
    await nextTick()
    updated.resolve()
    await pending
    assert.equal(f.calls.some(call => call.method === 'deleteDataSource'), false)
    assert.equal(f.calls.some(call => call.method === 'triggerSync'), false)
    assert.equal(f.props.visible, true)
    assert.equal(f.vm.step, 0)
    assert.equal(f.vm.submitting, false)
  } finally { f.close() }
})

test('save refreshes governed source authorization before activating or syncing a paused draft', async () => {
  const sources = [{ external_id: 'd0350000-0000-4000-8000-000000000001', name: 'Source', type: '', description: '', url: '' }]
  const f = await fixture({ create: true, fileStorage: true, sources })
  try {
    f.vm.selectType(f.vm.connectorDefs.find((def: any) => def.type === 'file_storage'))
    await f.vm.loadResources()
    f.vm.toggleResource(sources[0].external_id)
    sources.length = 0
    f.calls.length = 0
    await f.vm.handleSubmit()
    assert.deepEqual(f.calls, [{ method: 'getConnectorTypes', args: ['kb-one'] }])
    assert.equal(f.vm.tempDsId, 'source-draft')
    assert.equal(f.vm.submitting, false)
  } finally { f.close() }
})

test('returning to the same connector discards only its older confirmed paused creation', async () => {
  const f = await fixture({ create: true, fileStorage: true })
  try {
    const storage = f.vm.connectorDefs.find((def: any) => def.type === 'file_storage')
    const other = f.vm.connectorDefs.find((def: any) => def.type === 'confluence')
    f.vm.selectType(storage)
    const created = deferred<any>()
    const started = deferred<void>()
    f.api.createDataSource = async data => {
      f.calls.push({ method: 'createDataSource', args: [JSON.parse(JSON.stringify(data))] })
      started.resolve()
      return created.promise
    }
    const pending = f.vm.loadResources()
    await started.promise
    f.vm.selectType(other)
    f.vm.selectType(storage)
    created.resolve({ data: { id: 'old-paused-draft' } })
    await pending
    assert.equal(f.vm.tempDsId, '')
    assert.equal(f.vm.resources.length, 0)
    assert.equal(f.vm.loadingResources, false)
    assert.equal(f.calls.some(call => call.method === 'listResources'), false)
    assert.deepEqual(f.calls.filter(call => call.method === 'deleteDataSource'), [
      { method: 'deleteDataSource', args: ['old-paused-draft'] },
    ])
  } finally { f.close() }
})

test('returning to the same credential connector cannot accept its earlier successful test', async () => {
  const f = await fixture({ create: true, configured: false })
  try {
    const gitlab = f.vm.connectorDefs.find((def: any) => def.type === 'gitlab')
    const other = f.vm.connectorDefs.find((def: any) => def.type === 'confluence')
    f.vm.selectType(gitlab)
    await f.replace()
    const validated = deferred<void>()
    const started = deferred<void>()
    f.api.validateCredentials = async () => { started.resolve(); return validated.promise }
    const pending = f.vm.nextStep()
    await started.promise
    f.vm.selectType(other)
    f.vm.selectType(gitlab)
    await nextTick()
    validated.resolve()
    await pending
    assert.equal(f.vm.step, 1)
    assert.equal(f.vm.testResult, '')
    assert.equal(f.vm.testing, false)
    assert.equal(f.calls.some(call => call.method === 'createDataSource'), false)
  } finally { f.close() }
})

test('connector changes release the busy form without deleting or syncing an uncertain activation', async () => {
  const f = await fixture({ create: true, fileStorage: true })
  try {
    const storage = f.vm.connectorDefs.find((def: any) => def.type === 'file_storage')
    const other = f.vm.connectorDefs.find((def: any) => def.type === 'confluence')
    f.vm.selectType(storage)
    await f.vm.loadResources()
    f.vm.toggleResource('d0350000-0000-4000-8000-000000000001')
    const updated = deferred<void>()
    const started = deferred<void>()
    f.api.updateDataSource = async () => { started.resolve(); return updated.promise }
    const pending = f.vm.handleSubmit()
    await started.promise
    assert.equal(f.vm.submitting, true)
    f.vm.selectType(other)
    f.vm.selectType(storage)
    assert.equal(f.vm.submitting, false)
    updated.resolve()
    await pending
    assert.equal(f.vm.tempDsId, '')
    assert.equal(f.vm.resources.length, 0)
    assert.equal(f.vm.step, 1)
    assert.equal(f.calls.some(call => call.method === 'deleteDataSource'), false)
    assert.equal(f.calls.some(call => call.method === 'triggerSync'), false)
  } finally { f.close() }
})
