// DD-157 (20 §13): models registered through the Kailo model gateway may carry
// an opaque identifier (a UUID) as their name. A raw identifier is never shown
// as a model name: the display name wins, then a readable name, then a neutral
// label ("默认模型" / "Default model").

const OPAQUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isOpaqueModelName(name: unknown): boolean {
  return typeof name === 'string' && OPAQUE_ID.test(name.trim())
}

export function defaultModelLabel(locale: string): string {
  return /^zh\b/i.test(locale || '') ? '默认模型' : 'Default model'
}

/** The name to show for a model. */
export function modelLabel(model: { display_name?: string | null; name?: string | null }, locale: string): string {
  const display = (model.display_name || '').trim()
  if (display && !isOpaqueModelName(display)) return display
  const name = (model.name || '').trim()
  if (name && !isOpaqueModelName(name)) return name
  return defaultModelLabel(locale)
}

/** The raw name shown next to a display name, or '' when it is an opaque identifier. */
export function modelRawName(model: { display_name?: string | null; name?: string | null }): string {
  const name = (model.name || '').trim()
  return model.display_name && name && !isOpaqueModelName(name) ? name : ''
}
