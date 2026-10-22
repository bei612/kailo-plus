// White-label branding (DD-133 §1). Always on in this fork: no upstream
// product name, logo, favicon or version is shown anywhere.

/** Kailo logo, copied at image build time from the web-client artifact. */
export const BRAND_LOGO_URL = '/kailo/app-icon.png'

const UPSTREAM_BRAND = 'WeKnora'

function isChineseLocale(locale: string): boolean {
  return /^zh\b/i.test(locale || '')
}

/** Component suffix: 知识库 for Chinese locales, Knowledge otherwise. */
export function componentLabel(locale: string): string {
  return isChineseLocale(locale) ? '知识库' : 'Knowledge'
}

/** `${PLATFORM_DISPLAY_NAME} 知识库` / `${PLATFORM_DISPLAY_NAME} Knowledge`. */
export function productName(locale: string, displayName: string): string {
  const name = (displayName || '').trim()
  const label = componentLabel(locale)
  return name ? `${name} ${label}` : label
}

// Standalone upstream product word: not preceded by an identifier/URL/path
// character and not followed by one (keeps `weknora-widget.js`, `WeKnora_x`,
// `github.com/Tencent/WeKnora`, docker image names and env keys untouched).
// A trailing sentence period is allowed ("Welcome to WeKnora."), a file
// extension or domain suffix is not ("WeKnora.js").
const BRAND_WORD = new RegExp(`(?<![\\w/.@-])${UPSTREAM_BRAND}(?![\\w/@-]|\\.\\w)`, 'g')

/** Replaces the standalone upstream product word in one message. */
export function brandText(text: string, product: string): string {
  if (typeof text !== 'string' || !text.includes(UPSTREAM_BRAND)) return text
  return text.replace(BRAND_WORD, product)
}

/**
 * Returns a deep copy of a vue-i18n message tree with the standalone upstream
 * product word replaced. Non-string leaves (functions, numbers) are kept.
 */
export function brandMessages<T>(messages: T, product: string): T {
  if (typeof messages === 'string') return brandText(messages, product) as unknown as T
  if (Array.isArray(messages)) return messages.map(item => brandMessages(item, product)) as unknown as T
  if (messages && typeof messages === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(messages as Record<string, unknown>)) {
      out[key] = brandMessages(value, product)
    }
    return out as T
  }
  return messages
}

/** Brands every locale tree with that locale's product name. */
export function brandLocaleMessages<T extends Record<string, unknown>>(
  messagesByLocale: T,
  displayName: string,
): T {
  // vue-i18n treats { } @ $ | as message syntax; a display name must stay literal.
  const literalName = (displayName || '').replace(/[{}@$|]/g, '')
  const out: Record<string, unknown> = {}
  for (const [locale, tree] of Object.entries(messagesByLocale)) {
    out[locale] = brandMessages(tree, productName(locale, literalName))
  }
  return out as T
}
