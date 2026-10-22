// White-label surface rules (DD-133 §1): native entries that only exist to
// promote or link the upstream product/ecosystem are not part of this build.

/** Settings sections never shown (upstream cloud service, upstream version/upgrade page). */
export const WHITE_LABEL_HIDDEN_SETTINGS: ReadonlySet<string> = new Set([
  'weknoracloud',
  'system',
])

/** Integration tabs that only point at upstream-branded external products. */
export const WHITE_LABEL_HIDDEN_INTEGRATIONS: ReadonlySet<string> = new Set(['cli', 'chrome', 'claw'])

/** Upstream documentation, website and repository links are never rendered. */
export const SHOW_UPSTREAM_LINKS = false

/** Upstream cloud provider/parser keys hidden from model and parser pickers. */
export const WHITE_LABEL_HIDDEN_PROVIDERS: ReadonlySet<string> = new Set(['weknoracloud'])
