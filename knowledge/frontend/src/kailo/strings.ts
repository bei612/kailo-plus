// Kailo-only UI strings. Kept local (zh / en) instead of in the five
// 7k-line upstream locale files so upstream syncs stay conflict-free.

import { productName } from './brand'

type Key = 'entering' | 'reauth' | 'reauthHint' | 'error' | 'errorHint' | 'ssoUnavailable' | 'managedByKailo'

const TABLE: Record<'zh' | 'en', Record<Key, string>> = {
  zh: {
    entering: '正在进入{product}…',
    reauth: '需要在{platform}中重新登录',
    reauthHint: '登录状态已失效，请在{platform}中重新登录后再打开{product}。',
    error: '暂时无法进入{product}',
    errorHint: '请稍后重试；如果问题持续，请联系{platform}管理员。',
    ssoUnavailable: '{product}尚未完成单点登录配置，请联系{platform}管理员。',
    managedByKailo: '由{platform}统一管理',
  },
  en: {
    entering: 'Opening {product}…',
    reauth: 'Sign in to {platform} again',
    reauthHint: 'Your session has ended. Sign in to {platform} again, then reopen {product}.',
    error: '{product} is unavailable right now',
    errorHint: 'Try again later. If the problem continues, contact your {platform} administrator.',
    ssoUnavailable: '{product} single sign-on is not configured. Contact your {platform} administrator.',
    managedByKailo: 'Managed by {platform}',
  },
}

export function kailoText(key: Key, locale: string, displayName: string): string {
  const lang = /^zh\b/i.test(locale || '') ? 'zh' : 'en'
  const platform = (displayName || '').trim() || (lang === 'zh' ? '平台' : 'the platform')
  return TABLE[lang][key]
    .replace(/\{product\}/g, productName(locale, displayName))
    .replace(/\{platform\}/g, platform)
}
