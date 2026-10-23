import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Kailo (DD-133(1), DD-138(7), .design/07 §4.8.1 "帮助、关于" row): the native
// admin console (native administrators only) shows no upstream "Support and
// Maintenance" / in-app upgrade teaser, software-update card or updater page.
const here = path.dirname(fileURLToPath(import.meta.url))
const plugin = path.join(here, '../../../..')
const read = (p) => readFileSync(path.join(plugin, p), 'utf8')

describe('Kailo admin dashboard', () => {
    it('default cards are only quick links and recent logs', () => {
        const source = read('res/js/AdminComponents/board/GridDashboard.js')
        const classes = [...source.matchAll(/componentClass:\s*'([^']+)'/g)].map((m) => m[1])
        expect(classes).toEqual(['AdminComponents.QuickLinks', 'AdminComponents.RecentLogs'])
        // The AGPL licence header keeps its upstream address; only code counts.
        const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
        expect(code).not.toMatch(/pydio\.com|FakeGraph|SoftwareUpdate/)
    })

    it('teaser, software-update and updater components are not shipped', () => {
        for (const gone of [
            'res/js/AdminComponents/cards/FakeGraph.js',
            'res/js/AdminComponents/cards/SoftwareUpdate.js',
            'res/js/AdminPlugins/updater',
            'res/i18n/updater',
        ]) {
            expect(existsSync(path.join(plugin, gone)), gone).toBe(false)
        }
        expect(read('res/js/AdminComponents/index.js')).not.toMatch(/FakeGraph|SoftwareUpdate/)
        expect(read('res/js/AdminPlugins/index.js')).not.toMatch(/Updater|Upgrader/)
        expect(read('manifest.xml')).not.toMatch(/namespace="updater"/)
    })

    it('no language keeps the support / upgrade / update strings', () => {
        const dir = path.join(plugin, 'res/i18n/admin_dashboard')
        for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
            const keys = Object.keys(JSON.parse(readFileSync(path.join(dir, file), 'utf8')))
            expect(keys.filter((k) => /^(ent\.|card\.update\.|graph\.)/.test(k)), file).toEqual([])
        }
    })
})
