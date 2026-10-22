// Test double of client-kit/embed/kailo-embed.js (wire v1) with the same public
// surface as window.KailoEmbed; used by the src/kailo tests only.
import type { KailoEmbedRuntime, KailoLocale, KailoTheme } from './bridge'

/** Fake of client-kit/embed/kailo-embed.js (wire v1) with the same public surface. */
export function fakeRuntime(initial: { theme?: KailoTheme; locale?: KailoLocale; supplied?: boolean } = {}) {
  const state = { theme: initial.theme ?? 'light', locale: initial.locale ?? 'zh-CN', embedded: false, hostConnected: false }
  let supplied = initial.supplied ?? false
  const themeListeners: Array<(t: KailoTheme) => void> = []
  const localeListeners: Array<(l: KailoLocale) => void> = []
  const calls = { signIn: 0, identity: [] as string[] }
  const runtime: KailoEmbedRuntime = {
    version: 1,
    getState: () => ({ ...state }) as never,
    onThemeChange: fn => { themeListeners.push(fn); return () => themeListeners.splice(themeListeners.indexOf(fn), 1) },
    onLocaleChange: fn => { localeListeners.push(fn); return () => localeListeners.splice(localeListeners.indexOf(fn), 1) },
    useIdentityLocale: locale => {
      calls.identity.push(locale)
      if (supplied || (locale !== 'zh-CN' && locale !== 'en')) return false
      state.locale = locale as KailoLocale
      localeListeners.slice().forEach(fn => fn(locale as KailoLocale))
      return true
    },
    requestTopLevelSignIn: () => { calls.signIn++; return true },
  }
  const host = {
    setTheme(theme: KailoTheme) { state.theme = theme; themeListeners.slice().forEach(fn => fn(theme)) },
    setLocale(locale: KailoLocale) { supplied = true; state.locale = locale; localeListeners.slice().forEach(fn => fn(locale)) },
  }
  return { runtime, host, calls, themeListeners, localeListeners }
}

