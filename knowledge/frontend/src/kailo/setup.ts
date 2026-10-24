// Installs the Kailo integration at startup (called from main.ts before mount).

import { watch } from 'vue'
import { kailoConfig } from './runtime'
import { productName } from './brand'
import { connectHost, hostRendersPage, isEmbedded, kailoEmbed, offerIdentityLocale } from './bridge'
import { setHostTheme } from '@/composables/useTheme'

let embedded = false
let shell = false

/** Inside the Kailo frame (<html data-kailo-embedded>, set by kailo-embed.js). */
export function isKailoEmbedded(): boolean {
  return embedded
}

/**
 * DD-152: Kailo renders the page header, toasts and confirmations (Kailo mode,
 * inside the Kailo frame, `page` declared). The app then renders content only:
 * no product menu, page titles, breadcrumbs or own navigation chrome.
 */
export function isKailoShell(): boolean {
  return shell
}

type I18nLike = { global: { locale: { value: string } | string } }

function setI18nLocale(i18n: I18nLike, locale: string) {
  const g = i18n.global as { locale: { value: string } | string }
  if (typeof g.locale === 'object' && g.locale !== null) g.locale.value = locale
  else (i18n.global as { locale: string }).locale = locale
  try { localStorage.setItem('locale', locale) } catch { /* storage unavailable */ }
}

function currentLocale(i18n: I18nLike): string {
  const g = i18n.global as { locale: { value: string } | string }
  return typeof g.locale === 'object' && g.locale !== null ? g.locale.value : String(g.locale)
}

/** Keeps the browser title equal to the white-label product name. */
export function syncDocumentTitle(locale: string) {
  try { document.title = productName(locale, kailoConfig().displayName) } catch { /* no DOM */ }
}

/**
 * White-label title for every run; in Kailo mode the platform runtime
 * (window.KailoEmbed) drives theme and locale: its current state first, then
 * every change Kailo sends. The native theme preference is never written.
 */
export function installKailo(i18n: I18nLike): void {
  const cfg = kailoConfig()
  embedded = isEmbedded()
  if (cfg.mode) {
    // Activates the token overlay (src/kailo/kailo-theme-overlay.css).
    document.documentElement.setAttribute('data-kailo-mode', '')
    const runtime = kailoEmbed()
    if (runtime) {
      shell = hostRendersPage(runtime)
      if (shell) document.documentElement.setAttribute('data-kailo-shell', '')
      connectHost(runtime, {
        onTheme: theme => setHostTheme(theme),
        onLocale: locale => setI18nLocale(i18n, locale),
      })
    }
  }

  syncDocumentTitle(currentLocale(i18n))
  const g = i18n.global as { locale: unknown }
  if (typeof g.locale === 'object' && g.locale !== null) {
    watch(() => (g.locale as { value: string }).value, value => syncDocumentTitle(value))
  }
}

/**
 * Top-level visits: the identity locale (OIDC `locale` claim, stored by the
 * backend in user preferences) seeds the language through the runtime, which
 * ignores it once Kailo supplied a locale; the change arrives via onLocaleChange.
 */
export function applyUserLocale(_i18n: I18nLike, userLocale: string | null | undefined) {
  if (!kailoConfig().mode || embedded || !userLocale) return
  offerIdentityLocale(kailoEmbed(), userLocale)
}
