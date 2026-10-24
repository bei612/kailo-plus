// DD-157 (20 §13.4, 07 §4.8.7): popconfirm text as Kailo confirmations, and
// header file actions in the runtime's shape.
import assert from 'node:assert/strict'
import test from 'node:test'
import { askHostOnce, popconfirmRequest, splitQuestion } from './popconfirmText'
import { pickerFiles, toKailoPage } from './page'

test('the asking sentence becomes the title, the rest the consequence', () => {
  assert.deepEqual(splitQuestion('删除文档“周报.pdf”？删除后将无法恢复。', '删除'), {
    title: '删除文档“周报.pdf”？',
    description: '删除后将无法恢复。',
  })
  assert.deepEqual(splitQuestion('仅从当前队列移除这条失败记录，不会执行原任务。确认清除？', ''), {
    title: '确认清除？',
    description: '仅从当前队列移除这条失败记录，不会执行原任务。',
  })
  assert.deepEqual(splitQuestion('删除后使用该端点的客户端会立即断开，确定删除？', '删除'), {
    title: '确定删除？',
    description: '删除后使用该端点的客户端会立即断开',
  })
  // A comma inside a long question that is not a short asking clause stays in the title.
  assert.deepEqual(splitQuestion('确定将「周报，月报与年度总结合集」从本共享空间中移除？', '移除'), {
    title: '确定将「周报，月报与年度总结合集」从本共享空间中移除？',
  })
  assert.deepEqual(splitQuestion('Delete document "a.pdf"? This cannot be undone.', 'Delete'), {
    title: 'Delete document "a.pdf"?',
    description: 'This cannot be undone.',
  })
  // No question: the verb asks, the text explains.
  assert.deepEqual(splitQuestion('关闭后将取消剩余 3 个文件的上传', '取消上传'), {
    title: '取消上传？',
    description: '关闭后将取消剩余 3 个文件的上传',
  })
  assert.deepEqual(splitQuestion('永久删除这条记忆？', '删除'), { title: '永久删除这条记忆？' })
})

test('danger tone follows the popconfirm or its confirm button; labels are verbs', () => {
  assert.deepEqual(popconfirmRequest({
    content: '确认删除选中的 3 个文档？删除后将无法恢复。',
    theme: 'warning',
    confirmBtn: { content: '删除', theme: 'danger' },
    cancelBtn: { content: '取消' },
  }), {
    tone: 'danger',
    title: '确认删除选中的 3 个文档？',
    description: '删除后将无法恢复。',
    confirmLabel: '删除',
    cancelLabel: '取消',
  })
  assert.deepEqual(popconfirmRequest({ content: '确认重建选中的 3 个文档？', theme: 'warning', confirmBtn: { content: '重建', theme: 'warning' } }), {
    tone: 'default',
    title: '确认重建选中的 3 个文档？',
    confirmLabel: '重建',
  })
  assert.equal(popconfirmRequest({ content: '删除这个任务？', theme: 'danger' })?.tone, 'danger')
  // A generic "确认" button takes the trigger's name; none at all leaves Kailo's default.
  assert.equal(popconfirmRequest({ content: '确定回滚到 v3 吗？', confirmBtn: '确认', triggerLabel: '回滚' })?.confirmLabel, '回滚')
  assert.equal(popconfirmRequest({ content: '确定回滚到 v3 吗？' })?.confirmLabel, undefined)
  assert.equal(popconfirmRequest({ content: '确定回滚到 v3 吗？', cancelBtn: '取消' })?.cancelLabel, '取消')
})

test('rich or empty content keeps the native popconfirm', () => {
  assert.equal(popconfirmRequest({ content: () => null }), null)
  assert.equal(popconfirmRequest({ content: '   ' }), null)
  assert.equal(popconfirmRequest({}), null)
})

test('one Kailo dialog per question; declined requests fall back', async () => {
  let asked = 0
  let answer!: (value: boolean) => void
  const ask = () => { asked += 1; return new Promise<boolean>((resolve) => { answer = resolve }) }
  const request = { tone: 'danger' as const, title: '删除？' }
  const first = askHostOnce(request, ask)
  const second = askHostOnce(request, ask)
  assert.equal(asked, 1)
  assert.equal(first, second)
  answer(true)
  assert.equal(await first, true)
  // Settled questions can be asked again.
  const third = askHostOnce(request, ask)
  assert.equal(asked, 2)
  answer(false)
  assert.equal(await third, false)
  assert.equal(askHostOnce(request, () => null), null)
})

test('header file actions carry the picker options in the runtime shape', () => {
  assert.deepEqual(pickerFiles({ accept: '.pdf, .docx', multiple: true }), { accept: '.pdf,.docx', multiple: true })
  assert.deepEqual(pickerFiles({ directory: true, multiple: true }), { multiple: true, directory: true })
  // An accept list the picker cannot take is dropped (the view still filters types).
  assert.deepEqual(pickerFiles({ accept: Array.from({ length: 60 }, (_, i) => `.ext${i}`).join(','), multiple: true }), { multiple: true })
  assert.deepEqual(pickerFiles({ accept: '.pdf;rm', multiple: false }), {})
  const page = toKailoPage({
    title: '周报',
    actions: [
      { id: 'upload', label: '上传文档', variant: 'primary', icon: 'upload', files: { accept: '.pdf', multiple: true }, run: () => {} },
      { id: 'write', label: '在线编辑', variant: 'menu', run: () => {} },
    ],
  }, [], undefined, '知识库')
  assert.deepEqual(page.actions, [
    { id: 'upload', label: '上传文档', variant: 'primary', icon: 'upload', files: { accept: '.pdf', multiple: true } },
    { id: 'write', label: '在线编辑', variant: 'menu' },
  ])
})
