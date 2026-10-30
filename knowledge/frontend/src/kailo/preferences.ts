// DD-167 (design 20 §15.3, 07 §4.8.2): Kailo's "外观 › 列表密度" reaches this
// component as the declared preference `appearance.listDensity`. The value
// is mirrored on <html data-kailo-list-density> and the --kailo-list-row
// variable (40 px comfortable, 32 px compact) that every list and table of
// the Kailo shell reads, and in a reactive ref for code that lays rows out.

import { ref } from 'vue'
import type { KailoEmbedRuntime } from './bridge'
import { ROW_HEIGHT, densityOf, type ListDensity } from './listing'

export const LIST_DENSITY_KEY = 'appearance.listDensity'

/** Current list density (comfortable until Kailo says otherwise). */
export const listDensity = ref<ListDensity>('comfortable')

type RootLike = {
  setAttribute(name: string, value: string): void
  style: { setProperty(name: string, value: string): void }
}

/** Writes one density onto the document root. */
export function applyListDensity(density: ListDensity, root: RootLike): void {
  root.setAttribute('data-kailo-list-density', density)
  root.style.setProperty('--kailo-list-row', `${ROW_HEIGHT[density]}px`)
}

/**
 * Applies the density Kailo supplied and follows its changes in the same
 * document. Runtimes before DD-138 preferences leave the default.
 * Returns the unsubscribe function.
 */
export function installListDensity(
  runtime: KailoEmbedRuntime | null,
  root: RootLike | null = typeof document !== 'undefined' ? document.documentElement : null,
): () => void {
  const apply = (density: ListDensity) => {
    listDensity.value = density
    if (root) applyListDensity(density, root)
  }
  let initial: Record<string, unknown> = {}
  try { initial = runtime?.getPreferences?.() ?? {} } catch { /* runtime without preferences */ }
  apply(densityOf(initial))
  if (!runtime || typeof runtime.onPreferencesChange !== 'function') return () => {}
  return runtime.onPreferencesChange((values, changed) => {
    if (!Array.isArray(changed) || changed.includes(LIST_DENSITY_KEY)) apply(densityOf(values))
  })
}
