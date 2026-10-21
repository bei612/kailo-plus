import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'kailo-cells.js'), 'utf8')
const KAILO = 'http://kailo.example.invalid:58090'

function memoryStorage() {
    const data = new Map()
    return {
        getItem: (k) => (data.has(k) ? data.get(k) : null),
        setItem: (k, v) => data.set(k, String(v)),
        removeItem: (k) => data.delete(k),
        data,
    }
}

// Runs the bridge against a stand-in window (frame relations, location,
// storage) and the jsdom document; returns the window and the bridge API.
function load({ search = '', pathname = '/ws-files/folder', embedded = true, params, storage = memoryStorage() } = {}) {
    document.documentElement.className = ''
    document.documentElement.removeAttribute('style')
    const listeners = {}
    const parent = { postMessage: vi.fn() }
    const win = {
        location: { search, pathname, replace: vi.fn(), reload: vi.fn() },
        sessionStorage: storage,
        addEventListener: (type, fn) => { listeners[type] = fn },
        setTimeout: () => 0,
        startParameters: params === undefined ? { KAILO_EMBED: { origins: [KAILO], titles: { 'zh-cn': 'Kailo 云盘', 'en-us': 'Kailo Files' }, sso: true, logoutUrl: KAILO + '/app/' } } : params,
        BroadcastChannel: function () { this.onmessage = null },
    }
    win.self = win
    win.top = embedded ? {} : win
    win.parent = embedded ? parent : win
    new Function('window', 'document', source)(win, document)
    return { win, api: win.KailoCells, parent, listeners, storage }
}

