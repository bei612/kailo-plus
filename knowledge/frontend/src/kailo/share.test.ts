// DD-164(4)②: the knowledge base share entry hands only an opaque intent to
// the Kailo host and never opens a native share dialog.
import assert from 'node:assert/strict'
import test from 'node:test'
import { kailoShareText, requestKailoShare } from './share'

const INTENT = '0b3c1f9e-0000-4000-8000-0000000000aa'

function host() {
  const calls: string[] = []
  return { calls, runtime: { requestShare: (id: string) => { calls.push(id); return true } } }
}

test('a share intent is passed to the Kailo host as is', async () => {
  const { calls, runtime } = host()
  const posted: unknown[] = []
  const outcome = await requestKailoShare('kb-1', {
    post: async (url, body) => { posted.push([url, body]); return { intentId: INTENT.toUpperCase() } },
  }, runtime)
  assert.equal(outcome, 'opened')
  assert.deepEqual(posted, [['/api/v1/kailo/share-intents', { knowledgeBaseId: 'kb-1' }]])
  assert.deepEqual(calls, [INTENT])
})

test('without the runtime share request nothing is asked from the server', async () => {
  let posted = 0
  const outcome = await requestKailoShare('kb-1', { post: async () => { posted++; return { intentId: INTENT } } }, {})
  assert.equal(outcome, 'unavailable')
  assert.equal(posted, 0)
})

test('server refusals and malformed answers never reach the host', async () => {
  for (const [error, want] of [[{ response: { status: 403 } }, 'forbidden'], [{ status: 404 }, 'unavailable'],
    [{ response: { status: 503 } }, 'failed']] as const) {
    const { calls, runtime } = host()
    const outcome = await requestKailoShare('kb-1', { post: async () => { throw error } }, runtime)
    assert.equal(outcome, want)
    assert.equal(calls.length, 0)
  }
  const { calls, runtime } = host()
  assert.equal(await requestKailoShare('kb-1', { post: async () => ({ intentId: 'x' }) }, runtime), 'failed')
  assert.equal(calls.length, 0)
})

test('texts follow the locale and the deployment name', () => {
  assert.equal(kailoShareText('action', 'zh-CN', 'Kailo'), '在Kailo中分享')
  assert.equal(kailoShareText('action', 'en-US', 'Kailo'), 'Share in Kailo')
})
