/*
 * DD-167 (20 §15.1) 主页 in Kailo mode: on top the location cards
 * (个人文件, 公共文件, 共享空间 — name and item count), below "最近使用":
 * the files most recently modified in every location the user can read,
 * served page by page by the search service (total, pages, page size).
 * The main action "上传" is Kailo's header action of 所有文件.
 */
import React, {useCallback, useEffect, useState} from 'react'
import Pydio from 'pydio'
import PydioApi from 'pydio/http/api'
import SearchApi from 'pydio/http/search-api'
import {MetaServiceApi, RestGetBulkMetaRequest} from 'cells-sdk'
import FilePreview from '../views/FilePreview'
import KailoPager from './KailoPager'
import KailoIcon from './KailoIcons'
import {KailoEmptyState, KailoLoadError, KailoSkeleton} from './KailoStateView'
import {kt, kailoCells, useKailo} from './useKailo'
import {relativeTime, sizeText, locationText} from './columns'
import {storedPageSize, storePageSize} from './paging'

// The workspaces behind the three location cards.
export function homeLocations(pydio) {
    const out = {personal: null, common: null, cells: []}
    if (!pydio || !pydio.user) {
        return out
    }
    pydio.user.getRepositoriesList().forEach(r => {
        if (r.accessType !== 'gateway') {
            return
        }
        if (r.getOwner && r.getOwner()) {
            out.cells.push(r)
        } else if (r.getRepositoryType && r.getRepositoryType() === 'workspace-personal') {
            out.personal = out.personal || r
        } else if (r.getSlug && r.getSlug() === 'common-files') {
            out.common = out.common || r
        } else if (!out.common) {
            out.common = r
        }
    })
    return out
}

// Items directly in a location: the folder count the meta service reports
// (one-item page: Pagination.Total, or the single loaded page).
function countItems(repo) {
    const api = new MetaServiceApi(PydioApi.getRestClient({silent: true}))
    const request = new RestGetBulkMetaRequest()
    const slug = repo.getSlug()
    request.NodePaths = [slug + '/', slug + '/*']
    request.Limit = 1
    return api.getBulkMeta(request).then(res => {
        if (res.Pagination && res.Pagination.Total >= 0) {
            return res.Pagination.Total
        }
        const nodes = (res.Nodes || []).filter(n => String(n.Path || '').replace(/\/$/, '') !== slug)
        return nodes.filter(n => !/\/\.pydio$/.test(n.Path || '')).length
    })
}

function LocationCard({icon, title, count, onOpen, disabled}) {
    return (
        <button type="button" className="kailo-card kailo-location-card" onClick={onOpen} disabled={disabled}>
            <span className="kailo-location-icon" aria-hidden="true"><KailoIcon name={icon} size={18}/></span>
            <span className="kailo-location-text">
                <span className="kailo-location-title">{title}</span>
                <span className="kailo-location-count">{count === null ? ' ' : count}</span>
            </span>
            <KailoIcon name="chevron-right" size={16} className="kailo-location-chevron"/>
        </button>
    )
}

