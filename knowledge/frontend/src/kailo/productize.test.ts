// DD-167 (design 20 §15, 07 §4.8.10): lists, states, wording, type dials,
// list density, prompt and the DD-165 quota notice of the productised pages.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { connectHost, typeDialsOf } from './bridge'
import { fakeRuntime } from './fakeKailoEmbed'
import {
  GRID_PAGE_SIZES, LIST_PAGE_SIZES, ROW_HEIGHT, clampPage, densityOf, monogram, pageCount, pageRange, pageTokens,
  patchQuery, queryEnum, queryInt, querySize, queryText, relativeTime, sameQuery, slicePage,
} from './listing'
import { canRetry, classifyLoadError } from './loadState'
import { QUOTA_DECISIONS, quotaNotice, ux, uxEntries } from './uxText'
import {
  browseKbEntries, kbBrowseDefaults, kbBrowseQuery, readKbBrowse, scopeCounts, sortKbEntries, toKbEntry, type KbEntry,
} from './kbBrowse'
import { askText, hostPrompt, ownPrompt, promptAnswer, promptPayload } from './prompt'
import { applyListDensity, installListDensity, listDensity } from './preferences'
import { KailoUsageRefusal, quotaDecisionOf, readQuotaRefusal } from './quota'
import { PRODUCT_TABS, pageText } from './page'
import { productName } from './brand'

test('page arithmetic: counts, clamping and ranges', () => {
  assert.equal(pageCount(0, 20), 1)
  assert.equal(pageCount(41, 20), 3)
  assert.equal(clampPage(9, 41, 20), 3, 'a page past the end lands on the last page')
  assert.equal(clampPage(0, 41, 20), 1)
  assert.deepEqual(pageRange(3, 20, 41), { from: 41, to: 41 })
  assert.deepEqual(pageRange(1, 20, 0), { from: 0, to: 0 })
  assert.deepEqual(slicePage([1, 2, 3, 4, 5], 2, 2), [3, 4])
  assert.deepEqual(slicePage([1, 2, 3], 7, 2), [3])
  assert.deepEqual([...LIST_PAGE_SIZES], [20, 50, 100])
  assert.deepEqual([...GRID_PAGE_SIZES], [24, 48, 96])
})

