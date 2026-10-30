/*
 * DD-167 (20 §15.3) pagination bar: 44 high under the list, 1 px top line.
 * Left: "共 N 条" (Caption, muted). Right: page size (20/50/100, grids
 * 24/48/96), "第 x / y 页", previous/next and page numbers (gaps beyond 7).
 * With a single page only the total stays. compact: "‹ x / y ›" for panes.
 * While a page loads the bar carries the 2 px brand progress line.
 */
import React from 'react'
import KailoIcon from './KailoIcons'
import {kt, kailoCells} from './useKailo'

function items(page, pages) {
    const k = kailoCells()
    if (k && k.pageItems) {
        return k.pageItems(page, pages)
    }
    const out = []
    for (let i = 1; i <= pages; i++) {
        out.push(i)
    }
    return out
}

export default function KailoPager({total, page = 1, pages = 1, size, sizes = [], onPage, onSize, loading = false, compact = false, className = ''}) {
    const many = pages > 1
    const go = (n) => {
        if (onPage && n >= 1 && n <= pages && n !== page) {
            onPage(n)
        }
    }
    if (compact) {
        if (!many) {
            return null
        }
        return (
            <div className={'kailo-pager kailo-pager-compact ' + className} role="navigation">
                <button type="button" className="kailo-icon-button" aria-label={kt('prevPage')} title={kt('prevPage')} disabled={page <= 1} onClick={() => go(page - 1)}>
                    <KailoIcon name="chevron-left"/>
                </button>
                <span className="kailo-pager-position">{kt('pageCompact', page, pages)}</span>
                <button type="button" className="kailo-icon-button" aria-label={kt('nextPage')} title={kt('nextPage')} disabled={page >= pages} onClick={() => go(page + 1)}>
                    <KailoIcon name="chevron-right"/>
                </button>
            </div>
        )
    }
    return (
        <div className={'kailo-pager ' + (loading ? 'kailo-pager-loading ' : '') + className} role="navigation" aria-busy={loading ? 'true' : 'false'}>
            {loading && <div className="kailo-progress" aria-hidden="true"/>}
            <span className="kailo-pager-total">{total >= 0 ? kt('total', total) : ''}</span>
            <span className="kailo-pager-spacer"/>
            {sizes.length > 1 && onSize && (many || total > sizes[0]) &&
                <label className="kailo-select kailo-pager-size">
                    <select value={size} aria-label={kt('perPage', size)} onChange={(e) => onSize(parseInt(e.target.value))}>
                        {sizes.map(s => <option key={s} value={s}>{kt('perPage', s)}</option>)}
                    </select>
                    <KailoIcon name="chevron-down" size={14}/>
                </label>
            }
            {many && <span className="kailo-pager-position">{kt('pageOf', page, pages)}</span>}
            {many &&
                <div className="kailo-pager-pages">
                    <button type="button" className="kailo-icon-button" aria-label={kt('prevPage')} title={kt('prevPage')} disabled={page <= 1} onClick={() => go(page - 1)}>
                        <KailoIcon name="chevron-left"/>
                    </button>
                    {items(page, pages).map((n, i) => n === 'gap'
                        ? <span key={'gap' + i} className="kailo-pager-gap" aria-hidden="true">…</span>
                        : <button
                            key={n}
                            type="button"
                            className={'kailo-pager-page' + (n === page ? ' kailo-pager-page-current' : '')}
                            aria-current={n === page ? 'page' : undefined}
                            onClick={() => go(n)}
                        >{n}</button>
                    )}
                    <button type="button" className="kailo-icon-button" aria-label={kt('nextPage')} title={kt('nextPage')} disabled={page >= pages} onClick={() => go(page + 1)}>
                        <KailoIcon name="chevron-right"/>
                    </button>
                </div>
            }
        </div>
    )
}
