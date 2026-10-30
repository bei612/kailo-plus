/*
 * DD-167 (07 §4.8.7(1), 20 §13.2): Kailo mode at top level (no Kailo frame
 * around the page) draws the same page header Kailo would: 52 high, the
 * category block and product name, breadcrumbs, the current title, at most
 * one primary action, secondary actions, the rest under "更多"; then the
 * 40 high section tabs (主页 · 所有文件 · 收藏). Data and handlers are the
 * ones the page declares to Kailo (KailoCells.localPage / runPageAction).
 */
import React, {useEffect, useRef, useState} from 'react'
import KailoIcon from './KailoIcons'
import {kt, kailoCells, useKailo} from './useKailo'

function pickFiles(spec, done) {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = !!(spec && (spec.multiple || spec.directory))
    if (spec && spec.directory) {
        input.setAttribute('webkitdirectory', '')
    }
    if (spec && spec.accept) {
        input.accept = spec.accept
    }
    input.style.display = 'none'
    input.addEventListener('change', () => {
        const files = Array.prototype.slice.call(input.files || [])
        if (input.parentNode) {
            input.parentNode.removeChild(input)
        }
        if (files.length) {
            done({files, paths: files.map(f => f.webkitRelativePath || f.name)})
        }
    })
    document.body.appendChild(input)
    input.click()
}

function MoreMenu({actions, run}) {
    const [open, setOpen] = useState(false)
    const ref = useRef(null)
    useEffect(() => {
        if (!open) {
            return undefined
        }
        const close = (e) => {
            if (e.type === 'mousedown' && ref.current && ref.current.contains(e.target)) {
                return
            }
            if (e.type === 'keydown' && e.key !== 'Escape') {
                return
            }
            setOpen(false)
        }
        document.addEventListener('mousedown', close, true)
        document.addEventListener('keydown', close, true)
        return () => {
            document.removeEventListener('mousedown', close, true)
            document.removeEventListener('keydown', close, true)
        }
    }, [open])
    return (
        <div className="kailo-menu-anchor" ref={ref}>
            <button type="button" className="kailo-icon-button" aria-haspopup="menu" aria-expanded={open} aria-label={kt('more')} title={kt('more')} onClick={() => setOpen(!open)}>
                <span className="kailo-more-dots" aria-hidden="true">···</span>
            </button>
            {open &&
                <div className="kailo-menu kailo-menu-right" role="menu">
                    {actions.map(a => (
                        <button key={a.id} type="button" role="menuitem" className="kailo-menu-item" disabled={a.disabled}
                            onClick={() => { setOpen(false); run(a) }}>
                            <span className="kailo-menu-item-label">{a.label}</span>
                        </button>
                    ))}
                </div>
            }
        </div>
    )
}

export default function KailoTopHeader() {
    useKailo()
    const k = kailoCells()
    const [page, setPage] = useState(() => (k && k.localPage ? k.localPage() : null))
    useEffect(() => (k && k.onLocalPage ? k.onLocalPage(setPage) : undefined), [])
    if (!page) {
        return <div className="kailo-page-header kailo-page-header-empty"><div className="kailo-page-head"/></div>
    }
    const run = (a) => {
        if (a.files) {
            pickFiles(a.files, (selection) => k.runPageAction(a.id, selection))
            return
        }
        k.runPageAction(a.id)
    }
    const actions = page.actions || []
    const primary = actions.filter(a => a.variant === 'primary')
    const secondary = actions.filter(a => a.variant === 'secondary')
    const menu = actions.filter(a => a.variant !== 'primary' && a.variant !== 'secondary')
    return (
        <div className="kailo-page-header">
            <div className="kailo-page-head">
                <span className="kailo-category-block" aria-hidden="true"><KailoIcon name="folder" size={16}/></span>
                <nav className="kailo-crumbs" aria-label={kt('locations')}>
                    <span className="kailo-crumb kailo-crumb-product">{kt('product')}</span>
                    {(page.breadcrumbs || []).map(b => (
                        <React.Fragment key={b.id}>
                            <KailoIcon name="chevron-right" size={14} className="kailo-crumb-sep"/>
                            <button type="button" className="kailo-crumb kailo-crumb-link" onClick={() => k.navigatePage({kind: 'breadcrumb', id: b.id})}>{b.label}</button>
                        </React.Fragment>
                    ))}
                    <KailoIcon name="chevron-right" size={14} className="kailo-crumb-sep"/>
                    <span className="kailo-crumb kailo-crumb-current" title={page.title}>{page.title}</span>
                </nav>
                <span style={{flex: 1}}/>
                <div className="kailo-page-actions">
                    {secondary.map(a => (
                        <button key={a.id} type="button" className="kailo-button kailo-button-secondary" disabled={a.disabled} onClick={() => run(a)}>{a.label}</button>
                    ))}
                    {primary.slice(0, 1).map(a => (
                        <button key={a.id} type="button" className="kailo-button kailo-button-primary" disabled={a.disabled} onClick={() => run(a)}>{a.label}</button>
                    ))}
                    {menu.length > 0 && <MoreMenu actions={menu} run={run}/>}
                </div>
            </div>
            {page.tabs && page.tabs.length > 0 &&
                <div className="kailo-page-tabs" role="tablist">
                    {page.tabs.map(t => (
                        <button key={t.id} type="button" role="tab" aria-selected={t.id === page.activeTab}
                            className={'kailo-page-tab' + (t.id === page.activeTab ? ' kailo-page-tab-on' : '')}
                            onClick={() => k.navigatePage({kind: 'tab', id: t.id})}>{t.label}</button>
                    ))}
                </div>
            }
        </div>
    )
}
