// DD-157: page header shape, host feedback routing, Kailo wording and model labels.
import assert from 'node:assert/strict'
import test from 'node:test'
import { hostRendersPage, type KailoEmbedRuntime, type KailoPage, type KailoToast, type KailoConfirm } from './bridge'
import { hostConfirm, hostToast, toastPayload } from './feedback'
import { clipText, defaultSpec, tabForRoute, toKailoPage, visibleTabs, VIEW_OWNED_ROUTES } from './page'
import { kailoLocaleMessages, kailoWording } from './terminology'
import { isOpaqueModelName, modelLabel, modelRawName } from './modelLabel'

function runtime(options: { features?: string[]; embedded?: boolean; toast?: boolean; confirm?: Promise<boolean> | null } = {}) {
  const calls = { pages: [] as Array<KailoPage | null>, toasts: [] as KailoToast[], confirms: [] as KailoConfirm[] }
  const value = {
    version: 1,
    features: options.features ?? ['page', 'toast', 'confirm', 'shortcuts'],
    getState: () => ({ theme: 'light', locale: 'zh-CN', embedded: options.embedded ?? true, hostConnected: true }),
    onThemeChange: () => () => {},
    onLocaleChange: () => () => {},
    useIdentityLocale: () => false,
    requestTopLevelSignIn: () => false,
    setPage: (page: KailoPage | null) => { calls.pages.push(page); return true },
    onNavigate: () => () => {},
    onAction: () => () => {},
    toast: (toast: KailoToast) => { calls.toasts.push(toast); return options.toast ?? true },
    confirm: (confirm: KailoConfirm) => { calls.confirms.push(confirm); return options.confirm === undefined ? Promise.resolve(true) : options.confirm },
  } as unknown as KailoEmbedRuntime
  return { value, calls }
}

test('Kailo renders the page only inside the frame with the page feature declared', () => {
  assert.equal(hostRendersPage(runtime().value), true)
  assert.equal(hostRendersPage(runtime({ embedded: false }).value), false)
  assert.equal(hostRendersPage(runtime({ features: ['toast'] }).value), false)
  assert.equal(hostRendersPage(null), false)
  const legacy = { ...runtime().value, setPage: undefined } as unknown as KailoEmbedRuntime
  assert.equal(hostRendersPage(legacy), false)
})

test('page header: limits are enforced without throwing, one primary action', () => {
  const crumbs = Array.from({ length: 10 }, (_, index) => ({ id: `c${index}`, label: `层级 ${index}`, go: () => {} }))
  const page = toKailoPage({
    title: `  ${'很长的标题'.repeat(40)}  `,
    breadcrumbs: [...crumbs, { id: '', label: 'no id', go: () => {} }, { id: 'blank', label: '   ', go: () => {} }],
    actions: [
      { id: 'a', label: '上传文档', variant: 'primary', icon: 'upload', run: () => {} },
      { id: 'b', label: '新建', variant: 'primary', run: () => {} },
      { id: 'c', label: 'x'.repeat(60), variant: 'menu', disabled: true, run: () => {} },
    ],
  }, visibleTabs('zh-CN', () => true), 'knowledge-bases', '知识库')
  assert.equal(page.title.length, 120)
  assert.ok(page.title.endsWith('…'))
  assert.equal(page.breadcrumbs!.length, 8)
  assert.equal(page.breadcrumbs![7].id, 'c9', 'the nearest ancestors are kept')
  assert.deepEqual(page.actions!.map((action) => action.variant), ['primary', 'secondary', 'menu'])
  assert.equal(page.actions![2].label.length, 40)
  assert.equal(page.actions![2].disabled, true)
  assert.equal(page.activeTab, 'knowledge-bases')
  assert.deepEqual(page.tabs!.map((tab) => tab.label), ['知识库', '对话'], 'DD-167: 知识库 · 对话; Agent and 产物 are Kailo Agent\'s (DD-163)')
})

test('page header: tabs follow deployment capabilities and routes', () => {
  const tabs = visibleTabs('en', (capability) => capability !== 'settings.sandbox')
  assert.deepEqual(tabs.map((tab) => tab.id), ['knowledge-bases', 'chat'])
  const page = toKailoPage({ title: '' }, tabs, 'artifacts', 'Knowledge')
  assert.equal(page.title, 'Knowledge', 'an empty title falls back')
  assert.equal(page.activeTab, undefined, 'an absent tab is never active')
  assert.equal(tabForRoute('chat'), 'chat')
  assert.equal(tabForRoute('globalCreatChat'), 'chat')
  assert.equal(tabForRoute('knowledgeBaseDetail'), 'knowledge-bases')
  assert.equal(tabForRoute('settings'), undefined)
  assert.equal(defaultSpec('globalCreatChat', 'zh-CN').title, '新建对话')
  assert.equal(defaultSpec('settings', 'en').title, 'Settings')
  assert.ok(VIEW_OWNED_ROUTES.has('knowledgeBaseDetail'))
  assert.equal(clipText('a\u0007b   c', 10), 'ab c')
})

