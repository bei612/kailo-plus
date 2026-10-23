// Single source for "which Settings sections may this user see" — shared by
// the Settings page navigation and the sidebar user menu ("全部设置" entry).
// Pure rules live in @/kailo/surface; this composable only binds them to the
// auth and deployment-capability stores. Backend route guards stay authoritative.

import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useDeploymentCapabilitiesStore } from '@/stores/deploymentCapabilities'
import {
  INTEGRATION_PREVIEW_ITEMS,
  INTEGRATION_TAB_CAPABILITY,
  INTEGRATION_TAB_MIN_ROLE,
} from '@/config/integrations'
import { SETTINGS_SECTION_MIN_ROLE, SYSTEM_ADMIN_SETTINGS_SECTIONS } from '@/config/settingsAccess'
import { SETTINGS_SECTION_CAPABILITY } from '@/config/deploymentCapabilities'
import { integrationSectionKey, integrationTabFromSection, isIntegrationSection } from '@/config/settingsRoute'
import { kailoConfig } from '@/kailo/runtime'
import { kailoHiddenSettingsSection, kailoSettingsMinRole, visibleSettingsSections } from '@/kailo/surface'

/** Every settings section key, in navigation order (Settings.vue renders labels/icons). */
export const SETTINGS_SECTION_KEYS: readonly string[] = [
  'general',
  'ollama',
  'models',
  'websearch',
  'chathistory',
  'memory',
  'vectorstore',
  'parser',
  'storage',
  'sandbox',
  'skills',
  'mcp',
  'system',
  'system-global',
  'runtime-queues',
  'platform-api-keys',
  'system-audit-log',
  'userprofile',
  'browserconnection',
  'mymemory',
  'envvars',
  'tenant',
  'members',
  ...INTEGRATION_PREVIEW_ITEMS.map((item) => integrationSectionKey(item.key)),
]

export function useSettingsSectionVisibility() {
  const authStore = useAuthStore()
  const deploymentCapabilities = useDeploymentCapabilitiesStore()
  const kailoMode = kailoConfig().mode

  const isSectionSupported = (key: string): boolean => {
    if (isIntegrationSection(key)) {
      return deploymentCapabilities.isSupported(
        INTEGRATION_TAB_CAPABILITY[integrationTabFromSection(key)],
      )
    }
    return deploymentCapabilities.isSupported(SETTINGS_SECTION_CAPABILITY[key])
  }

  const canSeeSection = (key: string): boolean => {
    if (kailoHiddenSettingsSection(key, kailoMode)) return false
    if (SYSTEM_ADMIN_SETTINGS_SECTIONS.has(key)) {
      return authStore.isSystemAdmin
    }
    const nativeMin = isIntegrationSection(key)
      ? INTEGRATION_TAB_MIN_ROLE[integrationTabFromSection(key)]
      : (SETTINGS_SECTION_MIN_ROLE[key] ?? 'viewer')
    const min = kailoSettingsMinRole(nativeMin, kailoMode)
    if (!min) return true
    // canAccessAllTenants（superuser）和路由层一样必须 bypass，否则 cross-tenant
    // 管理员看不到自己有权操作的入口（参考 TenantMembers.vue 的 canManage）。
    if (authStore.canAccessAllTenants) return true
    return authStore.hasRole(min)
  }

  // currentTenantRole 为空表示「membership 还没加载」—— 比起渲染整套 viewer
  // 入口然后角色一返回又消失，先卡住不渲染更稳。
  const visibleSectionKeys = computed(() =>
    visibleSettingsSections(SETTINGS_SECTION_KEYS, {
      kailoMode,
      roleLoaded: Boolean(authStore.currentTenantRole) || authStore.canAccessAllTenants,
      canSee: canSeeSection,
      isSupported: isSectionSupported,
    }),
  )

  return { kailoMode, canSeeSection, isSectionSupported, visibleSectionKeys }
}
