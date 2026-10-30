/*
 * DD-167 (20 §15.1) toolbar of the Kailo-mode files list: 44 high.
 * Left: business search in the current location (34 high, 300 ms debounce;
 * Kailo's ⌘K stays the global search) and, with a selection, the native
 * selection actions. Right: view (list / grid), sort, details panel.
 */
import React, {useEffect, useRef, useState} from 'react'
import KailoIcon from './KailoIcons'
import {kt, useKailo} from './useKailo'

const SORTS = [
    {key: 'ajxp_label', label: 'sortName'},
    {key: 'ajxp_modiftime', label: 'sortModified'},
    {key: 'bytesize', label: 'sortSize'},
]

function SortMenu({sortingInfo, onSort}) {
    const [open, setOpen] = useState(false)
    const ref = useRef(null)
    useEffect(() => {
        if (!open) {
            return undefined
        }
        const close = (e) => {
            if (e.type === 'keydown' && e.key !== 'Escape') {
                return
            }
            if (e.type === 'mousedown' && ref.current && ref.current.contains(e.target)) {
                return
            }
            if (e.type === 'keydown') {
                e.stopPropagation()
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
    const active = sortingInfo && sortingInfo.attribute ? SORTS.find(s => s.key === sortingInfo.attribute || (sortingInfo.remote && remoteKey(s.key) === sortingInfo.attribute)) : null
    const direction = sortingInfo && sortingInfo.direction === 'desc' ? 'desc' : 'asc'
    return (
        <div className="kailo-menu-anchor" ref={ref}>
            <button type="button" className="kailo-button kailo-button-ghost kailo-toolbar-sort" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
                <KailoIcon name="arrow-up-down" size={14}/>
                <span>{active ? kt(active.label) : kt('sortName')}</span>
            </button>
            {open &&
                <div className="kailo-menu" role="menu">
                    <div className="kailo-menu-title">{kt('sortBy')}</div>
                    {SORTS.map(s => {
                        const on = active ? active.key === s.key : s.key === 'ajxp_label'
                        return (
                            <button key={s.key} type="button" role="menuitemradio" aria-checked={on} className={'kailo-menu-item' + (on ? ' kailo-menu-item-on' : '')}
                                onClick={() => { setOpen(false); onSort(s.key) }}>
                                <span className="kailo-menu-item-label">{kt(s.label)}</span>
                                {on && <span className="kailo-menu-item-hint">{kt(direction === 'desc' ? 'sortDesc' : 'sortAsc')}</span>}
                            </button>
                        )
                    })}
                </div>
            }
        </div>
    )
}

function remoteKey(key) {
    return key === 'ajxp_label' ? 'name' : key === 'bytesize' ? 'size' : key === 'ajxp_modiftime' ? 'mtime' : key
}

export default function KailoToolbar({
    locationName, searchView, searchTerm, onSearch, onClearSearch,
    selectionToolbar, view, onView, sortingInfo, onSort, infoOpen, onToggleInfo, showInfo = true,
}) {
    useKailo()
    const [term, setTerm] = useState(searchTerm || '')
    const timer = useRef(null)
    useEffect(() => { setTerm(searchTerm || '') }, [searchTerm])
    useEffect(() => () => timer.current && clearTimeout(timer.current), [])
    const change = (value) => {
        setTerm(value)
        if (timer.current) {
            clearTimeout(timer.current)
        }
        timer.current = setTimeout(() => {
            timer.current = null
            if (value.trim()) {
                onSearch(value.trim())
            } else if (searchView) {
                onClearSearch()
            }
        }, 300)
    }
    const placeholder = locationName ? kt('searchHere', locationName) : kt('searchAll')
    return (
        <div className="kailo-toolbar" role="toolbar">
            <label className="kailo-search-field">
                <KailoIcon name="search" size={16}/>
                <input
                    type="search"
                    value={term}
                    placeholder={placeholder}
                    aria-label={placeholder}
                    onChange={(e) => change(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && term.trim()) {
                            if (timer.current) {
                                clearTimeout(timer.current)
                                timer.current = null
                            }
                            onSearch(term.trim())
                        } else if (e.key === 'Escape' && term) {
                            e.stopPropagation()
                            change('')
                        }
                    }}
                />
                {(term || searchView) &&
                    <button type="button" className="kailo-search-clear" aria-label={kt('clearSearch')} title={kt('clearSearch')}
                        onClick={() => { setTerm(''); onClearSearch() }}>
                        <KailoIcon name="x" size={14}/>
                    </button>
                }
            </label>
            <div className="kailo-toolbar-selection">{selectionToolbar}</div>
            <span className="kailo-toolbar-spacer"/>
            {onSort && view !== 'grid-search' && <SortMenu sortingInfo={sortingInfo} onSort={onSort}/>}
            {onView &&
                <div className="kailo-segmented" role="radiogroup">
                    <button type="button" role="radio" aria-checked={view !== 'grid'} aria-label={kt('viewList')} title={kt('viewList')}
                        className={'kailo-segment' + (view !== 'grid' ? ' kailo-segment-on' : '')} onClick={() => onView('list')}>
                        <KailoIcon name="list" size={16}/>
                    </button>
                    <button type="button" role="radio" aria-checked={view === 'grid'} aria-label={kt('viewGrid')} title={kt('viewGrid')}
                        className={'kailo-segment' + (view === 'grid' ? ' kailo-segment-on' : '')} onClick={() => onView('grid')}>
                        <KailoIcon name="grid" size={16}/>
                    </button>
                </div>
            }
            {showInfo &&
                <button type="button" className={'kailo-icon-button' + (infoOpen ? ' kailo-icon-button-on' : '')} aria-pressed={!!infoOpen}
                    aria-label={kt('details')} title={kt('details')} onClick={onToggleInfo}>
                    <KailoIcon name="panel-right" size={16}/>
                </button>
            }
        </div>
    )
}
