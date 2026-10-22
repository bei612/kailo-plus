// Installs the Kailo integration at startup (called from main.ts before mount).

import { watch } from 'vue'
import { kailoConfig } from './runtime'
import { productName } from './brand'
import {
  installHostBridge,
  isEmbedded,
  mapKailoLocale,
  readHostPreferences,
  type HostPreferences,
} from './bridge'
import { setHostTheme } from '@/composables/useTheme'

let embedded = false
let hostLocaleActive = false

export function isKailoEmbedded(): boolean {
  return embedded
}

type I18nLike = { global: { locale: { value: string } | string } }

function setI18nLocale(i18n: I18nLike, locale: string) {
  const g = i18n.global as { locale: { value: string } | string }
  if (typeof g.locale === 'object' && g.locale !== null) g.locale.value = locale
  else (i18n.global as { locale: string }).locale = locale
  try { localStorage.setItem('locale', locale) } catch { /* storage unavailable */ }
  try { document.documentElement.setAttribute('lang', locale) } catch { /* no DOM */ }
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
 * Applies white-label title, embedded-shell marker and, in Kailo mode, the
 * host theme/locale (URL parameters first, then live host messages).
 */
export function installKailo(i18n: I18nLike): HostPreferences {
  const cfg = kailoConfig()
  const prefs = readHostPreferences(window.location.search, window.sessionStorage)
  embedded = isEmbedded(window, prefs)
  if (embedded) document.documentElement.classList.add('kailo-embedded')
  if (cfg.mode) document.documentElement.classList.add('kailo-mode')

  if (cfg.mode) {
    if (prefs.theme) setHostTheme(prefs.theme)
    if (prefs.locale) {
      hostLocaleActive = true
      setI18nLocale(i18n, mapKailoLocale(prefs.locale))
    }
    if (embedded) {
      installHostBridge(window as never, cfg.origins, {
        onTheme: theme => setHostTheme(theme),
        onLocale: locale => {
          hostLocaleActive = true
          setI18nLocale(i18n, mapKailoLocale(locale))
        },
      }, window.sessionStorage)
    }
  }

  syncDocumentTitle(currentLocale(i18n))
  const g = i18n.global as { locale: unknown }
  if (typeof g.locale === 'object' && g.locale !== null) {
    watch(() => (g.locale as { value: string }).value, value => syncDocumentTitle(value))
  }
  return prefs
}

/**
 * Kailo identity locale (OIDC `locale` claim, stored by the backend in user
 * preferences) applies when the host did not pass one.
 */
export function applyUserLocale(i18n: I18nLike, userLocale: string | null | undefined) {
  if (!kailoConfig().mode || hostLocaleActive || !userLocale) return
  const mapped = mapKailoLocale(userLocale)
  if (mapped !== currentLocale(i18n)) setI18nLocale(i18n, mapped)
}
