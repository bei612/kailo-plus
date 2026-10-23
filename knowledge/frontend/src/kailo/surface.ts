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

// One product (DD-138 §2, design 07 §4.8.1): in Kailo mode personal settings,
// profile, language, theme, password, personal credentials, logout, onboarding
// and help live only in Kailo. Admin sections stay reachable for admins only
// until the admin-surface contribution lands (DD-138(6), phase 3).

/** The "account" settings group: personal entries Kailo owns in Kailo mode. */
export const KAILO_PERSONAL_SETTINGS: ReadonlySet<string> = new Set([
  'general',
  'userprofile',
  'browserconnection',
  'mymemory',
  'envvars',
])

export type SettingsRole = 'viewer' | 'contributor' | 'admin' | 'owner'

const ROLE_LEVEL: Record<SettingsRole, number> = { viewer: 10, contributor: 20, admin: 30, owner: 40 }

/** Minimum workspace role for any remaining (administrative) settings entry in Kailo mode. */
export const KAILO_SETTINGS_MIN_ROLE: SettingsRole = 'admin'

/** Whether a settings section is never rendered in this build/mode. */
export function kailoHiddenSettingsSection(key: string, kailoMode: boolean): boolean {
  return WHITE_LABEL_HIDDEN_SETTINGS.has(key) || (kailoMode && KAILO_PERSONAL_SETTINGS.has(key))
}

/**
 * Effective minimum role of a settings section. Outside Kailo mode the native
 * table applies unchanged (`undefined` = no role gate); in Kailo mode every
 * remaining section is administrative and needs at least admin.
 */
export function kailoSettingsMinRole(
  nativeMin: SettingsRole | undefined,
  kailoMode: boolean,
): SettingsRole | undefined {
  if (!kailoMode) return nativeMin
  if (!nativeMin || ROLE_LEVEL[nativeMin] < ROLE_LEVEL[KAILO_SETTINGS_MIN_ROLE]) return KAILO_SETTINGS_MIN_ROLE
  return nativeMin
}

export interface SettingsSectionAccess {
  kailoMode: boolean
  /** False until the workspace role is known (render nothing rather than flicker). */
  roleLoaded: boolean
  canSee: (key: string) => boolean
  isSupported: (key: string) => boolean
}

/** Settings sections visible to the current user, in the given order. */
export function visibleSettingsSections(keys: readonly string[], access: SettingsSectionAccess): string[] {
  if (!access.roleLoaded) return []
  return keys.filter((key) =>
    !kailoHiddenSettingsSection(key, access.kailoMode) && access.canSee(key) && access.isSupported(key))
}

/**
 * Section shown when nothing (or a hidden section) was requested: the first
 * visible one. Native builds keep 'general' as the pre-load default; Kailo mode
 * never defaults to a personal section ('' renders no section content).
 */
export function fallbackSettingsSection(visible: readonly string[], kailoMode: boolean): string {
  return visible[0] ?? (kailoMode ? '' : 'general')
}

/** A requested section (route query, shortcut, event), redirected when it is hidden. */
export function resolveSettingsSection(requested: string, visible: readonly string[], kailoMode: boolean): string {
  return kailoHiddenSettingsSection(requested, kailoMode) ? fallbackSettingsSection(visible, kailoMode) : requested
}

/** Command palette commands that duplicate Kailo surfaces (settings, onboarding). */
export const KAILO_HIDDEN_COMMANDS: ReadonlySet<string> = new Set(['open-settings', 'open-product-tour'])

export function kailoVisibleCommands<T extends { id: string }>(commands: readonly T[], kailoMode: boolean): T[] {
  return kailoMode ? commands.filter((command) => !KAILO_HIDDEN_COMMANDS.has(command.id)) : [...commands]
}

export interface UserMenuInput {
  kailoMode: boolean
  liteMode: boolean
  /** Tenant panel has a switcher (memberships to switch between). */
  hasTenantSwitcher: boolean
  canManageSpace: boolean
  canManageMembers: boolean
  canManageModels: boolean
  canManageSkills: boolean
  isSystemAdmin: boolean
  /** At least one non-hidden settings section is visible to this user. */
  hasVisibleSettings: boolean
}

export interface UserMenuModel {
  personalHeader: boolean
  personalSettings: boolean
  guide: boolean
  spaceSettings: boolean
  members: boolean
  models: boolean
  skills: boolean
  allSettings: boolean
  systemAdmin: boolean
  logout: boolean
  /** Show the dropdown toggle (chevron, click to open). */
  dropdown: boolean
  /** Render the user menu at all. */
  render: boolean
}

/** Which entries the sidebar user menu shows. Kailo mode keeps only space context and admin entries. */
export function userMenuModel(input: UserMenuInput): UserMenuModel {
  const k = input.kailoMode
  const space = !input.liteMode
  const model = {
    personalHeader: !k,
    personalSettings: !k,
    guide: !k,
    spaceSettings: space && (!k || input.canManageSpace),
    // Kailo owns membership and roles (DD-133 §4).
    members: !k && input.canManageMembers,
    // Kailo mode raises the models page to admin (kailoSettingsMinRole); keep the shortcut consistent.
    models: input.canManageModels && (!k || input.canManageSpace),
    skills: input.canManageSkills,
    allSettings: !k || input.hasVisibleSettings,
    systemAdmin: input.isSystemAdmin,
    logout: !k && space,
    dropdown: true,
    render: true,
  }
  if (k) {
    const actions = model.spaceSettings || model.models || model.skills || model.allSettings || model.systemAdmin
    const switcher = space && input.hasTenantSwitcher
    model.dropdown = actions || switcher
    // The bottom button shows the space line; without a space (lite) and without actions there is nothing.
    model.render = model.dropdown || space
  }
  return model
}
