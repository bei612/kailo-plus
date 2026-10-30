import { defineStore } from 'pinia'
import { MessagePlugin } from 'tdesign-vue-next'
import i18n from '@/i18n'
import { kailoConfig } from '@/kailo/runtime'
import { kailoText } from '@/kailo/strings'

export const useUIStore = defineStore('ui', {
  state: () => ({
    showSettingsModal: false,
    showKBEditorModal: false,
    kbEditorMode: 'create' as 'create' | 'edit',
    currentKBId: null as string | null,
    kbEditorType: 'document' as 'document' | 'faq',
    // 当前选中的标签 ID，用于文件上传时传递
    selectedTagIds: [] as string[],
    kbEditorInitialSection: null as string | null,
    settingsInitialSection: null as string | null,
    settingsInitialSubSection: null as string | null,
    manualEditorVisible: false,
    manualEditorMode: 'create' as 'create' | 'edit',
    manualEditorKBId: null as string | null,
    manualEditorKnowledgeId: null as string | null,
    manualEditorInitialTitle: '',
    manualEditorInitialContent: '',
    manualEditorInitialStatus: 'draft' as 'draft' | 'publish',
    manualEditorOnSuccess: null as null | ((payload: { kbId: string; knowledgeId: string; status: 'draft' | 'publish' }) => void),
    sidebarCollapsed: localStorage.getItem('sidebar_collapsed') === 'true'
  }),

  actions: {
    openSettings(section?: string, subSection?: string) {
      // DD-138(6), 07 §4.8.5: Kailo mode has no native Settings dialog; its
      // functions are Kailo admin surfaces. A remaining opener only says where
      // the setting lives (first-use exception), never opens an admin flow.
      const kailo = kailoConfig()
      if (kailo.mode) {
        const g = i18n.global as unknown as { locale: string | { value: string } }
        const locale = typeof g.locale === 'string' ? g.locale : g.locale.value
        void MessagePlugin.info(kailoText('adminSetup', locale, kailo.displayName))
        return
      }
      this.settingsInitialSection = section || null
      this.settingsInitialSubSection = subSection || null
      this.showSettingsModal = true
    },

    closeSettings() {
      this.showSettingsModal = false
      this.settingsInitialSection = null
      this.settingsInitialSubSection = null
    },

    toggleSettings() {
      if (kailoConfig().mode) return
      this.showSettingsModal = !this.showSettingsModal
    },

    openKBSettings(kbId: string, initialSection?: string) {
      this.currentKBId = kbId
      this.kbEditorMode = 'edit'
       this.kbEditorType = 'document'
      this.kbEditorInitialSection = initialSection || null
      this.showKBEditorModal = true
    },

    openEditKB(kbId: string, initialSection?: string) {
      this.openKBSettings(kbId, initialSection)
    },

    openCreateKB(type: 'document' | 'faq' = 'document', initialSection?: string) {
      this.currentKBId = null
      this.kbEditorMode = 'create'
      this.kbEditorType = type
      this.kbEditorInitialSection = initialSection || null
      this.showKBEditorModal = true
    },

    closeKBEditor() {
      this.showKBEditorModal = false
      this.currentKBId = null
      this.kbEditorInitialSection = null
      this.kbEditorType = 'document'
    },

    openManualEditor(options: {
      mode?: 'create' | 'edit'
      kbId?: string | null
      knowledgeId?: string | null
      title?: string
      content?: string
      status?: 'draft' | 'publish'
      onSuccess?: (payload: { kbId: string; knowledgeId: string; status: 'draft' | 'publish' }) => void
    } = {}) {
      this.manualEditorMode = options.mode || 'create'
      this.manualEditorKBId = options.kbId ?? null
      this.manualEditorKnowledgeId = options.knowledgeId ?? null
      this.manualEditorInitialTitle = options.title || ''
      this.manualEditorInitialContent = options.content || ''
      this.manualEditorInitialStatus = options.status || 'draft'
      this.manualEditorOnSuccess = options.onSuccess || null
      this.manualEditorVisible = true
    },

    closeManualEditor() {
      this.manualEditorVisible = false
      this.manualEditorKnowledgeId = null
      this.manualEditorInitialContent = ''
      this.manualEditorInitialTitle = ''
      this.manualEditorInitialStatus = 'draft'
      this.manualEditorOnSuccess = null
    },

    notifyManualEditorSuccess(payload: { kbId: string; knowledgeId: string; status: 'draft' | 'publish' }) {
      if (typeof this.manualEditorOnSuccess === 'function') {
        try {
          this.manualEditorOnSuccess(payload)
        } catch (err) {
          console.error('Manual editor success callback error:', err)
        }
      }
      this.manualEditorOnSuccess = null
    },

    // 设置当前选中的标签 ID
    toggleSelectedTagId(tagId: string) {
      const idx = this.selectedTagIds.indexOf(tagId)
      if (idx >= 0) {
        this.selectedTagIds.splice(idx, 1)
      } else {
        this.selectedTagIds.push(tagId)
      }
    },

    clearSelectedTagIds() {
      this.selectedTagIds = []
    },

    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed
      localStorage.setItem('sidebar_collapsed', String(this.sidebarCollapsed))
    },

    collapseSidebar() {
      this.sidebarCollapsed = true
      localStorage.setItem('sidebar_collapsed', 'true')
    },

    expandSidebar() {
      this.sidebarCollapsed = false
      localStorage.setItem('sidebar_collapsed', 'false')
    }
  }
})

