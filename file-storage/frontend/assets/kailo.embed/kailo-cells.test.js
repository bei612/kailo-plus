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
function load({ search = '', pathname = '/ws-files/folder', embedded = true, params, storage = memoryStorage(), pydio, features, uploader } = {}) {
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
        File,
        UploaderModel: uploader,
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
    const node = (p) => ({
        getPath: () => p,
        getLabel: () => p.split('/').filter(Boolean).pop() || '',
        getMetadata: () => new Map(readOnly ? [['node_readonly', 'true']] : []),
    })
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
        UI: Object.assign(base.UI, { displayMessage: vi.fn() }),
        MessageHash: { 'html_uploader.upload.forbidden': '你没有在此上传的权限' },
        getController: () => controller, getContextHolder: () => holder,
        goTo: vi.fn(), triggerRepositoryChange: vi.fn(), observe: vi.fn(),
    })
}

describe('DD-157 page shell over the Kailo embed runtime', () => {
    const FEATURES = 'page toast confirm shortcuts'

    function hostedLoad(pydio, extra = {}) {
        window.KailoCells = undefined
        const loaded = load({ features: FEATURES, pydio, ...extra })
        window.KailoCells = loaded.api
        loaded.host({ theme: 'light', locale: 'zh-CN', features: FEATURES.split(' ') })
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
        expect(page.actions.slice(0, 3)).toEqual([
            { id: 'upload', label: '上传', variant: 'primary', icon: 'upload', files: { multiple: true } },
            { id: 'mkdir', label: '新建文件夹', variant: 'secondary', icon: 'folder-plus' },
            { id: 'upload-folder', label: '上传文件夹', variant: 'menu', icon: 'upload', files: { directory: true } },
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
        expect(actions.find((a) => a.id === 'upload-folder')).toMatchObject({ disabled: true })
        expect(actions.find((a) => a.id === 'mkdir')).toMatchObject({ disabled: true })
    })

    it('runs header actions and navigation that Kailo sends back', () => {
        const create = vi.fn()
        const pydio = pagePydio({ templates: [{ alt: 'Word 文档', callback: create }] })
        const { api, send, posted } = hostedLoad(pydio)
        api._internal.syncPage()
        expect(posted('page').pop().page.actions.find((a) => a.id === 'mkfile:0')).toMatchObject({ label: '新建Word 文档', variant: 'menu' })
        send({ type: 'action', id: 'mkdir' })
        expect(pydio.controller.fireAction).toHaveBeenCalledWith('mkdir')
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

    it('carries the permanent-delete choice into Kailo only when Kailo can show it (acceptance batch 5)', async () => {
        const { api, posted, host, send } = hostedLoad(pagePydio())
        const options = api.deleteConfirm(1, '周报.docx', false, true)
        expect(options.option).toEqual({ label: '永久删除（不移到回收站）', warning: '勾选后项目将被永久删除，无法恢复。' })
        expect(api.deleteConfirm(1, 'a', true, true).option).toBeUndefined()
        expect(api.deleteConfirm(1, 'a', false, false).option).toBeUndefined()
        // This Kailo did not announce confirm-option: the native dialog stays.
        expect(api.confirm(options)).toBe(null)
        host({ theme: 'light', locale: 'zh-CN', features: [...FEATURES.split(' '), 'confirm-option'] })
        const answer = api.confirm(options)
        const { confirm } = posted('confirm').pop()
        expect(confirm.option).toEqual(options.option)
        send({ type: 'confirm-result', id: confirm.id, confirmed: true, option: true })
        await expect(answer).resolves.toEqual({ confirmed: true, option: true })
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

    it('names the drop target only where uploading is possible', () => {
        const { api } = hostedLoad(pagePydio())
        expect(api._internal.dropTargetName(pagePydio())).toBe('reports')
        expect(api._internal.dropTargetName(pagePydio({ path: '/' }))).toBe('个人文件')
        expect(api._internal.dropTargetName(pagePydio({ readOnly: true }))).toBe('')
    })

    it('keeps the native header when the answering Kailo does not draw page headers (DD-157)', () => {
        const pydio = pagePydio()
        window.KailoCells = undefined
        const { api, host, posted } = load({ features: FEATURES, pydio })
        window.KailoCells = api
        const changes = vi.fn()
        api.onPageHosted(changes)
        // Before Kailo answers the header is Kailo's (its skeleton covers the page).
        expect(api.pageHosted()).toBe(true)
        host({ theme: 'light', locale: 'zh-CN', features: ['shortcuts'] })
        expect(api.pageHosted()).toBe(false)
        expect(changes).toHaveBeenCalledWith(false)
        expect(document.documentElement.hasAttribute('data-kailo-page-hosted')).toBe(false)
        expect(api._internal.syncPage()).toBe(false)
        expect(posted('page')).toEqual([])
        expect(api.toast('SUCCESS', '已上传')).toBe(false)
        expect(api.confirm(api.deleteConfirm(1, 'a', false))).toBe(null)
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

    function fakeUploader() {
        const store = { handleDropEventResults: vi.fn(), handleFolderPickerResult: vi.fn() }
        return { Store: { getInstance: () => store }, store }
    }

    const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

    it('queues the files chosen in Kailo for the declared folder like a drop, without the upload dialog', async () => {
        const pydio = pagePydio({ path: '/2026/reports' })
        const uploader = fakeUploader()
        const { api, send } = hostedLoad(pydio, { uploader })
        api._internal.syncPage()
        const target = pydio.holder.current
        const a = new File(['a'], 'a.txt')
        const b = new File(['bb'], 'b.pdf')
        send({ type: 'action', id: 'upload', files: [a, b], paths: ['a.txt', 'b.pdf'] })
        await flush()
        expect(uploader.store.handleDropEventResults).toHaveBeenCalledTimes(1)
        const [items, files, node] = uploader.store.handleDropEventResults.mock.calls[0]
        expect(items).toBe(null)
        expect(files).toEqual([a, b])
        expect(node).toBe(target)
        expect(node.getPath()).toBe('/2026/reports')
        expect(uploader.store.handleFolderPickerResult).not.toHaveBeenCalled()
        expect(pydio.controller.fireAction).not.toHaveBeenCalledWith('upload')
    })

    it('uploads a chosen folder with its relative paths into the declared folder', async () => {
        const pydio = pagePydio({ path: '/2026' })
        const uploader = fakeUploader()
        const { api, send } = hostedLoad(pydio, { uploader })
        api._internal.syncPage()
        const target = pydio.holder.current
        // The context moves on after the header was declared: the upload still targets it.
        pydio.holder.current = pydio.node('/elsewhere')
        const files = [new File(['1'], 'a.jpg'), new File(['2'], 'b.jpg'), new File(['3'], 'c.txt')]
        send({ type: 'action', id: 'upload-folder', files, paths: ['photos/a.jpg', 'photos/trip/b.jpg', 'photos/../c.txt'] })
        await flush()
        expect(uploader.store.handleFolderPickerResult).toHaveBeenCalledTimes(1)
        const [picked, node, paths] = uploader.store.handleFolderPickerResult.mock.calls[0]
        expect(picked).toEqual(files)
        expect(node).toBe(target)
        // A path that is not a clean relative path falls back to the file name.
        expect(paths).toEqual(['photos/a.jpg', 'photos/trip/b.jpg', 'c.txt'])
        expect(uploader.store.handleDropEventResults).not.toHaveBeenCalled()
    })

    it('never uploads into a read-only location: the actions are disabled and the runtime drops them', async () => {
        const pydio = pagePydio({ readOnly: true })
        const uploader = fakeUploader()
        const { api, send } = hostedLoad(pydio, { uploader })
        api._internal.syncPage()
        send({ type: 'action', id: 'upload', files: [new File(['a'], 'a.txt')], paths: ['a.txt'] })
        send({ type: 'action', id: 'upload-folder', files: [new File(['a'], 'a.txt')], paths: ['d/a.txt'] })
        await flush()
        expect(uploader.store.handleDropEventResults).not.toHaveBeenCalled()
        expect(uploader.store.handleFolderPickerResult).not.toHaveBeenCalled()
    })

    it('refuses a selection for a folder that became read-only and tells the user', async () => {
        const pydio = pagePydio()
        const uploader = fakeUploader()
        const { api } = hostedLoad(pydio, { uploader })
        api._internal.syncPage()
        pydio.holder.current.getMetadata = () => new Map([['level_readonly', 'true']])
        api._internal.runAction('upload', { files: [new File(['a'], 'a.txt')], paths: ['a.txt'] })
        await flush()
        expect(uploader.store.handleDropEventResults).not.toHaveBeenCalled()
        expect(pydio.UI.displayMessage).toHaveBeenCalledWith('ERROR', '你没有在此上传的权限')
    })

    it('opens the native upload dialog when Kailo sends the action without files', () => {
        const pydio = pagePydio()
        const { api } = hostedLoad(pydio, { uploader: fakeUploader() })
        api._internal.syncPage()
        api._internal.runAction('upload')
        expect(pydio.controller.fireAction).toHaveBeenCalledWith('upload')
    })

    it('keeps the files channel out of the header at top level', () => {
        const pydio = pagePydio()
        const { api, parent } = load({ features: FEATURES, embedded: false, pydio, uploader: fakeUploader() })
        expect(api._internal.syncPage()).toBe(false)
        expect(parent.postMessage).not.toHaveBeenCalled()
    })

    it('accepts only clean relative paths for a folder pick', () => {
        const { relativePaths } = load().api._internal
        const f = (name) => ({ name })
        expect(relativePaths([f('a'), f('b')], ['a', 'b'])).toBe(null)
        expect(relativePaths([f('a')], ['d/a'])).toEqual(['d/a'])
        expect(relativePaths([f('a'), f('b'), f('c'), f('e')], ['/a', 'd//b', 'd\\c', 'd/./e'])).toBe(null)
        expect(relativePaths([f('a'), f('b')], ['x/a', '../b'])).toEqual(['x/a', 'b'])
    })
})

// DD-138(6), design 07 §4.8.5 (V-SCN-269/270): an admin surface page renders
// only the declared admin function its launch key names, else the unavailable
// state; Kailo draws the header from the surface title.
describe('Kailo admin surfaces', () => {
    const FEATURES = 'page toast confirm shortcuts'
    const DS = '/kailo-admin/data-sources'
    const META = '/kailo-admin/metadata'

    function surfaceLoad(extra = {}) {
        window.KailoCells = undefined
        const loaded = load({ features: FEATURES, pydio: fakePydio('zh-cn'), ...extra })
        window.KailoCells = loaded.api
        return loaded
    }

    afterEach(() => { delete window.KailoCells })

    it('selects the declared surface only for its own path and key', () => {
        const ok = surfaceLoad({ pathname: DS, search: '?kailo_theme=light&kailo_locale=zh-CN&kailo_admin_surface=storage.dataSources' }).api
        expect(ok.adminSurfacePage()).toBe(true)
        expect(ok.adminSurface()).toMatchObject({
            key: 'storage.dataSources', node: '/data/datasources', component: 'AdminWorkspaces.DataSourcesBoard',
            access: 'READ_ONLY', readOnly: true, title: '文件存储位置',
        })
        const meta = surfaceLoad({ pathname: META, search: '?kailo_locale=en&kailo_admin_surface=files.metadata' }).api
        expect(meta.adminSurface()).toMatchObject({ key: 'files.metadata', readOnly: false, title: 'File metadata fields' })

        for (const [pathname, search] of [
            [DS, '?kailo_admin_surface=files.metadata'],
            [META, '?kailo_admin_surface=storage.dataSources'],
            [DS, ''],
            [DS, '?kailo_theme=dark'],
            [DS, '?kailo_admin_surface=Storage.dataSources'],
            [DS, '?kailo_admin_surface=members.users'],
            [DS, '?kailo_admin_surface=storage.dataSources&kailo_admin_surface=storage.dataSources'],
            [DS + '/', '?kailo_admin_surface=storage.dataSources'],
            ['/kailo-admin', '?kailo_admin_surface=storage.dataSources'],
        ]) {
            const api = surfaceLoad({ pathname, search }).api
            expect(api.adminSurfacePage(), pathname + search).toBe(true)
            expect(api.adminSurface(), pathname + search).toBe(null)
        }
        // A business page is never an admin surface page.
        expect(surfaceLoad({ pathname: '/ws-personal-files/a', search: '?kailo_admin_surface=storage.dataSources' }).api.adminSurfacePage()).toBe(false)
        // Outside Kailo mode there is no surface at all.
        const native = surfaceLoad({ pathname: DS, search: '?kailo_admin_surface=storage.dataSources', params: {} }).api
        expect(native.adminSurfacePage()).toBe(false)
        expect(native.adminSurface()).toBe(null)
    })

    it('keeps the launched key for its path across the in-page OIDC return', () => {
        const storage = memoryStorage()
        // Launch: the runtime records the key for the launched path.
        surfaceLoad({ pathname: DS, search: '?kailo_admin_surface=storage.dataSources', storage })
        // Back from the IdP the callback document starts at /login/callback, then the
        // router replaces the location with the saved path (here without its query).
        const { api, win } = surfaceLoad({ pathname: '/login/callback', search: '?code=x', storage })
        expect(api.adminSurface()).toBe(null)
        win.location.pathname = DS
        win.location.search = ''
        expect(api.adminSurface()).toMatchObject({ key: 'storage.dataSources' })
        // The record does not open another surface path.
        win.location.pathname = META
        expect(api.adminSurface()).toBe(null)
    })

    it('declares only the surface title once the panel is ready, with its own actions', () => {
        const { api, host, posted } = surfaceLoad({ pathname: META, search: '?kailo_admin_surface=files.metadata' })
        host({ theme: 'light', locale: 'zh-CN', features: FEATURES.split(' ') })
        expect(api._internal.syncPage()).toBe(false)
        const create = vi.fn()
        api.setAdminSurfaceState({ ready: true, actions: [
            { id: 'create', label: '新建字段', icon: 'plus', variant: 'primary', run: create },
            { id: 'Bad id', label: 'x', run: create },
        ] })
        expect(api._internal.syncPage()).toBe(true)
        const { page } = posted('page').pop()
        // No tabs or breadcrumbs: Kailo draws "管理 › 系统 › 标题" itself.
        expect(page).toEqual({ title: '文件元数据字段', breadcrumbs: [], tabs: [], actions: [{ id: 'surface:create', label: '新建字段', variant: 'primary', icon: 'plus' }] })
        api._internal.runAction('surface:create')
        expect(create).toHaveBeenCalledTimes(1)
    })

    it('titles the unavailable state and offers no action there', () => {
        const { api, host, posted } = surfaceLoad({ pathname: DS, search: '?kailo_admin_surface=files.metadata' })
        host({ theme: 'light', locale: 'en', features: FEATURES.split(' ') })
        api.setAdminSurfaceState({ ready: true, actions: [{ id: 'create', label: 'x', run: vi.fn() }] })
        expect(api._internal.syncPage()).toBe(true)
        expect(posted('page').pop().page).toEqual({ title: 'This admin item is unavailable', breadcrumbs: [], tabs: [], actions: [] })
    })

    it('shows data source facts as values and never a credential', () => {
        const { api } = surfaceLoad({ pathname: DS, search: '?kailo_locale=zh-CN&kailo_admin_surface=storage.dataSources' })
        const s3 = {
            Name: 'archive', StorageType: 'S3', ObjectsBucket: 'kailo', ObjectsBaseFolder: 'files', FlatStorage: true,
            ApiKey: 'AKIA-secret-key', ApiSecret: 'vault-ref-secret', VersioningPolicyName: 'default-policy', EncryptionMode: 'MASTER',
            StorageConfiguration: { customEndpoint: 'https://s3.example.invalid', customRegion: 'eu-1', readOnly: 'true' },
        }
        const facts = api.dataSourceFacts(s3, [{ Uuid: 'default-policy', Name: '保留 30 天' }])
        expect(facts).toEqual([
            { label: '名称', value: 'archive' },
            { label: '存储类型', value: 'S3 兼容对象存储' },
            { label: '状态', value: '已启用' },
            { label: '存储桶', value: 'kailo/files' },
            { label: '服务端点', value: 'https://s3.example.invalid' },
            { label: '区域', value: 'eu-1' },
            { label: '存储格式', value: '扁平（只经云盘访问）' },
            { label: '只读存储', value: '是' },
            { label: '版本保留', value: '保留 30 天' },
            { label: '加密', value: '已启用' },
        ])
        expect(JSON.stringify(facts)).not.toMatch(/secret|AKIA/)
        const local = api.dataSourceFacts({ Name: 'personal', StorageConfiguration: { folder: '/var/cells/data/personal' } }, [])
        expect(local.map((f) => f.value)).toEqual(['personal', '本地文件系统', '已启用', '/var/cells/data/personal', '结构化（与目录结构一致）', '不保留版本', '未启用'])
        expect(api.dataSourceFacts(null)).toEqual([])
    })
})
