import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const bridge = readFileSync(path.join(here, 'kailo-cells.js'), 'utf8')
// The platform runtime the image copies next to the bridge (07 §4.7.1).
const runtime = readFileSync(path.join(here, '../../../../client-kit/embed/kailo-embed.js'), 'utf8')
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

// Runs kailo-embed.js then kailo-cells.js against a stand-in window (frame
// relations, location, storage) and the jsdom document, like the page head.
function load({ search = '', pathname = '/ws-files/folder', embedded = true, params, storage = memoryStorage(), pydio } = {}) {
    document.documentElement.removeAttribute('data-kailo-embedded')
    document.documentElement.removeAttribute('data-kailo-theme')
    document.head.innerHTML = `<meta name="kailo-web-origin" content="${KAILO}">`
    const listeners = {}
    const parent = { postMessage: vi.fn() }
    const win = {
        document,
        location: { search, pathname, replace: vi.fn(), reload: vi.fn() },
        sessionStorage: storage,
        addEventListener: (type, fn) => { listeners[type] = fn },
        dispatchEvent: () => true,
        setTimeout: () => 0,
        startParameters: params === undefined ? { KAILO_EMBED: { titles: { 'zh-cn': 'Kailo 云盘', 'en-us': 'Kailo Files' }, sso: true, logoutUrl: KAILO + '/app/' } } : params,
        pydio,
    }
    win.parent = embedded ? parent : win
    new Function('window', runtime)(win)
    new Function('window', 'document', bridge)(win, document)
    const host = (data) => listeners.message({ origin: KAILO, source: win.parent, data: { source: 'kailo-host', version: 1, type: 'presentation', ...data } })
    return { win, api: win.KailoCells, parent, host, storage }
}

function fakePydio(language = 'zh-cn') {
    const wording = { title: 'native' }
    return {
        UI: { themeBuilder: { applyHostPresentation: vi.fn() } },
        Parameters: { get: (k) => (k === 'customWording' ? wording : undefined) },
        currentLanguage: language,
        loadI18NMessages: vi.fn(function (lang) { this.currentLanguage = lang }),
        wording,
    }
}

describe('Cells bridge over the Kailo embed runtime', () => {
    beforeEach(() => {
        document.body.innerHTML = ''
    })

    it('starts from the Kailo launch parameters and drives title, language and theme', () => {
        const pydio = fakePydio('zh-cn')
        const { api, host, parent } = load({ search: '?kailo_theme=dark&kailo_locale=en', pydio })
        expect(document.documentElement.getAttribute('data-kailo-theme')).toBe('dark')
        expect(document.documentElement.hasAttribute('data-kailo-embedded')).toBe(true)
        expect(api.presentation()).toMatchObject({ dark: true, locale: 'en', language: 'en-us', embedded: true })
        expect(pydio.loadI18NMessages).toHaveBeenCalledWith('en-us')
        expect(pydio.wording.title).toBe('Kailo Files')
        expect(pydio.UI.themeBuilder.applyHostPresentation).toHaveBeenLastCalledWith(expect.objectContaining({ dark: true }))
        expect(parent.postMessage).toHaveBeenCalledWith({ source: 'kailo-embed', version: 1, type: 'ready' }, KAILO)
        // A Kailo switch follows live.
        const changes = vi.fn()
        api.subscribe(changes)
        host({ theme: 'light', locale: 'zh-CN' })
        expect(changes).toHaveBeenCalledWith(expect.objectContaining({ dark: false, language: 'zh-cn' }))
        expect(pydio.wording.title).toBe('Kailo 云盘')
        expect(pydio.UI.themeBuilder.applyHostPresentation).toHaveBeenLastCalledWith(expect.objectContaining({ dark: false }))
    })

    it('seeds the language from the account at top level only when Kailo supplied none', () => {
        const pydio = fakePydio('en-us')
        const { api } = load({ embedded: false, pydio })
        expect(api.presentation().locale).toBe('en')
        expect(pydio.loadI18NMessages).not.toHaveBeenCalled()
        const kailo = fakePydio('en-us')
        expect(load({ embedded: false, search: '?kailo_locale=zh-CN', pydio: kailo }).api.presentation().locale).toBe('zh-CN')
        expect(kailo.loadI18NMessages).toHaveBeenCalledWith('zh-cn')
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

    it('stops a redirect loop and asks Kailo for a top-level sign-in (wire v1)', () => {
        const { api, win, parent } = load()
        for (let i = 0; i < 3; i += 1) {
            expect(api.startLogin('/auth/kailo/login')).toBe(true)
        }
        expect(api.startLogin('/auth/kailo/login')).toBe(false)
        expect(win.location.replace).toHaveBeenCalledTimes(3)
        expect(parent.postMessage).toHaveBeenCalledWith({ source: 'kailo-embed', version: 1, type: 'auth-required' }, KAILO)
        expect(document.getElementById('kailo-auth-problem')).not.toBeNull()
    })

    it('only returns to same-origin application paths', () => {
        const { safeReturnPath } = load().api._internal
        for (const bad of ['//evil.example.invalid/', 'https://evil.example.invalid/', '/\\evil', '/login/callback?code=x', '/auth/kailo/callback', 'relative']) {
            expect(safeReturnPath(bad)).toBe('/')
        }
        expect(safeReturnPath('/personal-files/a%20b')).toBe('/personal-files/a%20b')
    })

    it('hides the personal shell in Kailo mode, framed or top level (DD-138)', () => {
        for (const embedded of [true, false]) {
            const { api } = load({ embedded })
            expect(api.kailoMode()).toBe(true)
            expect(api.showPersonalShell()).toBe(false)
        }
        // Kailo mode follows the deployment parameters, not the framing.
        const minimal = load({ embedded: false, params: { KAILO_EMBED: { sso: false } } }).api
        expect(minimal.kailoMode()).toBe(true)
        expect(minimal.showPersonalShell()).toBe(false)
    })

    it('keeps the personal shell outside Kailo mode', () => {
        for (const params of [{}, { KAILO_EMBED: null }, { KAILO_EMBED: 'yes' }, null]) {
            for (const embedded of [true, false]) {
                const { api } = load({ embedded, params })
                expect(api.kailoMode()).toBe(false)
                expect(api.showPersonalShell()).toBe(true)
            }
        }
    })

    it('shows the native logout entry only outside a Kailo frame', () => {
        expect(load().api.showLogout()).toBe(false)
        const top = load({ embedded: false })
        expect(top.api.showLogout()).toBe(true)
        expect(top.api.logoutUrl()).toBe(KAILO + '/app/')
        expect(load({ embedded: false, params: { KAILO_EMBED: { sso: true } } }).api.showLogout()).toBe(false)
        expect(load({ embedded: false, params: {} }).api.showLogout()).toBe(true)
    })
})