export default function KailoHome({pydio}) {
    const {rowHeight} = useKailo()
    const k = kailoCells()
    const locations = homeLocations(pydio)
    const [counts, setCounts] = useState({personal: null, common: null})
    const [recent, setRecent] = useState({loading: true, nodes: [], total: 0, error: null})
    const [page, setPage] = useState(1)
    const [size, setSize] = useState(() => storedPageSize(pydio, 'list'))

    useEffect(() => {
        ;['personal', 'common'].forEach(id => {
            const repo = locations[id]
            if (!repo) {
                return
            }
            countItems(repo).then(n => setCounts(c => ({...c, [id]: n}))).catch(() => setCounts(c => ({...c, [id]: -1})))
        })
    }, [])

    const load = useCallback(() => {
        setRecent(r => ({...r, loading: true, error: null}))
        const api = new SearchApi(Pydio.getInstance())
        // Files only, newest first, one page (20 §15.3: server pages).
        api.search({ajxp_mime: 'ajxp_file'}, 'all', size, false, 'mtime', true, (page - 1) * size).then(response => {
            const nodes = (response.Results || []).filter(n => n && n.getPath && n.getPath().indexOf('/recycle_bin') !== 0)
            setRecent({loading: false, nodes, total: response.Total || nodes.length, error: null})
        }).catch(error => setRecent({loading: false, nodes: [], total: 0, error: error || {}}))
    }, [page, size])
    useEffect(() => { load() }, [load])

    const openRepo = (repo) => {
        if (!repo) {
            return
        }
        if (k && k.setListPane) {
            k.setListPane('files')
        }
        pydio.triggerRepositoryChange(repo.getId())
    }
    const openNode = (node) => {
        if (k && k.setListPane) {
            k.setListPane('files')
        }
        pydio.goTo(node)
    }
    const itemCount = (n) => (n === null ? null : n < 0 ? '' : kt('items', n))
    const p = k && k.paging ? k.paging(recent.total, page, size) : {total: recent.total, page, pages: 1, size}

    let body
    if (recent.loading && !recent.nodes.length) {
        body = <KailoSkeleton rows={Math.min(10, size)} rowHeight={rowHeight}/>
    } else if (recent.error) {
        body = <KailoLoadError error={recent.error} titleKey="loadFailedRecent" onRetry={load}/>
    } else if (!recent.nodes.length) {
        body = <KailoEmptyState icon="clock" title={kt('emptyRecent')} body={kt('emptyRecentBody')}/>
    } else {
        body = (
            <div className="kailo-table" role="table">
                <div className="kailo-table-head" role="row">
                    <span className="kailo-th kailo-col-name" role="columnheader">{kt('colName')}</span>
                    <span className="kailo-th kailo-col-location" role="columnheader">{kt('colLocation')}</span>
                    <span className="kailo-th kailo-col-modified" role="columnheader">{kt('colModified')}</span>
                    <span className="kailo-th kailo-col-size" role="columnheader">{kt('colSize')}</span>
                </div>
                {recent.nodes.map((node, i) => {
                    const t = relativeTime(node.getMetadata().get('ajxp_modiftime'))
                    const where = locationText(node, pydio)
                    return (
                        <div key={i + node.getPath()} className="kailo-tr" role="row" tabIndex={0} style={{height: rowHeight}}
                            onDoubleClick={() => openNode(node)} onKeyDown={(e) => { if (e.key === 'Enter') { openNode(node) } }}>
                            <span className="kailo-td kailo-col-name" role="cell">
                                <FilePreview pydio={pydio} node={node} loadThumbnail={false} rounded={true} style={{backgroundColor: 'transparent'}}/>
                                <button type="button" className="kailo-link" onClick={() => openNode(node)} title={node.getLabel()}>{node.getLabel()}</button>
                            </span>
                            <span className="kailo-td kailo-col-location kailo-cell-muted" role="cell" title={where}>{where}</span>
                            <span className="kailo-td kailo-col-modified kailo-cell-muted" role="cell" title={t.title}>{t.text}</span>
                            <span className="kailo-td kailo-col-size kailo-cell-muted kailo-cell-number" role="cell">{sizeText(node)}</span>
                        </div>
                    )
                })}
            </div>
        )
    }

    return (
        <div className="kailo-home">
            <div className="kailo-home-scroll">
                <section className="kailo-section">
                    <h2 className="kailo-section-title">{kt('locations')}</h2>
                    <div className="kailo-location-grid">
                        <LocationCard icon="user" title={kt('personal')} count={locations.personal ? itemCount(counts.personal) : ''}
                            disabled={!locations.personal} onOpen={() => openRepo(locations.personal)}/>
                        <LocationCard icon="building" title={kt('common')} count={locations.common ? itemCount(counts.common) : ''}
                            disabled={!locations.common} onOpen={() => openRepo(locations.common)}/>
                        <LocationCard icon="users" title={kt('cells')} count={kt('spaces', locations.cells.length)}
                            disabled={!locations.cells.length} onOpen={() => openRepo(locations.cells[0])}/>
                    </div>
                </section>
                <section className="kailo-section kailo-section-fill">
                    <h2 className="kailo-section-title">{kt('recent')}</h2>
                    <div className={'kailo-panel' + (recent.loading && recent.nodes.length ? ' kailo-list-busy' : '')}>
                        {body}
                        {!recent.error && recent.total > 0 &&
                            <div className="kailo-files-footer">
                                <KailoPager
                                    total={p.total} page={p.page} pages={p.pages} size={p.size}
                                    sizes={k && k.pageSizes ? k.pageSizes('list') : [20, 50, 100]}
                                    loading={recent.loading}
                                    onPage={setPage}
                                    onSize={(s) => { storePageSize(pydio, s); setSize(s); setPage(1) }}
                                />
                            </div>
                        }
                    </div>
                </section>
            </div>
        </div>
    )
}
