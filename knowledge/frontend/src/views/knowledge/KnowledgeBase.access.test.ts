import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import * as folderTree from './folderTree.ts'

// Like App.oidc.test.ts, execute the real SFC script AND template with Vue's
// renderer. HTTP/store and upload queue boundaries do not upload real files.
const { descriptor } = parse(readFileSync(new URL('./KnowledgeBase.vue', import.meta.url), 'utf8'))
const compiled = ts.transpileModule(compileScript(descriptor, {
  id: 'kb-access', inlineTemplate: true,
}).content, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await vue.nextTick() }
function deferred() {
  let resolve!: (value: any) => void
  let reject!: (reason: any) => void
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const kb = (id = 'a') => ({ id, name: `KB ${id}`, creator_id: 'human', tenant_id: 1,
  summary_model_id: 'summary', embedding_model_id: 'embedding', storage_backend_id: 'storage' })

function fixture() {
  const route = vue.reactive({ params: { kbId: 'a' }, query: {} as Record<string, string> })
  const auth = vue.reactive({ user: { id: 'human' }, currentTenantId: 1, selectedTenantId: null as number | null,
    admin: true, hasRole: () => auth.admin, isLiteMode: false })
  const reads: Array<ReturnType<typeof deferred> & { id: string; force: boolean }> = []
  const redirects: unknown[] = [], errors: string[] = [], lists: string[] = [], uploads: any[] = [], confirms: any[] = []
  const listeners = new Map<string, (event: any) => void>()
  const confirmation = deferred()
  const cardList = vue.ref<any[]>([])
  const total = vue.ref(0)
  const org = vue.reactive({ sharedKnowledgeBases: [] as any[], permission: '',
    canEditKB: () => ['editor', 'admin'].includes(org.permission),
    canManageKB: () => org.permission === 'admin', getKBPermission: () => org.permission || null })
  const noop = () => undefined
  const ui = { clearSelectedTagIds: noop, openManualEditor: (value: any) => uploads.push(value) }
  const component = (name: string) => vue.defineComponent({ inheritAttrs: false,
    setup: (_, { attrs }) => () => vue.h(name, attrs) })
  const exports: any = {}
  runInNewContext(compiled, {
    exports, console: { error: noop, log: noop }, Set, Map, Date,
    setTimeout: () => 1, clearTimeout: noop, setInterval: () => 1, clearInterval: noop,
    localStorage: { getItem: () => null, setItem: noop },
    document: { documentElement: { clientHeight: 900 } },
    window: { innerHeight: 900, setTimeout: () => 1, clearTimeout: noop,
      addEventListener: (name: string, fn: any) => listeners.set(name, fn),
      removeEventListener: (name: string) => listeners.delete(name) },
    require(name: string) {
      if (name === 'vue') return vue
      if (name === 'vue-router') return { useRoute: () => route,
        useRouter: () => ({ replace: (path: any) => { redirects.push(path); return Promise.resolve() }, push: noop }) }
      if (name === 'vue-i18n') return { useI18n: () => ({ t: (key: string) => key }) }
      if (name === 'tdesign-vue-next') return { MessagePlugin: { error: (message: string) => errors.push(message), warning: noop } }
      if (name === '@/stores/auth') return { useAuthStore: () => auth }
      if (name === '@/stores/organization') return { useOrganizationStore: () => org }
      if (name === '@/stores/ui') return { useUIStore: () => ui }
      if (name === '@/stores/menu') return { useMenuStore: () => ({}) }
      if (name === '@/stores/editorResources') return { useEditorResourcesStore: () => ({ parserEngines: [], ensureParserEngines: noop }) }
      if (name === '@/stores/uploadTasks') return { useUploadTasksStore: () => ({ enqueue: (value: any) => uploads.push(value) }) }
      if (name === '@/stores/uploadConfirm') return { useUploadConfirmStore: () => ({ open: (value: any) => {
        confirms.push(value); return confirmation.promise
      } }) }
      if (name === '@/stores/chatResources') return { useChatResourcesStore: () => ({
        rawKnowledgeBases: [], ensureKnowledgeBases: async () => undefined,
        fetchKnowledgeBaseById: (id: string, force: boolean) => {
          const read = { ...deferred(), id, force }; reads.push(read); return read.promise
        },
      }) }
      if (name === '@/hooks/useKnowledgeBase') return { __esModule: true, default: () => ({ cardList, total,
        details: vue.reactive({}), moreIndex: vue.ref(-1), openMore: noop, onVisibleChange: noop,
        getKnowled: async (_query: any, id: string) => { lists.push(id); cardList.value = [] },
      }) }
      if (name === '@/hooks/useMarqueeSelect') return { useMarqueeSelect: () => ({
        marqueeVisible: vue.ref(false), marqueeMode: vue.ref('add'), boxStyle: vue.ref({}),
        onContainerMouseDown: noop, shouldSuppressClick: () => false,
      }) }
      if (name === './folderTree') return folderTree
      // DD-157 Kailo shell: top-level (not framed) here, so the native header renders.
      if (name === '@/kailo/setup') return { isKailoShell: () => false }
      if (name === '@/kailo/page') return { usePageHeader: noop }
      if (name.endsWith('.vue')) return { __esModule: true, default: component(name) }
      if (name === '@/api/knowledge-base/index') return {
        listKnowledgeFolders: async () => ({ data: null }), listKnowledgeTags: async () => ({ data: { data: [] } }),
      }
      if (['@/api/chat/index', '@/api/knowledge-base', '@/api/wiki', './wikiStatusRefresh',
        './knowledgeDownloadFileName', '@/utils/knowledgeDeletion', '@/utils/knowledgeTrace'].includes(name)) return {}
      throw new Error(`Unexpected KB dependency: ${name}`)
    },
  })
  const node = (type = '') => ({ type, props: {} as any, style: {}, parent: null as any, children: [] as any[] })
  const detach = (child: any) => {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = null
  }
  const renderer = vue.createRenderer<any, any>({
    createElement: node, createText: () => node(), createComment: () => node(),
    insert(child, parent, anchor) {
      detach(child); const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, child); child.parent = parent
    }, remove: detach, setElementText: (el, text) => { el.text = text }, setText: () => undefined,
    patchProp: (el, key, _prev, next) => { el.props[key] = next }, parentNode: child => child.parent,
    nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] || null,
  })
  const root = node()
  const app = renderer.createApp(exports.default)
  app.config.warnHandler = noop
  app.config.globalProperties.$t = (key: string) => key
  app.mount(root)
  const nodes = (): any[] => {
    const visit = (el: any): any[] => [el, ...el.children.flatMap(visit)]
    return visit(root)
  }
  const uploadEntry = () => nodes().find(el => el.type.endsWith('/KbUploadSourceDropdown.vue'))
  return { route, auth, org, reads, redirects, errors, lists, uploads, confirms, confirmation, nodes, uploadEntry,
    drop: () => listeners.get('weknora:knowledge-file-drop')?.({ detail: { kbId: route.params.kbId, files: [{ name: 'file.txt' }] } }),
    close: () => app.unmount() }
}

