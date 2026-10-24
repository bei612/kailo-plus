import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
function load({ search = '', pathname = '/ws-files/folder', embedded = true, params, storage = memoryStorage(), pydio, features } = {}) {
    document.documentElement.removeAttribute('data-kailo-embedded')
    document.documentElement.removeAttribute('data-kailo-theme')
    document.documentElement.removeAttribute('data-kailo-page-hosted')
    document.head.innerHTML = `<meta name="kailo-web-origin" content="${KAILO}">` +
        (features ? `<meta name="kailo-embed-features" content="${features}">` : '')
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
    const send = (data) => listeners.message({ origin: KAILO, source: win.parent, data: { source: 'kailo-host', version: 1, ...data } })
    const posted = (type) => parent.postMessage.mock.calls.map((c) => c[0]).filter((m) => m.type === type)
    return { win, api: win.KailoCells, parent, host, send, posted, storage }
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

    it('imposes the Kailo language inside a frame over the account preference (DD-133)', () => {
        // Before the native application exists, inside Kailo the launch locale already decides,
        // so Controller.setUser cannot switch back to the stored account language.
        const { api, host } = load({ search: '?kailo_theme=dark&kailo_locale=en', pydio: undefined })
        expect(api.language()).toBe('en-us')
        host({ theme: 'light', locale: 'zh-CN' })
        expect(api.language()).toBe('zh-cn')
    })

    it('leaves the account preference in charge at top level until the bridge seeded the locale', () => {
        expect(load({ embedded: false, pydio: undefined }).api.language()).toBe('')
        expect(load({ embedded: false, pydio: fakePydio('en-us') }).api.language()).toBe('en-us')
        expect(load({ embedded: false, search: '?kailo_locale=zh-CN', pydio: fakePydio('en-us') }).api.language()).toBe('zh-cn')
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
        // V-SCN-226: Kailo alone prompts; no second notice inside the frame.
        expect(document.getElementById('kailo-auth-problem')).toBeNull()
    })

    it('explains a stopped sign-in loop itself when Kailo cannot be asked', () => {
        const { api, parent } = load({ embedded: false })
        for (let i = 0; i < 3; i += 1) {
            api.startLogin('/auth/kailo/login')
        }
        expect(api.startLogin('/auth/kailo/login')).toBe(false)
        expect(parent.postMessage).not.toHaveBeenCalled()
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

// A native application in a location (Cells repository) at a folder path.
function pagePydio({ path = '/2026/reports', slug = 'personal-files', readOnly = false, templates = [] } = {}) {
    const base = fakePydio('zh-cn')
    const node = (p) => ({ getPath: () => p, getLabel: () => p.split('/').filter(Boolean).pop() || '' })
    const actions = {
        upload: { contextHidden: readOnly, deny: false },
        mkdir: { contextHidden: readOnly, deny: false },
        mkfile: { contextHidden: readOnly, deny: false, subMenuItems: { dynamicBuilder: () => templates } },
        share: {}, refresh: {}, switch_to_homepage: { apply: vi.fn() },
    }
    const controller = { getActionByName: (n) => actions[n] || null, fireAction: vi.fn(), observe: vi.fn() }
    const holder = { current: node(path), getContextNode() { return this.current }, getSearchNode: () => null, observe: vi.fn() }
    const repo = { accessType: 'gateway', getLabel: () => (window.KailoCells && window.KailoCells.locationLabel(slug, 'Personal Files')) || 'Personal Files', getId: () => 'r1' }
    const repos = new Map([['homepage', { accessType: 'homepage' }], ['r1', repo]])
    const user = { activeRepository: 'r1', getRepositoriesList: () => repos, getActiveRepositoryObject: () => repo }
    return Object.assign(base, {
        user, node, actions, controller, holder,
        getController: () => controller, getContextHolder: () => holder,
        goTo: vi.fn(), triggerRepositoryChange: vi.fn(), observe: vi.fn(),
    })
}

describe('DD-152 page shell over the Kailo embed runtime', () => {
    const FEATURES = 'page toast confirm shortcuts'

    function hostedLoad(pydio, extra = {}) {
        window.KailoCells = undefined
        const loaded = load({ features: FEATURES, pydio, ...extra })
        window.KailoCells = loaded.api
        loaded.host({ theme: 'light', locale: 'zh-CN' })
        return loaded
    }

    afterEach(() => { delete window.KailoCells })

    it('hands the folder header to Kailo: location trail, folder title, upload and new folder', () => {
        const pydio = pagePydio()
        const { api, posted } = hostedLoad(pydio)
        expect(api.pageHosted()).toBe(true)
        expect(document.documentElement.hasAttribute('data-kailo-page-hosted')).toBe(true)
        expect(api._internal.syncPage()).toBe(true)
        const { page } = posted('page').pop()
        expect(page.title).toBe('reports')
        expect(page.breadcrumbs).toEqual([{ id: 'dir:/', label: '个人文件' }, { id: 'dir:/2026', label: '2026' }])
        expect(page.tabs.map((t) => t.label)).toEqual(['主页', '所有文件', '收藏'])
        expect(page.activeTab).toBe('files')
        expect(page.actions.slice(0, 2)).toEqual([
            { id: 'upload', label: '上传', variant: 'primary', icon: 'upload' },
            { id: 'mkdir', label: '新建文件夹', variant: 'secondary', icon: 'folder-plus' },
        ])
        expect(page.actions.find((a) => a.id === 'refresh')).toMatchObject({ variant: 'menu', icon: 'refresh' })
        // The location root: the location is the title, no trail.
        pydio.holder.current = pydio.node('/')
        api._internal.syncPage()
        expect(posted('page').pop().page).toMatchObject({ title: '个人文件', breadcrumbs: [] })
    })

    it('keeps upload visible but unavailable in a read-only location', () => {
        const { api, posted } = hostedLoad(pagePydio({ readOnly: true }))
        api._internal.syncPage()
        const { actions } = posted('page').pop().page
        expect(actions.find((a) => a.id === 'upload')).toMatchObject({ disabled: true })
        expect(actions.find((a) => a.id === 'mkdir')).toMatchObject({ disabled: true })
    })

    it('runs header actions and navigation that Kailo sends back', () => {
        const create = vi.fn()
        const pydio = pagePydio({ templates: [{ alt: 'Word 文档', callback: create }] })
        const { api, send, posted } = hostedLoad(pydio)
        api._internal.syncPage()
        expect(posted('page').pop().page.actions.find((a) => a.id === 'mkfile:0')).toMatchObject({ label: '新建Word 文档', variant: 'menu' })
        send({ type: 'action', id: 'upload' })
        expect(pydio.controller.fireAction).toHaveBeenCalledWith('upload')
        send({ type: 'action', id: 'mkfile:0' })
        expect(create).toHaveBeenCalled()
        send({ type: 'navigate', target: { kind: 'breadcrumb', id: 'dir:/2026' } })
        expect(pydio.goTo).toHaveBeenCalledWith('/2026')
        // Ids that are not in the current header never arrive.
        send({ type: 'navigate', target: { kind: 'breadcrumb', id: 'dir:/etc' } })
        expect(pydio.goTo).toHaveBeenCalledTimes(1)
        send({ type: 'navigate', target: { kind: 'tab', id: 'bookmarks' } })
        expect(api.listPane()).toBe('bookmarks')
        api._internal.syncPage()
        expect(posted('page').pop().page.activeTab).toBe('bookmarks')
        send({ type: 'navigate', target: { kind: 'tab', id: 'home' } })
        expect(pydio.actions.switch_to_homepage.apply).toHaveBeenCalled()
        expect(api.listPane()).toBe('files')
    })

    it('shows the open file in the header and closes it from the breadcrumbs', () => {
        const pydio = pagePydio({ path: '/2026' })
        const { api, send, posted } = hostedLoad(pydio)
        const close = vi.fn()
        const download = vi.fn()
        api.setEditor({ node: pydio.node('/2026/周报.docx'), title: '周报.docx', close, download })
        api._internal.syncPage()
        const { page } = posted('page').pop()
        expect(page.title).toBe('周报.docx')
        expect(page.breadcrumbs.map((b) => b.label)).toEqual(['个人文件', '2026'])
        expect(page.actions.map((a) => a.id)).toEqual(['download'])
        send({ type: 'action', id: 'download' })
        expect(download).toHaveBeenCalled()
        send({ type: 'navigate', target: { kind: 'breadcrumb', id: 'dir:/2026' } })
        expect(close).toHaveBeenCalled()
        expect(pydio.goTo).toHaveBeenCalledWith('/2026')
    })

    it('relays native messages as Kailo toasts, keeping messages with their own action native', () => {
        const { api, posted } = hostedLoad(pagePydio())
        expect(api.toast('SUCCESS', '已上传 3 个文件')).toBe(true)
        expect(posted('toast').pop().toast).toEqual({ tone: 'success', title: '已上传 3 个文件' })
        expect(api.toast('ERROR', { Title: '未能载入文件夹' })).toBe(true)
        expect(posted('toast').pop().toast.tone).toBe('error')
        expect(api.toast('INFO', '已复制', '撤销')).toBe(false)
        const long = '第一句说明发生了什么。' + '原因'.repeat(80)
        expect(api.toast('ERROR', long)).toBe(true)
        const t = posted('toast').pop().toast
        expect(t.title).toBe('第一句说明发生了什么。')
        expect(t.description.length).toBeLessThanOrEqual(280)
    })

    it('asks Kailo for destructive confirmations as questions', async () => {
        const { api, send, posted } = hostedLoad(pagePydio())
        const options = api.deleteConfirm(3, '', false)
        expect(options).toMatchObject({ tone: 'danger', title: '删除 3 个项目？', confirmLabel: '删除', cancelLabel: '取消' })
        expect(api.deleteConfirm(1, '周报.docx', true).title).toBe('删除「周报.docx」？')
        const answer = api.confirm(options)
        const { confirm } = posted('confirm').pop()
        send({ type: 'confirm-result', id: confirm.id, confirmed: true })
        await expect(answer).resolves.toBe(true)
    })

    it('leaves header, toasts and confirmations native at top level', () => {
        const pydio = pagePydio()
        const { api, parent } = load({ features: FEATURES, embedded: false, pydio })
        expect(api.pageHosted()).toBe(false)
        expect(document.documentElement.hasAttribute('data-kailo-page-hosted')).toBe(false)
        expect(api._internal.syncPage()).toBe(false)
        expect(api.toast('SUCCESS', '已上传')).toBe(false)
        expect(api.confirm(api.deleteConfirm(1, 'a', false))).toBe(null)
        expect(parent.postMessage).not.toHaveBeenCalled()
    })

    it('does not host the header when the build did not declare the page feature', () => {
        const { api } = load({ pydio: pagePydio() })
        expect(api.pageHosted()).toBe(false)
    })

    it('applies the Kailo vocabulary to native Chinese strings in Kailo mode only', () => {
        const { api } = load({ features: FEATURES })
        const hash = { 198: '新', 147: '书签', 177: '您确定要永久删除选定的文件吗？', x: '已保存！' }
        api.wording(hash, 'zh-cn')
        expect(hash).toEqual({ 198: '新建', 147: '收藏', 177: '你确定要永久删除选定的文件吗？', x: '已保存。' })
        expect(api.locationLabel('personal-files', 'Personal Files')).toBe('个人文件')
        expect(api.locationLabel('common-files', 'Common Files')).toBe('公共文件')
        expect(api.locationLabel('team', 'Team')).toBe('')
        const native = load({ params: {} }).api
        const untouched = { 198: '新' }
        native.wording(untouched, 'zh-cn')
        expect(untouched[198]).toBe('新')
        expect(native.locationLabel('personal-files', 'Personal Files')).toBe('')
    })
})

