// DD-157 (20 §13.8): Kailo wording in Kailo mode. Applied centrally to the
// message trees (like the white-label brand word), so the upstream locale
// files stay identical to upstream and an upstream sync adds no conflicts.
//
// zh-CN: 你 (not 您), Agent (not 智能体), 对话 (not 会话), 新建对话 for the
// action (menu.newChat), 收藏 (not 书签), no exclamation marks. en-US: Agent, sentence-case navigation,
// no exclamation marks. Explicit per-key overrides take precedence.

const CJK = '\\u3400-\\u9fff\\uf900-\\ufaff'

type Rule = [RegExp, string]

const ZH_RULES: Rule[] = [
  [/您/g, '你'],
  // Latin "Agent" between Chinese characters gets a space on each side (Kailo zh copy).
  [new RegExp(`(?<=[${CJK}])智能体(?=[${CJK}])`, 'g'), ' Agent '],
  [new RegExp(`(?<=[${CJK}])智能体`, 'g'), ' Agent'],
  [new RegExp(`智能体(?=[${CJK}])`, 'g'), 'Agent '],
  [/智能体/g, 'Agent'],
  [/会话/g, '对话'],
  [/书签/g, '收藏'],
  // "！" ends a message: drop it; inside a message it becomes a full stop.
  // Kept when quoted as a character, e.g. "感叹号 (！)".
  [/(?<![（(])！(?=\s*$)/g, ''],
  [/(?<![（(])！(?![)）])/g, '。'],
]

const EN_RULES: Rule[] = [
  // A trailing "!" after a word ends the message with a full stop.
  [/(?<=[A-Za-z0-9)"'])!(?=\s*$)/g, '.'],
  [/(?<=[A-Za-z0-9)"'])!(?=\s+[A-Z])/g, '.'],
  [/\bBookmarks\b/g, 'Favorites'],
  [/\bBookmark\b/g, 'Favorite'],
]

/** Exact values for keys whose Kailo wording is not a mechanical replacement. */
const OVERRIDES: Record<'zh' | 'en', Record<string, string>> = {
  zh: {
    'menu.newChat': '新建对话',
    'menu.newSession': '新对话',
    'menu.agents': 'Agent',
    'menu.settings': '设置',
    'agent.createAgent': '新建 Agent',
    'knowledgeList.subtitle': '管理和组织你的知识库，支持文档型和问答型知识库',
  },
  en: {
    'menu.newChat': 'New chat',
    'menu.newSession': 'New chat',
    'menu.knowledgeBase': 'Knowledge bases',
    'menu.organizations': 'Shared spaces',
    'menu.settings': 'Settings',
    'agent.createAgent': 'New agent',
    'knowledgeList.create': 'New knowledge base',
  },
}

function langOf(locale: string): 'zh' | 'en' | null {
  if (/^zh\b/i.test(locale)) return 'zh'
  if (/^en\b/i.test(locale)) return 'en'
  return null
}

/** One message in Kailo wording. vue-i18n placeholders ({name}) are left untouched. */
export function kailoWording(text: string, locale: string): string {
  const lang = langOf(locale)
  if (!lang || typeof text !== 'string') return text
  let out = text
  for (const [pattern, replacement] of lang === 'zh' ? ZH_RULES : EN_RULES) out = out.replace(pattern, replacement)
  return out
}

function walk(value: unknown, locale: string, path: string, overrides: Record<string, string>): unknown {
  if (Object.prototype.hasOwnProperty.call(overrides, path)) return overrides[path]
  if (typeof value === 'string') return kailoWording(value, locale)
  if (Array.isArray(value)) return value.map((item, index) => walk(item, locale, `${path}[${index}]`, overrides))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = walk(item, locale, path ? `${path}.${key}` : key, overrides)
    }
    return out
  }
  return value
}

/** Every zh/en locale tree in Kailo wording (other locales unchanged). */
export function kailoLocaleMessages<T extends Record<string, unknown>>(messagesByLocale: T): T {
  const out: Record<string, unknown> = {}
  for (const [locale, tree] of Object.entries(messagesByLocale)) {
    const lang = langOf(locale)
    out[locale] = lang ? walk(tree, locale, '', OVERRIDES[lang]) : tree
  }
  return out as T
}
