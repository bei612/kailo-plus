// Kailo DD-164(4)② (07 §4.7.2 `share`): in Kailo mode a knowledge base is
// shared in Kailo's share dialog, never in a native one. The page asks this
// instance for a share intent (POST /api/v1/kailo/share-intents, which names
// the knowledge base to Kailo only when the person may share it) and hands
// the opaque intent to the Kailo host through the embed runtime. Who the
// knowledge base is shared with then comes back through the member directory.

export type KailoShareOutcome = 'opened' | 'forbidden' | 'unavailable' | 'failed'

/** The share request of client-kit/embed/kailo-embed.js, feature-detected. */
type ShareRuntime = { requestShare?: (intentId: string) => boolean }

const INTENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface ShareIntentClient {
  post(url: string, body: unknown): Promise<{ intentId?: unknown } | undefined>
}

/** HTTP status of a rejected request, as the shared axios wrapper surfaces it. */
function statusOf(error: unknown): number | undefined {
  const e = error as { status?: unknown; response?: { status?: unknown } } | null
  const status = e?.response?.status ?? e?.status
  return typeof status === 'number' ? status : undefined
}

export async function requestKailoShare(
  knowledgeBaseId: string,
  client: ShareIntentClient,
  runtime: ShareRuntime | null | undefined = typeof window !== 'undefined'
    ? ((window as unknown as { KailoEmbed?: ShareRuntime }).KailoEmbed ?? null)
    : null,
): Promise<KailoShareOutcome> {
  if (!runtime || typeof runtime.requestShare !== 'function') return 'unavailable'
  let answer: { intentId?: unknown } | undefined
  try {
    answer = await client.post('/api/v1/kailo/share-intents', { knowledgeBaseId })
  } catch (error) {
    const status = statusOf(error)
    if (status === 403) return 'forbidden'
    if (status === 404) return 'unavailable'
    return 'failed'
  }
  const intentId = typeof answer?.intentId === 'string' ? answer.intentId.toLowerCase() : ''
  if (!INTENT_ID.test(intentId)) return 'failed'
  try {
    return runtime.requestShare(intentId) ? 'opened' : 'unavailable'
  } catch {
    return 'failed'
  }
}

type Lang = 'zh' | 'en'
const TEXT: Record<Lang, Record<'title' | 'hint' | 'action' | 'forbidden' | 'unavailable' | 'failed', string>> = {
  zh: {
    title: '分享',
    hint: '知识库的分享对象与权限由{platform}统一管理：在{platform}的分享对话框中选择工作区或全体成员，并设置可查看或可编辑。',
    action: '在{platform}中分享',
    forbidden: '只有知识库的创建者或空间管理员可以分享',
    unavailable: '请在{platform}中打开知识库后再分享',
    failed: '暂时无法打开分享，请稍后重试',
  },
  en: {
    title: 'Share',
    hint: '{platform} manages who this knowledge base is shared with: choose Workspaces or all members and View or Edit in the {platform} share dialog.',
    action: 'Share in {platform}',
    forbidden: 'Only the creator of the knowledge base or a space admin can share it',
    unavailable: 'Open the knowledge base in {platform} to share it',
    failed: 'Sharing is unavailable right now. Try again later.',
  },
}

export function kailoShareText(
  key: keyof (typeof TEXT)['zh'],
  locale: string,
  displayName: string,
): string {
  const lang: Lang = /^zh\b/i.test(locale || '') ? 'zh' : 'en'
  const platform = (displayName || '').trim() || (lang === 'zh' ? '平台' : 'the platform')
  return TEXT[lang][key].replace(/\{platform\}/g, platform)
}