test('toasts and confirmations go to Kailo when it accepts them', async () => {
  const host = runtime()
  assert.equal(hostToast('success', '  已删除  ', host.value), true)
  assert.deepEqual(host.calls.toasts[0], { tone: 'success', title: '已删除' })
  assert.equal(hostToast('error', '   ', host.value), false, 'empty text stays local')
  assert.equal(hostToast('info', 'x', runtime({ toast: false }).value), false)
  assert.equal(hostToast('info', 'x', null), false)
  const confirmed = hostConfirm({ tone: 'danger', title: '删除对话', description: '删除后无法恢复。', confirmLabel: '删除' }, host.value)
  assert.ok(confirmed)
  assert.equal(await confirmed, true)
  assert.equal(host.calls.confirms[0].tone, 'danger')
  assert.equal(hostConfirm({ title: 'x' }, runtime({ confirm: null }).value), null)
})

test('long messages split into a title and a description', () => {
  const text = `${'上传失败'.repeat(20)}。${'原因'.repeat(100)}`
  const payload = toastPayload('error', text)!
  assert.ok(payload.title.length <= 120)
  assert.ok(payload.title.endsWith('。'))
  assert.ok(payload.description && payload.description.length <= 280)
  const unbroken = toastPayload('error', 'x'.repeat(300))!
  assert.equal(unbroken.title.length, 120)
})

test('Kailo wording: 你 / Agent / 对话, no exclamation marks; placeholders untouched', () => {
  assert.equal(kailoWording('管理和组织您的智能体', 'zh-CN'), '管理和组织你的 Agent')
  assert.equal(kailoWording('创建智能体', 'zh-CN'), '创建 Agent')
  assert.equal(kailoWording('智能体列表加载失败', 'zh-CN'), 'Agent 列表加载失败')
  assert.equal(kailoWording('选择要测试的智能体，然后发送', 'zh-CN'), '选择要测试的 Agent，然后发送')
  assert.equal(kailoWording('删除失败，请稍后再试！', 'zh-CN'), '删除失败，请稍后再试')
  assert.equal(kailoWording('开始构建吧！随时可查看', 'zh-CN'), '开始构建吧。随时可查看')
  assert.equal(kailoWording('感叹号 (！)', 'zh-CN'), '感叹号 (！)')
  assert.equal(kailoWording('新会话 {name}', 'zh-CN'), '新对话 {name}')
  assert.equal(kailoWording('File size cannot exceed {size}MB!', 'en-US'), 'File size cannot exceed {size}MB.')
  assert.equal(kailoWording('a != b', 'en-US'), 'a != b')
  assert.equal(kailoWording('您好', 'ko-KR'), '您好', 'other locales unchanged')
  const out = kailoLocaleMessages({
    'zh-CN': { menu: { newChat: '新对话', agents: '智能体', list: ['您'] } },
    'en-US': { menu: { newChat: 'New Chat' } },
    'ja-JP': { menu: { newChat: '新しいチャット' } },
  })
  assert.deepEqual(out['zh-CN'], { menu: { newChat: '新建对话', agents: 'Agent', list: ['你'] } })
  assert.deepEqual(out['en-US'], { menu: { newChat: 'New chat' } })
  assert.deepEqual(out['ja-JP'], { menu: { newChat: '新しいチャット' } })
})

test('model names never show an opaque identifier', () => {
  const uuid = '62f190fc-c993-4351-aa32-dbcc3c763af2'
  assert.equal(isOpaqueModelName(uuid), true)
  assert.equal(modelLabel({ name: uuid }, 'zh-CN'), '默认模型')
  assert.equal(modelLabel({ name: uuid }, 'en'), 'Default model')
  assert.equal(modelLabel({ name: uuid, display_name: 'Qwen 3' }, 'zh-CN'), 'Qwen 3')
  assert.equal(modelLabel({ name: 'gpt-4o' }, 'zh-CN'), 'gpt-4o')
  assert.equal(modelRawName({ name: uuid, display_name: 'Qwen 3' }), '')
  assert.equal(modelRawName({ name: 'qwen3-32b', display_name: 'Qwen 3' }), 'qwen3-32b')
})
