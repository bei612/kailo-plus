// Test double of client-kit/embed/kailo-embed.js (wire v1) with the same public
// surface as window.KailoEmbed; used by the src/kailo tests only.
import type {
  KailoEmbedRuntime,
  KailoFontSize,
  KailoLocale,
  KailoPresentationChange,
  KailoPresentationState,
  KailoPreferenceValues,
  KailoPrompt,
  KailoTheme,
} from './bridge'

const TYPE_SCALE: Record<KailoFontSize, number> = { smaller: 13 / 14, default: 1, larger: 15 / 14 }

/**
 * Fake of client-kit/embed/kailo-embed.js (wire v1) with the same public surface.
 * `dd167` adds the DD-167 runtime: onChange with type dials, preferences and
 * prompt (answered by `host.answerPrompt`).
 */
export function fakeRuntime(initial: {
  theme?: KailoTheme
  locale?: KailoLocale
  supplied?: boolean
  dd167?: boolean
  promptSupported?: boolean
  preferences?: KailoPreferenceValues
} = {}) {
  const state = {
    theme: initial.theme ?? 'light',
    locale: initial.locale ?? 'zh-CN',
    fontSize: 'default' as KailoFontSize,
    zoom: 1,
    embedded: false,
    hostConnected: false,
  }
  let supplied = initial.supplied ?? false
  let preferences: KailoPreferenceValues = { ...(initial.preferences ?? {}) }
  const themeListeners: Array<(t: KailoTheme) => void> = []
  const localeListeners: Array<(l: KailoLocale) => void> = []
  const changeListeners: Array<(s: KailoPresentationState, c: KailoPresentationChange) => void> = []
  const preferenceListeners: Array<(v: KailoPreferenceValues, changed: string[]) => void> = []
  const prompts: Array<{ options: KailoPrompt; resolve: (value: string | null) => void }> = []
  const calls = { signIn: 0, identity: [] as string[] }
  const snapshot = (): KailoPresentationState => (initial.dd167
    ? { ...state, typeScale: TYPE_SCALE[state.fontSize] }
    : { theme: state.theme, locale: state.locale, embedded: state.embedded, hostConnected: state.hostConnected })
  const off = <T>(list: T[], fn: T) => () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1) }
  const emit = (changed: KailoPresentationChange) => {
    if (changed.theme) themeListeners.slice().forEach(fn => fn(state.theme))
    if (changed.locale) localeListeners.slice().forEach(fn => fn(state.locale))
    if (initial.dd167) changeListeners.slice().forEach(fn => fn(snapshot(), changed))
  }
  const runtime: KailoEmbedRuntime = {
    version: 1,
    getState: () => snapshot(),
    onThemeChange: fn => { themeListeners.push(fn); return off(themeListeners, fn) },
    onLocaleChange: fn => { localeListeners.push(fn); return off(localeListeners, fn) },
    useIdentityLocale: locale => {
      calls.identity.push(locale)
      if (supplied || (locale !== 'zh-CN' && locale !== 'en')) return false
      state.locale = locale as KailoLocale
      emit({ theme: false, locale: true, fontSize: false, zoom: false })
      return true
    },
    requestTopLevelSignIn: () => { calls.signIn++; return true },
  }
  if (initial.dd167) {
    runtime.onChange = fn => { changeListeners.push(fn); return off(changeListeners, fn) }
    runtime.getPreferences = () => ({ ...preferences })
    runtime.onPreferencesChange = fn => { preferenceListeners.push(fn); return off(preferenceListeners, fn) }
    runtime.prompt = (options: KailoPrompt) => {
      if (!initial.promptSupported) return null
      return new Promise<string | null>((resolve) => { prompts.push({ options, resolve }) })
    }
  }
  const host = {
    setTheme(theme: KailoTheme) { state.theme = theme; emit({ theme: true, locale: false, fontSize: false, zoom: false }) },
    setLocale(locale: KailoLocale) { supplied = true; state.locale = locale; emit({ theme: false, locale: true, fontSize: false, zoom: false }) },
    setType(fontSize: KailoFontSize, zoom: number) {
      const changed = { theme: false, locale: false, fontSize: state.fontSize !== fontSize, zoom: state.zoom !== zoom }
      state.fontSize = fontSize
      state.zoom = zoom
      emit(changed)
    },
    setPreferences(values: KailoPreferenceValues) {
      const changed = Object.keys(values).filter((key) => preferences[key] !== values[key])
      preferences = { ...values }
      preferenceListeners.slice().forEach(fn => fn({ ...preferences }, changed))
    },
    answerPrompt(value: string | null) { prompts.shift()?.resolve(value) },
  }
  return { runtime, host, calls, prompts, themeListeners, localeListeners, changeListeners }
}
