import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { kailoSurfacePanel, kailoSurfaceProps, KailoSurfaceUnavailable, KailoSurfaceFrame } from './KailoAdminSurface'
import { kailoAdminRouteState } from '../../../../../gui.ajax/res/js/ui/ReactUI/router/KailoAdminRouter'

// DD-138(6), design 07 §4.8.5 (V-SCN-269/270): in Kailo mode the native
// console renders only the declared admin surface of the page, else the Kailo
// empty state; a READ_ONLY surface gets no native write access.
const DS = {
    key: 'storage.dataSources', node: '/data/datasources', component: 'AdminWorkspaces.DataSourcesBoard',
    access: 'READ_ONLY', readOnly: true, title: '文件存储位置',
}
const META = { ...DS, key: 'files.metadata', node: '/data/metadata', component: 'AdminWorkspaces.MetadataBoard', access: 'EDITABLE', readOnly: false, title: '文件元数据字段' }

const node = (p, component) => ({ getPath: () => p, getMetadata: () => new Map(component ? [['component', component]] : []) })
const kailo = (surface, extra = {}) => ({
    kailoMode: () => true,
    adminSurface: () => surface,
    text: (k) => ({ adminUnavailable: '该管理项不可用', adminUnavailableBody: '请回到 Kailo 管理区重新打开。' })[k] || k,
    setAdminSurfaceState: vi.fn(),
    pageHosted: () => true,
    ...extra,
})

afterEach(cleanup)

describe('Kailo admin surface of the native console', () => {
    it('leaves the upstream console outside Kailo mode', () => {
        expect(kailoSurfacePanel(undefined, node('/'))).toEqual({ mode: 'native' })
        expect(kailoSurfacePanel({ kailoMode: () => false }, node('/'))).toEqual({ mode: 'native' })
    })

    it('renders only the surface panel on its own console node', () => {
        expect(kailoSurfacePanel(kailo(DS), node('/data/datasources', 'AdminWorkspaces.DataSourcesBoard'))).toEqual({ mode: 'panel', surface: DS })
        expect(kailoSurfacePanel(kailo(META), node('/data/metadata', 'AdminWorkspaces.MetadataBoard'))).toEqual({ mode: 'panel', surface: META })
        // Any other console node waits for the pin back to the surface node.
        expect(kailoSurfacePanel(kailo(DS), node('/'))).toEqual({ mode: 'loading', surface: DS })
        expect(kailoSurfacePanel(kailo(DS), node('/idm/users', 'AdminPeople.Dashboard'))).toEqual({ mode: 'loading', surface: DS })
        expect(kailoSurfacePanel(kailo(DS), node('/data/datasources'))).toEqual({ mode: 'loading', surface: DS })
        // The node exists but carries another panel: nothing of it renders.
        expect(kailoSurfacePanel(kailo(DS), node('/data/datasources', 'AdminPeople.Dashboard'))).toEqual({ mode: 'unavailable' })
    })

    it('is the empty state without a declared surface (console closed in Kailo mode)', () => {
        expect(kailoSurfacePanel(kailo(null), node('/data/datasources', 'AdminWorkspaces.DataSourcesBoard'))).toEqual({ mode: 'unavailable' })
        expect(kailoSurfacePanel(kailo(null), node('/', 'AdminComponents.GridDashboard'))).toEqual({ mode: 'unavailable' })
    })

    it('gives a READ_ONLY surface no native write access', () => {
        const menu = { versioningReadonly: false, storageTypes: ['LOCAL', 'S3'], accesses: { CreateDatasource: true } }
        const props = kailoSurfaceProps(DS, menu)
        expect(props).toMatchObject({ kailoSurface: DS, kailoReadOnly: true, versioningReadonly: true, storageTypes: ['LOCAL', 'S3'] })
        expect(props.accesses).toEqual({})
        const editable = kailoSurfaceProps(META, {})
        expect(editable).toEqual({ kailoSurface: META })
    })

    it('shows the Kailo empty state and lets Kailo reveal the page', () => {
        const k = kailo(null)
        render(<KailoSurfaceUnavailable kailo={k}/>)
        expect(screen.getByRole('status')).toHaveTextContent('该管理项不可用')
        expect(k.setAdminSurfaceState).toHaveBeenCalledWith({ ready: true })
    })

    it('draws no own title when Kailo draws the page header', () => {
        const { container, rerender } = render(<KailoSurfaceFrame kailo={kailo(DS)} surface={DS}><p>panel</p></KailoSurfaceFrame>)
        expect(container.querySelector('.kailo-admin-surface-title')).toBe(null)
        expect(container.querySelector('[data-kailo-admin-surface="storage.dataSources"]')).not.toBe(null)
        rerender(<KailoSurfaceFrame kailo={kailo(DS, { pageHosted: () => false })} surface={DS}><p>panel</p></KailoSurfaceFrame>)
        expect(container.querySelector('.kailo-admin-surface-title')).toHaveTextContent('文件存储位置')
    })

    it('opens the console workspace only for a declared surface and a native admin', () => {
        const user = (active, repos) => ({ getActiveRepository: () => active, getRepositoriesList: () => new Map(repos.map((r) => [r, {}])) })
        expect(kailoAdminRouteState({ user: user('homepage', ['homepage', 'settings']) }, kailo(null))).toBe('unavailable')
        expect(kailoAdminRouteState({ user: null }, kailo(DS))).toBe('cover')
        expect(kailoAdminRouteState({ user: user('homepage', ['homepage', 'settings']) }, kailo(DS))).toBe('switch')
        expect(kailoAdminRouteState({ user: user('settings', ['homepage', 'settings']) }, kailo(DS))).toBe('console')
        // A member without the directory-derived admin profile has no console workspace.
        expect(kailoAdminRouteState({ user: user('homepage', ['homepage', 'r1']) }, kailo(DS))).toBe('unavailable')
    })

    it('keeps the console layout out of Kailo mode in the dashboard source', () => {
        const here = path.dirname(fileURLToPath(import.meta.url))
        const source = readFileSync(path.join(here, 'AdminDashboard.js'), 'utf8')
        const kailoBranch = source.slice(source.indexOf("if(panel.mode !== 'native'){"), source.indexOf('<MuiThemeProvider muiTheme={this.theme}>'))
        expect(kailoBranch).toContain('KailoSurfaceFrame')
        expect(kailoBranch).not.toMatch(/AdminLeftNav|TasksPanel|GridDashboard/)
    })
})