test('page strip: every page up to 7, else first/last with gaps in 7 slots', () => {
  assert.deepEqual(pageTokens(1, 1), [1])
  assert.deepEqual(pageTokens(3, 7), [1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(pageTokens(2, 20), [1, 2, 3, 4, 5, 'gap-end', 20])
  assert.deepEqual(pageTokens(10, 20), [1, 'gap-start', 9, 10, 11, 'gap-end', 20])
  assert.deepEqual(pageTokens(19, 20), [1, 'gap-start', 16, 17, 18, 19, 20])
  for (let c = 1; c <= 30; c += 1) assert.equal(pageTokens(c, 30).length, 7)
})

test('route query state: validated reads, defaults left out of the URL', () => {
  assert.equal(queryInt('3', 1), 3)
  assert.equal(queryInt('-3', 1), 1)
  assert.equal(queryInt(['5', '6'], 1), 5)
  assert.equal(queryInt('x', 2), 2)
  assert.equal(querySize('50', LIST_PAGE_SIZES, 20), 50)
  assert.equal(querySize('33', LIST_PAGE_SIZES, 20), 20, 'only offered sizes')
  assert.equal(queryEnum('list', ['grid', 'list'] as const, 'grid'), 'list')
  assert.equal(queryEnum('table', ['grid', 'list'] as const, 'grid'), 'grid')
  assert.equal(queryText('  hi  '), 'hi')
  const q = patchQuery({ tab: 'wiki', page: '3' }, { page: 1, size: 50, view: 'list' }, { page: 1, size: 20, view: 'list' })
  assert.deepEqual(q, { tab: 'wiki', size: '50' })
  assert.ok(sameQuery({ a: '1' }, { a: ['1'] }))
  assert.ok(!sameQuery({ a: '1' }, { a: '1', b: '2' }))
})

test('list density: comfortable 40 / compact 32, followed live', () => {
  assert.equal(densityOf({ 'appearance.listDensity': 'compact' }), 'compact')
  assert.equal(densityOf({ 'appearance.listDensity': 'tight' }), 'comfortable')
  assert.equal(densityOf(null), 'comfortable')
  assert.deepEqual(ROW_HEIGHT, { comfortable: 40, compact: 32 })
  const attrs: Record<string, string> = {}
  const vars: Record<string, string> = {}
  const root = { setAttribute: (k: string, v: string) => { attrs[k] = v }, style: { setProperty: (k: string, v: string) => { vars[k] = v } } }
  applyListDensity('compact', root)
  assert.equal(attrs['data-kailo-list-density'], 'compact')
  assert.equal(vars['--kailo-list-row'], '32px')
  const { runtime, host } = fakeRuntime({ dd167: true, preferences: { 'appearance.listDensity': 'compact' } })
  const stop = installListDensity(runtime, root)
  assert.equal(listDensity.value, 'compact')
  host.setPreferences({ 'appearance.listDensity': 'comfortable' })
  assert.equal(listDensity.value, 'comfortable')
  assert.equal(vars['--kailo-list-row'], '40px')
  stop()
  host.setPreferences({ 'appearance.listDensity': 'compact' })
  assert.equal(listDensity.value, 'comfortable', 'unsubscribed')
  installListDensity(null, root)
  assert.equal(listDensity.value, 'comfortable', 'older runtimes keep the default')
})

test('the manifest declares the shared list density preference (DD-167)', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../fork/release/manifest.native-page.json', import.meta.url), 'utf8'))
  assert.equal(manifest.version, '1.8.0-native-page')
  assert.deepEqual(manifest.frontendPresentationContract.preferences, [{
    key: 'appearance.listDensity', settingsCategory: 'APPEARANCE', valueType: 'ENUM',
    options: [{ value: 'comfortable', label: { ZH_CN: '舒适', EN: 'Comfortable' } }, { value: 'compact', label: { ZH_CN: '紧凑', EN: 'Compact' } }],
    defaultValue: 'comfortable', label: { ZH_CN: '列表密度', EN: 'List density' },
    description: { ZH_CN: '列表与表格的行高', EN: 'Row height of lists and tables' },
  }])
})

test('read failures: refusals are permission states, outages keep a retry', () => {
  assert.equal(classifyLoadError({ status: 403 }), 'forbidden')
  assert.equal(classifyLoadError({ status: 403, code: 'KAILO_MANAGED' }), 'forbidden')
  assert.equal(classifyLoadError({ code: 'KAILO_ADMIN_REQUIRED' }), 'forbidden')
  assert.equal(classifyLoadError({ status: 404 }), 'notFound')
  assert.equal(classifyLoadError({ status: 503 }), 'unavailable')
  assert.equal(classifyLoadError({ status: 504 }), 'timeout')
  assert.equal(classifyLoadError({ kind: 'network', message: '网络错误' }), 'network')
  assert.equal(classifyLoadError({ kind: 'timeout' }), 'timeout')
  assert.equal(classifyLoadError(new Error('x')), 'unknown')
  assert.equal(classifyLoadError(null), 'unknown')
  const nonEnumerable = {}
  Object.defineProperty(nonEnumerable, '$httpStatus', { value: 403 })
  assert.equal(classifyLoadError(nonEnumerable), 'forbidden')
  assert.equal(canRetry('forbidden'), false)
  assert.equal(canRetry('notFound'), false)
  assert.equal(canRetry('network'), true)
})

test('Kailo wording: 你, no exclamation marks, no 您, no internal codes, zh and en from one table', () => {
  const zhKeys = new Set(uxEntries().filter(([lang]) => lang === 'zh').map(([, key]) => key))
  const enKeys = new Set(uxEntries().filter(([lang]) => lang === 'en').map(([, key]) => key))
  assert.deepEqual([...zhKeys].sort(), [...enKeys].sort(), 'same keys in both languages')
  for (const [lang, key, text] of uxEntries()) {
    assert.ok(!/[!！]/.test(text), `${lang}.${key} has no exclamation mark`)
    assert.ok(!text.includes('您'), `${lang}.${key} says 你`)
    assert.ok(!/KAILO_|WeKnora|知识库问答额度/.test(text), `${lang}.${key} has no internal code or old name`)
  }
  assert.equal(ux('page.total', 'zh-CN', { n: 128 }), '共 128 条')
  assert.equal(ux('page.of', 'zh-CN', { x: 2, y: 7 }), '第 2 / 7 页')
  assert.equal(ux('page.of', 'en-US', { x: 2, y: 7 }), 'Page 2 of 7')
  assert.equal(ux('page.size', 'zh-CN', { n: 50 }), '50 条/页')
})

test('product name is 知识工程 / Knowledge Engineering; 知识库 stays the object', () => {
  assert.equal(productName('zh-CN', ''), '知识工程')
  assert.equal(productName('en-US', ''), 'Knowledge Engineering')
  assert.equal(pageText('product', 'zh-CN'), '知识工程')
  assert.deepEqual(PRODUCT_TABS.map((tab) => tab.id), ['knowledge-bases', 'chat'])
  assert.equal(pageText('knowledge-bases', 'zh-CN'), '知识库')
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  assert.match(html, /<title>知识工程<\/title>/)
  assert.match(html, /name="kailo-embed-features" content="page toast confirm shortcuts prompt"/)
})

test('relative times and monograms', () => {
  const now = new Date('2026-10-30T12:00:00Z')
  assert.equal(relativeTime('2026-10-30T11:59:40Z', 'zh-CN', now), '刚刚')
  assert.equal(relativeTime('2026-10-30T11:55:00Z', 'zh-CN', now), '5分钟前')
  assert.equal(relativeTime('2026-10-27T12:00:00Z', 'en-US', now), '3 days ago')
  assert.equal(relativeTime('', 'zh-CN', now), '')
  assert.equal(relativeTime('nope', 'zh-CN', now), '')
  assert.equal(monogram('alice'), 'A')
  assert.equal(monogram(' 王小明'), '王')
  assert.equal(monogram(''), '?')
})

const ctx = { userId: 'u1', isFavorite: (id: string) => id === 'b', isAdmin: false, isContributor: true }

function entries(): KbEntry[] {
  return [
    toKbEntry({ id: 'a', name: 'Alpha', description: 'sales playbook', type: 'document', knowledge_count: 3, creator_id: 'u1',
      isMine: true, updated_at_raw: '2026-10-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', summary_model_id: 'm',
      embedding_model_id: 'e' }, ctx),
    toKbEntry({ id: 'b', name: 'beta', type: 'faq', chunk_count: 9, creator_id: 'u2', creator_name: 'Bo', isMine: true,
      updated_at_raw: '2026-10-20T00:00:00Z', created_at: '2026-02-01T00:00:00Z', is_pinned: true }, ctx),
    toKbEntry({ id: 'c', name: 'Gamma', type: 'document', knowledge_count: 1, isMine: false, permission: 'viewer',
      org_name: 'Design', updated_at: '2026-10-25T00:00:00Z', indexing_strategy: { wiki_enabled: true } }, ctx),
  ]
}

test('knowledge base list: entries, scopes, search and order', () => {
  const [a, b, c] = entries()
  assert.equal(a.ownedByMe, true)
  assert.equal(a.canManage, true)
  assert.equal(a.ready, true)
  assert.equal(b.kind, 'faq')
  assert.equal(b.count, 9)
  assert.equal(b.ready, false, 'no models chosen')
  assert.equal(b.canManage, false, 'a teammate\'s knowledge base, not an admin')
  assert.equal(c.shared, true)
  assert.equal(c.wiki, true)
  assert.equal(c.ownerName, 'Design')
  assert.equal(c.canManage, false, 'shares are managed in their owner\'s space')
  assert.equal(c.canDuplicate, false)
  assert.deepEqual(scopeCounts(entries()), { all: 3, mine: 1, shared: 1, favorites: 1 })
  assert.deepEqual(browseKbEntries(entries(), { scope: 'all', q: '', sort: 'updated' }).map((e) => e.id), ['b', 'c', 'a'],
    'pinned first, then newest')
  assert.deepEqual(sortKbEntries(entries(), 'name').map((e) => e.id), ['b', 'a', 'c'])
  assert.deepEqual(browseKbEntries(entries(), { scope: 'all', q: 'PLAYBOOK', sort: 'name' }).map((e) => e.id), ['a'])
  assert.deepEqual(browseKbEntries(entries(), { scope: 'shared', q: '', sort: 'name' }).map((e) => e.id), ['c'])
})

test('knowledge base list: view state round-trips through the route query', () => {
  const state = readKbBrowse({ scope: 'shared', q: 'x', sort: 'name', view: 'list', page: '2', size: '50' })
  assert.deepEqual(state, { scope: 'shared', q: 'x', sort: 'name', view: 'list', page: 2, size: 50 })
  assert.equal(readKbBrowse({ view: 'grid', size: '50' }).size, 24, 'grid sizes are 24/48/96')
  assert.deepEqual(readKbBrowse({ scope: 'org-1' }).scope, 'all')
  const query = patchQuery({}, kbBrowseQuery({ ...state, scope: 'all', q: '', page: 1, size: 20 }), kbBrowseDefaults('list'))
  assert.deepEqual(query, { sort: 'name', view: 'list' })
})

test('type dials and theme/locale follow Kailo through one onChange (DD-167)', () => {
  const { runtime, host } = fakeRuntime({ dd167: true, theme: 'light', locale: 'zh-CN' })
  const seen: string[] = []
  const stop = connectHost(runtime, {
    onTheme: (t) => seen.push(`theme:${t}`),
    onLocale: (l) => seen.push(`locale:${l}`),
    onType: (d) => seen.push(`type:${d.fontSize}:${d.zoom}`),
  })
  assert.deepEqual(seen, ['theme:light', 'locale:zh-CN', 'type:default:1'])
  host.setType('larger', 1.2)
  host.setTheme('dark')
  host.setLocale('en')
  assert.deepEqual(seen.slice(3), ['type:larger:1.2', 'theme:dark', 'locale:en-US'])
  stop()
  host.setTheme('light')
  assert.equal(seen.length, 6, 'unsubscribed')
  assert.deepEqual(typeDialsOf({}), { fontSize: 'default', zoom: 1 })
  assert.deepEqual(typeDialsOf({ fontSize: 'smaller', zoom: 9 }), { fontSize: 'smaller', zoom: 1 })
})

test('prompt: Kailo dialog when offered, the page\'s own otherwise; answers validated', async () => {
  assert.equal(promptPayload({ title: ' ', label: 'x' }), null)
  const payload = promptPayload({ title: '重命名对话', label: '对话名称', value: 'a\u0007b', maxLength: 999 })!
  assert.equal(payload.maxLength, 255)
  assert.equal(payload.value, 'a b')
  assert.equal(promptAnswer('  新名字 ', 10), '新名字')
  assert.equal(promptAnswer('   '), null)
  assert.equal(promptAnswer('x'.repeat(11), 10), null)
  assert.equal(promptAnswer('a\u0001b'), null)
  const offered = fakeRuntime({ dd167: true, promptSupported: true })
  const viaHost = hostPrompt({ title: '重命名', label: '名称', maxLength: 5 }, offered.runtime)!
  assert.ok(viaHost)
  offered.host.answerPrompt('  ok  ')
  assert.equal(await viaHost, 'ok')
  const tooLong = hostPrompt({ title: '重命名', label: '名称', maxLength: 5 }, offered.runtime)!
  offered.host.answerPrompt('toolong')
  assert.equal(await tooLong, null, 'checked again on this side')
  const declined = fakeRuntime({ dd167: true, promptSupported: false })
  assert.equal(hostPrompt({ title: 't', label: 'l' }, declined.runtime), null)
  const own = askText({ title: '重命名', label: '名称' }, declined.runtime)
  assert.ok(ownPrompt.value, 'the page draws its own dialog')
  assert.equal(await askText({ title: 'second', label: 'l' }, declined.runtime), null, 'one dialog at a time')
  ownPrompt.value!.resolve(' 新 ')
  assert.equal(await own, '新')
  assert.equal(ownPrompt.value, null)
})

test('DD-165 quota refusals: decision from the error details, notice in the current language', async () => {
  assert.equal(quotaDecisionOf({ error: { details: { kailo_usage: 'MEMBER_QUOTA_EXHAUSTED' } } }), 'MEMBER_QUOTA_EXHAUSTED')
  assert.equal(quotaDecisionOf({ error: { details: { kailo_usage: 'ALLOWED' } } }), null)
  assert.equal(quotaDecisionOf({ error: 'x' }), null)
  assert.equal(quotaDecisionOf(null), null)
  const body = { error: { details: { kailo_usage: 'TENANT_QUOTA_EXHAUSTED' } } }
  assert.equal(await readQuotaRefusal({ status: 429, json: async () => body }), 'TENANT_QUOTA_EXHAUSTED')
  assert.equal(await readQuotaRefusal({ status: 500, json: async () => body }), null)
  assert.equal(await readQuotaRefusal({ status: 503, json: async () => { throw new Error('html') } }), null)
  assert.equal(new KailoUsageRefusal('QUOTA_NOT_CONFIGURED').decision, 'QUOTA_NOT_CONFIGURED')
  assert.equal(quotaNotice('TENANT_QUOTA_EXHAUSTED', 'zh-CN'), '组织本月的知识工程问答额度已用完，请联系管理员。')
  assert.equal(quotaNotice('MEMBER_QUOTA_EXHAUSTED', 'en'), 'Your Knowledge Engineering answer quota for this month is used up.')
  for (const decision of QUOTA_DECISIONS) assert.notEqual(quotaNotice(decision, 'zh-CN'), quotaNotice(decision, 'en-US'))
})