test('denied/null KB never mounts upload controls or dispatches a drop despite local admin role', async () => {
  const f = fixture()
  try {
    assert.equal(f.uploadEntry(), undefined)
    f.drop(); assert.equal(f.confirms.length, 0)
    // chatResources returns null on the real HTTP403 path, rather than throwing.
    f.reads[0].resolve(null); await flush()
    assert.deepEqual(f.lists, [])
    assert.equal(f.uploadEntry(), undefined)
    assert.ok(!f.nodes().some(el => el.type.endsWith('/empty-knowledge.vue')))
    assert.deepEqual(f.redirects, ['/platform/knowledge-bases'])
    f.drop(); assert.equal(f.confirms.length, 0)
    assert.equal(f.auth.user.id, 'human', 'no logout or identity refresh on forbidden KB')
  } finally { f.close() }
})

test('authorized KB keeps original upload/drop and confirmed queue consumer', async () => {
  const f = fixture()
  try {
    assert.equal(f.reads[0].force, true)
    f.reads[0].resolve(kb()); await flush()
    assert.ok(f.uploadEntry())
    assert.ok(f.nodes().some(el => el.type.endsWith('/empty-knowledge.vue')))
    assert.ok(f.lists.length > 0 && f.lists.every(id => id === 'a'))
    f.drop(); assert.equal(f.confirms.length, 1)
    f.confirmation.resolve({ mode: 'file', files: [{ name: 'file.txt' }] }); await flush()
    assert.equal(f.uploads.length, 1)
    assert.equal(f.uploads[0].kbId, 'a')
  } finally { f.close() }
})

test('read-only share has no upload affordance or drop consumer even for local tenant admin', async () => {
  const f = fixture()
  try {
    f.org.sharedKnowledgeBases = [{ knowledge_base: { id: 'a' } }]
    f.org.permission = 'viewer'
    f.reads[0].resolve(kb()); await flush()
    assert.equal(f.uploadEntry(), undefined)
    assert.ok(!f.nodes().some(el => el.type.endsWith('/empty-knowledge.vue')))
    f.drop(); assert.equal(f.confirms.length, 0)
    assert.deepEqual(f.redirects, [])
  } finally { f.close() }
})

test('late prior identity reply and pending upload confirmation cannot cross a KB/scope change', async () => {
  const f = fixture()
  try {
    f.reads[0].resolve(kb()); await flush()
    f.drop(); assert.equal(f.confirms.length, 1)
    f.route.params.kbId = 'b'; await flush()
    assert.equal(f.uploadEntry(), undefined)
    f.auth.user = { id: 'second-human' }; await flush()
    f.reads[1].resolve(kb('b')); await flush()
    assert.equal(f.uploadEntry(), undefined)
    f.reads[2].resolve(null); await flush()
    f.confirmation.resolve({ mode: 'file', files: [{ name: 'file.txt' }] }); await flush()
    assert.deepEqual(f.uploads, [])
    assert.ok(f.lists.length > 0 && f.lists.every(id => id === 'a'))
    assert.deepEqual(f.redirects, ['/platform/knowledge-bases'])
  } finally { f.close() }
})

test('failed detail and mismatched response identity return through the existing error/list path', async () => {
  for (const failure of ['network', 'wrong-id']) {
    const f = fixture()
    try {
      if (failure === 'network') f.reads[0].reject(new Error('network unavailable'))
      else f.reads[0].resolve(kb('other'))
      await flush()
      assert.equal(f.uploadEntry(), undefined)
      assert.deepEqual(f.lists, [])
      assert.equal(f.errors.length, 1)
      assert.deepEqual(f.redirects, ['/platform/knowledge-bases'])
    } finally { f.close() }
  }
})