describe('kailo-cells presentation bridge', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
    })

    it('applies the Kailo theme and locale passed as URL parameters and keeps them for the tab', () => {
        const { api, storage } = load({ search: '?kailo_theme=DARK&kailo_locale=ZH_CN' })
        const root = document.documentElement
        expect(root.classList.contains('dark')).toBe(true)
        expect(root.classList.contains('kailo-embedded')).toBe(true)
        expect(root.getAttribute('lang')).toBe('zh-CN')
        expect(api.presentation()).toMatchObject({ theme: 'dark', dark: true, locale: 'zh-CN', language: 'zh-cn' })
        // A later navigation without parameters (SSO redirects) keeps them.
        const again = load({ search: '', storage })
        expect(again.api.presentation()).toMatchObject({ theme: 'dark', locale: 'zh-CN' })
    })

    it('defaults to the light theme at top level', () => {
        const { api } = load({ embedded: false, storage: memoryStorage() })
        expect(api.embedded).toBe(false)
        expect(document.documentElement.classList.contains('kailo-standalone')).toBe(true)
        expect(api.presentation().theme).toBe('light')
    })

    it('accepts presentation messages only from the allowed Kailo origin and parent frame', () => {
        const { api, win, parent, listeners } = load()
        const changes = vi.fn()
        api.subscribe(changes)
        listeners.message({ origin: 'http://evil.example.invalid', source: parent, data: { type: 'kailo.presentation', theme: 'DARK' } })
        listeners.message({ origin: KAILO, source: {}, data: { type: 'kailo.presentation', theme: 'DARK' } })
        expect(api.presentation().theme).toBe('light')
        expect(changes).not.toHaveBeenCalled()
        listeners.message({ origin: KAILO, source: win.parent, data: { type: 'kailo.presentation', theme: 'DARK', locale: 'EN',
            tokens: { '--primary': '210 80% 50%', '--background': 'url(https://evil.example.invalid/x)', 'color': 'red', '--ring': '1px; color: red' } } })
        expect(api.presentation()).toMatchObject({ theme: 'dark', locale: 'en', language: 'en-us', tokens: { '--primary': '210 80% 50%' } })
        expect(Object.keys(api.presentation().tokens)).toEqual(['--primary'])
        expect(document.documentElement.style.getPropertyValue('--primary')).toBe('210 80% 50%')
        expect(changes).toHaveBeenCalledTimes(1)
    })

    it('announces readiness to the allowed Kailo origins only', () => {
        const { parent } = load()
        expect(parent.postMessage).toHaveBeenCalledWith({ type: 'kailo.native.ready', component: 'file_storage' }, KAILO)
        expect(parent.postMessage).toHaveBeenCalledTimes(1)
    })

    it('starts a silent OIDC login inside a Kailo frame and remembers the page', () => {
        const { api, win, storage } = load({ search: '?x=1', pathname: '/ws-files/folder' })
        expect(api.startLogin('/auth/kailo/login')).toBe(true)
        expect(win.location.replace).toHaveBeenCalledWith('/auth/kailo/login?prompt=none')
        expect(storage.getItem('kailo.cells.return')).toBe('/ws-files/folder?x=1')
        api.startLogin('/auth/kailo/login?login_challenge=abc')
        expect(win.location.replace).toHaveBeenLastCalledWith('/auth/kailo/login?login_challenge=abc&prompt=none')
        expect(api.consumeReturnPath()).toBe('/ws-files/folder?x=1')
        expect(storage.getItem('kailo.cells.sso')).toBe(null)
    })

    it('uses the interactive Kailo login at top level and refuses foreign targets', () => {
        const { api, win } = load({ embedded: false })
        expect(api.startLogin('https://evil.example.invalid/login')).toBe(false)
        expect(api.startLogin('//evil.example.invalid/login')).toBe(false)
        expect(api.startLogin('/auth/kailo/login')).toBe(true)
        expect(win.location.replace).toHaveBeenCalledWith('/auth/kailo/login')
    })

    it('stops a redirect loop and asks the Kailo host to sign in again', () => {
        const { api, win, parent } = load()
        expect(api.startLogin('/auth/kailo/login')).toBe(true)
        expect(api.startLogin('/auth/kailo/login')).toBe(true)
        expect(api.startLogin('/auth/kailo/login')).toBe(true)
        expect(api.startLogin('/auth/kailo/login')).toBe(false)
        expect(win.location.replace).toHaveBeenCalledTimes(3)
        expect(parent.postMessage).toHaveBeenCalledWith({ type: 'kailo.native.auth-required', component: 'file_storage' }, KAILO)
        expect(document.getElementById('kailo-auth-problem')).not.toBeNull()
    })

    it('only returns to same-origin application paths', () => {
        const { api } = load()
        const { safeReturnPath } = api._internal
        for (const bad of ['//evil.example.invalid/', 'https://evil.example.invalid/', '/\\evil', '/login/callback?code=x', '/auth/kailo/callback', 'relative']) {
            expect(safeReturnPath(bad)).toBe('/')
        }
        expect(safeReturnPath('/personal-files/a%20b')).toBe('/personal-files/a%20b')
    })

    it('shows the native logout entry only outside a Kailo frame', () => {
        expect(load().api.showLogout()).toBe(false)
        const top = load({ embedded: false })
        expect(top.api.showLogout()).toBe(true)
        expect(top.api.logoutUrl()).toBe(KAILO + '/app/')
        const noUrl = load({ embedded: false, params: { KAILO_EMBED: { origins: [], sso: true } } })
        expect(noUrl.api.showLogout()).toBe(false)
        const plain = load({ embedded: false, params: {} })
        expect(plain.api.showLogout()).toBe(true)
    })

    it('normalizes Kailo enums and locales', () => {
        const { normalizeTheme, normalizeLocale, nativeLanguage } = load().api._internal
        expect(normalizeTheme('LIGHT')).toBe('light')
        expect(normalizeTheme('system')).toBe('')
        expect(normalizeLocale('ZH_CN')).toBe('zh-CN')
        expect(normalizeLocale('en-US')).toBe('en')
        expect(normalizeLocale('fr')).toBe('')
        expect(nativeLanguage('zh-CN')).toBe('zh-cn')
        expect(nativeLanguage('en')).toBe('en-us')
    })
})
