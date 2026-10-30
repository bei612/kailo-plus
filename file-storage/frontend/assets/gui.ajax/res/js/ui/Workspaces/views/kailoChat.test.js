import { describe, it, expect } from 'vitest'
import { workspaceChatShown } from './kailoChat'

const pydio = (disabled = false) => ({
    getPluginConfigs: (plugin) => ({ get: (key) => plugin === 'action.advanced_settings' && key === 'GLOBAL_DISABLE_CHATS' ? disabled : undefined }),
})

describe('shared-space chat (DD-163, 07 §4.8.8)', () => {
    it('is never offered in Kailo mode: Kailo channels are the chat', () => {
        expect(workspaceChatShown(pydio(false), { kailoMode: () => true })).toBe(false)
    })
    it('keeps the native setting outside Kailo mode', () => {
        expect(workspaceChatShown(pydio(false), { kailoMode: () => false })).toBe(true)
        expect(workspaceChatShown(pydio(false), undefined)).toBe(true)
        expect(workspaceChatShown(pydio(true), undefined)).toBe(false)
    })
})
