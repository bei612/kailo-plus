<template>
  <!-- Kailo mode sign-in (DD-133 (2)): no forms, buttons, links or language switch. -->
  <div class="kailo-signin" :data-state="state">
    <div class="kailo-signin__card">
      <img class="kailo-signin__logo" :src="BRAND_LOGO_URL" alt="" />
      <div class="kailo-signin__product">{{ product }}</div>
      <template v-if="state === 'loading'">
        <t-loading size="small" />
        <p class="kailo-signin__hint">{{ text('entering') }}</p>
      </template>
      <template v-else-if="state === 'reauth'">
        <p class="kailo-signin__title">{{ text('reauth') }}</p>
        <p class="kailo-signin__hint">{{ text('reauthHint') }}</p>
      </template>
      <template v-else>
        <p class="kailo-signin__title">{{ text('error') }}</p>
        <p class="kailo-signin__hint">{{ detail || text('errorHint') }}</p>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { getAuthConfig } from '@/api/auth'
import { getApiBaseUrl } from '@/utils/api-base'
import { BRAND_LOGO_URL, productName } from './brand'
import { kailoConfig } from './runtime'
import { kailoEmbed } from './bridge'
import { isKailoEmbedded } from './setup'
import { kailoText } from './strings'
import {
  buildOIDCStartURL,
  claimSilentAttempt,
  requestHostReauth,
  sanitizeReturnTo,
  type KailoSignInState,
} from './sso'

const route = useRoute()
const { locale } = useI18n()
const cfg = kailoConfig()

const queryState = route.query.kailo_state
const state = ref<KailoSignInState>(
  queryState === 'reauth' ? 'reauth' : queryState === 'error' ? 'error' : 'loading',
)
const detail = ref('')
const returnTo = sanitizeReturnTo(typeof route.query.redirect === 'string' ? route.query.redirect : '')

const product = computed(() => productName(locale.value, cfg.displayName))
const text = (key: Parameters<typeof kailoText>[0]) => kailoText(key, locale.value, cfg.displayName)

onMounted(async () => {
  if (state.value !== 'loading') return
  const authConfig = await getAuthConfig()
  if (!authConfig.oidc_auto_login) {
    state.value = 'error'
    detail.value = text('ssoUnavailable')
    return
  }
  const apiBase = getApiBaseUrl()
  if (isKailoEmbedded()) {
    // Inside the Kailo frame: silent attempt only, at most once per guard window.
    if (!claimSilentAttempt(window.sessionStorage, Date.now())) {
      requestHostReauth(kailoEmbed())
      state.value = 'reauth'
      return
    }
    window.location.replace(buildOIDCStartURL(returnTo, true, apiBase))
    return
  }
  // Top level: the IdP login page is Kailo's login; it returns here afterwards.
  window.location.replace(buildOIDCStartURL(returnTo, false, apiBase))
})
</script>

<style scoped>
.kailo-signin {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 100vh;
  background: var(--td-bg-color-page);
  color: var(--td-text-color-primary);
}

.kailo-signin__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--app-space-3);
  max-width: 360px;
  padding: var(--app-space-8);
  text-align: center;
}

.kailo-signin__logo {
  width: 48px;
  height: 48px;
  border-radius: var(--app-radius-lg);
}

.kailo-signin__product {
  font-size: var(--app-text-lg);
  font-weight: 600;
}

.kailo-signin__title {
  margin: 0;
  font-size: var(--app-text-md);
  font-weight: 600;
}

.kailo-signin__hint {
  margin: 0;
  font-size: var(--app-text-sm);
  color: var(--td-text-color-secondary);
}
</style>
