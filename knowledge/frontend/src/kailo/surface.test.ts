import assert from 'node:assert/strict'
import test from 'node:test'
import {
  KAILO_PALETTE_COMMANDS,
  KAILO_PERSONAL_SETTINGS,
  fallbackSettingsSection,
  kailoHiddenSettingsSection,
  kailoSettingsMinRole,
  kailoVisibleCommands,
  nativeSettingsLinks,
  resolveSettingsSection,
  userMenuModel,
  visibleSettingsSections,
  type UserMenuInput,
} from './surface'

const ACCOUNT_GROUP = ['general', 'userprofile', 'browserconnection', 'mymemory', 'envvars']

test('the whole account group is personal and hidden only in Kailo mode', () => {
  assert.deepEqual([...KAILO_PERSONAL_SETTINGS].sort(), [...ACCOUNT_GROUP].sort())
  for (const key of ACCOUNT_GROUP) {
    assert.equal(kailoHiddenSettingsSection(key, true), true, key)
    assert.equal(kailoHiddenSettingsSection(key, false), false, key)
  }
  for (const key of ['tenant', 'models', 'members', 'integration-api']) {
    assert.equal(kailoHiddenSettingsSection(key, true), false, key)
  }
  // White-label entries stay hidden in every mode.
  assert.equal(kailoHiddenSettingsSection('system', false), true)
  assert.equal(kailoHiddenSettingsSection('weknoracloud', true), true)
})

test('Kailo mode raises every remaining settings section to admin', () => {
  assert.equal(kailoSettingsMinRole('viewer', false), 'viewer')
  assert.equal(kailoSettingsMinRole(undefined, false), undefined)
  assert.equal(kailoSettingsMinRole('viewer', true), 'admin')
  assert.equal(kailoSettingsMinRole('contributor', true), 'admin')
  assert.equal(kailoSettingsMinRole(undefined, true), 'admin')
  assert.equal(kailoSettingsMinRole('admin', true), 'admin')
  assert.equal(kailoSettingsMinRole('owner', true), 'owner')
})

const KEYS = ['general', 'models', 'userprofile', 'system', 'tenant', 'members', 'envvars', 'sandbox']
const everything = { canSee: () => true, isSupported: () => true }

test('visible sections drop hidden keys and respect role and capability', () => {
  assert.deepEqual(
    visibleSettingsSections(KEYS, { kailoMode: false, roleLoaded: true, ...everything }),
    ['general', 'models', 'userprofile', 'tenant', 'members', 'envvars', 'sandbox'],
  )
  assert.deepEqual(
    visibleSettingsSections(KEYS, { kailoMode: true, roleLoaded: true, ...everything }),
    ['models', 'tenant', 'members', 'sandbox'],
  )
  assert.deepEqual(
    visibleSettingsSections(KEYS, {
      kailoMode: true,
      roleLoaded: true,
      canSee: (key) => key !== 'members',
      isSupported: (key) => key !== 'sandbox',
    }),
    ['models', 'tenant'],
  )
  assert.deepEqual(visibleSettingsSections(KEYS, { kailoMode: true, roleLoaded: false, ...everything }), [])
})

test('fallback section is the first visible one, never personal in Kailo mode', () => {
  assert.equal(fallbackSettingsSection(['models', 'tenant'], true), 'models')
  assert.equal(fallbackSettingsSection([], true), '')
  assert.equal(fallbackSettingsSection([], false), 'general')
  assert.equal(fallbackSettingsSection(['general', 'models'], false), 'general')
})

test('direct navigation to a hidden section lands on the first visible section', () => {
  const visible = ['tenant', 'models']
  assert.equal(resolveSettingsSection('general', visible, true), 'tenant')
  assert.equal(resolveSettingsSection('userprofile', visible, true), 'tenant')
  assert.equal(resolveSettingsSection('envvars', [], true), '')
  assert.equal(resolveSettingsSection('models', visible, true), 'models')
  // Not hidden: left alone so role-denied / capability handling still applies.
  assert.equal(resolveSettingsSection('members', visible, true), 'members')
  assert.equal(resolveSettingsSection('general', ['general'], false), 'general')
  assert.equal(resolveSettingsSection('system', ['general'], false), 'general')
})

test('Kailo mode keeps only the knowledge business commands in the palette (DD-138(5))', () => {
  const commands = [
    { id: 'new-chat' },
    { id: 'open-kb-list' },
    { id: 'open-agents' },
    { id: 'open-organizations' },
    { id: 'open-settings' },
    { id: 'open-product-tour' },
    { id: 'some-future-upstream-command' },
  ]
  assert.deepEqual(kailoVisibleCommands(commands, true).map((c) => c.id), ['new-chat', 'open-kb-list'])
  assert.deepEqual([...KAILO_PALETTE_COMMANDS].sort(), ['new-chat', 'open-kb-list'])
  assert.deepEqual(kailoVisibleCommands(commands, false).map((c) => c.id), commands.map((c) => c.id))
})

const viewer: UserMenuInput = {
  kailoMode: true,
  liteMode: false,
  hasTenantSwitcher: false,
  canManageSpace: false,
  canManageMembers: false,
  canManageModels: false,
  canManageSkills: false,
  isSystemAdmin: false,
  hasVisibleSettings: false,
}

test('Kailo user menu has no personal, admin or settings entries (DD-138(6))', () => {
  const admin = userMenuModel({
    ...viewer,
    canManageSpace: true,
    canManageMembers: true,
    canManageModels: true,
    canManageSkills: true,
    isSystemAdmin: true,
    hasVisibleSettings: true,
  })
  assert.equal(admin.personalHeader, false)
  assert.equal(admin.personalSettings, false)
  assert.equal(admin.guide, false)
  assert.equal(admin.logout, false)
  assert.equal(admin.members, false)
  assert.equal(admin.spaceSettings, false)
  assert.equal(admin.models, false)
  assert.equal(admin.skills, false)
  assert.equal(admin.allSettings, false)
  assert.equal(admin.systemAdmin, false)
  // Only the space line remains; without a switcher it is static.
  assert.equal(admin.dropdown, false)
  assert.equal(admin.render, true)
  assert.equal(userMenuModel({ ...viewer, canManageSpace: true, isSystemAdmin: true, hasTenantSwitcher: true }).dropdown, true)
})

test('business pages carry no native settings links in Kailo mode', () => {
  assert.equal(nativeSettingsLinks(true), false)
  assert.equal(nativeSettingsLinks(false), true)
})

test('Kailo viewer without switcher sees a static space line', () => {
  const m = userMenuModel(viewer)
  assert.equal(m.spaceSettings, false)
  assert.equal(m.allSettings, false)
  assert.equal(m.dropdown, false)
  assert.equal(m.render, true)
  // A switcher alone keeps the dropdown.
  assert.equal(userMenuModel({ ...viewer, hasTenantSwitcher: true }).dropdown, true)
  // Without a space line and without actions there is nothing to render.
  assert.equal(userMenuModel({ ...viewer, liteMode: true }).render, false)
})

test('native user menu is unchanged outside Kailo mode', () => {
  const m = userMenuModel({ ...viewer, kailoMode: false, canManageMembers: true })
  assert.equal(m.personalHeader, true)
  assert.equal(m.personalSettings, true)
  assert.equal(m.guide, true)
  assert.equal(m.spaceSettings, true)
  assert.equal(m.members, true)
  assert.equal(m.allSettings, true)
  assert.equal(m.logout, true)
  assert.equal(m.dropdown, true)
  assert.equal(m.render, true)
  assert.equal(userMenuModel({ ...viewer, kailoMode: false, liteMode: true }).logout, false)
})
