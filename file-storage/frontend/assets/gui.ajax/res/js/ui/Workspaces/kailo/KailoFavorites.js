/*
 * DD-167 (20 §15.1) 收藏: the user's favorite files and folders as a list
 * with the "所有文件" list grammar (name with type icon, location, modified;
 * 40/32 px rows; pagination bar). The favorites come in one answer from the
 * user-meta service (a bounded, user-curated set), so they are counted and
 * paged here. Opening an entry goes to it under 所有文件.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react'
import PydioApi from 'pydio/http/api'
import MetaNodeProvider from 'pydio/model/meta-node-provider'
import {UserMetaServiceApi, RestUserBookmarksRequest, UpdateUserMetaRequestUserMetaOp, IdmUpdateUserMetaRequest, IdmSearchUserMetaRequest} from 'cells-sdk'
import FilePreview from '../views/FilePreview'
import KailoPager from './KailoPager'
import KailoIcon from './KailoIcons'
import {KailoEmptyState, KailoLoadError, KailoSkeleton} from './KailoStateView'
import {kt, kailoCells, useKailo} from './useKailo'
import {relativeTime} from './columns'
import {storedPageSize, storePageSize} from './paging'

export function favoriteNodes(collection) {
    const out = []
    ;(collection || []).forEach(bm => {
        const where = (bm.AppearsIn || [])[0]
        if (!where) {
            return
        }
        const copy = {...bm, Path: where.WsSlug + '/' + where.Path}
        const node = MetaNodeProvider.parseTreeNode(copy, where.WsSlug)
        node.getMetadata().set('repository_id', where.WsUuid)
        node.getMetadata().set('WsLabel', where.WsLabel)
        node.getMetadata().set('WsSlug', where.WsSlug)
        out.push(node)
    })
    // Folders first, then by name (20 §15.3).
    out.sort((a, b) => (a.isLeaf() === b.isLeaf() ? a.getLabel().localeCompare(b.getLabel(), undefined, {numeric: true}) : a.isLeaf() ? 1 : -1))
    return out
}

export default function KailoFavorites({pydio}) {
    const {rowHeight} = useKailo()
    const k = kailoCells()
    const [state, setState] = useState({loading: true, nodes: [], error: null})
    const [page, setPage] = useState(1)
    const [size, setSize] = useState(() => storedPageSize(pydio, 'list'))

    const load = useCallback(() => {
        setState(s => ({...s, loading: true, error: null}))
        const api = new UserMetaServiceApi(PydioApi.getRestClient({silent: true}))
        api.userBookmarks(new RestUserBookmarksRequest()).then(collection => {
            setState({loading: false, nodes: favoriteNodes(collection.Nodes || []), error: null})
        }).catch(error => {
            setState({loading: false, nodes: [], error: error || {}})
        })
    }, [])
    useEffect(() => { load() }, [load])

    const p = k && k.paging ? k.paging(state.nodes.length, page, size) : {total: state.nodes.length, page: 1, pages: 1, size}
    const rows = useMemo(() => state.nodes.slice((p.page - 1) * p.size, p.page * p.size), [state.nodes, p.page, p.size])

    const open = (node) => {
        if (k && k.setListPane) {
            k.setListPane('files')
        }
        pydio.goTo(node)
    }
    const remove = (node) => {
        const api = new UserMetaServiceApi(PydioApi.getRestClient())
        const search = new IdmSearchUserMetaRequest()
        search.NodeUuids = [node.getMetadata().get('uuid')]
        search.Namespace = 'bookmark'
        api.searchUserMeta(search).then(res => {
            if (res.Metadatas && res.Metadatas.length) {
                const request = new IdmUpdateUserMetaRequest()
                request.Operation = UpdateUserMetaRequestUserMetaOp.constructFromObject('DELETE')
                request.MetaDatas = res.Metadatas
                return api.updateUserMeta(request).then(() => load())
            }
            return null
        })
    }

    let body
    if (state.loading && !state.nodes.length) {
        body = <KailoSkeleton rows={Math.min(10, size)} rowHeight={rowHeight}/>
    } else if (state.error) {
        body = <KailoLoadError error={state.error} titleKey="loadFailedFavorites" onRetry={load}/>
    } else if (!state.nodes.length) {
        body = <KailoEmptyState icon="star" title={kt('emptyFavorites')} body={kt('emptyFavoritesBody')}/>
    } else {
        body = (
            <div className="kailo-table" role="table">
                <div className="kailo-table-head" role="row">
                    <span className="kailo-th kailo-col-name" role="columnheader">{kt('colName')}</span>
                    <span className="kailo-th kailo-col-location" role="columnheader">{kt('colLocation')}</span>
                    <span className="kailo-th kailo-col-modified" role="columnheader">{kt('colModified')}</span>
                    <span className="kailo-th kailo-col-actions" role="columnheader"/>
                </div>
                {rows.map(node => {
                    const t = relativeTime(node.getMetadata().get('ajxp_modiftime'))
                    const where = (k && k.locationLabel && k.locationLabel(node.getMetadata().get('WsSlug'))) || node.getMetadata().get('WsLabel')
                    const dir = node.getPath().split('/').filter(Boolean).slice(0, -1).join(' › ')
                    return (
                        <div key={node.getMetadata().get('repository_id') + node.getPath()} className="kailo-tr" role="row" tabIndex={0} style={{height: rowHeight}}
                            onDoubleClick={() => open(node)} onKeyDown={(e) => { if (e.key === 'Enter') { open(node) } }}>
                            <span className="kailo-td kailo-col-name" role="cell">
                                <FilePreview pydio={pydio} node={node} loadThumbnail={false} rounded={true} style={{backgroundColor: 'transparent'}}/>
                                <button type="button" className="kailo-link" onClick={() => open(node)} title={node.getLabel()}>{node.getLabel()}</button>
                            </span>
                            <span className="kailo-td kailo-col-location kailo-cell-muted" role="cell" title={[where, dir].filter(Boolean).join(' › ')}>{[where, dir].filter(Boolean).join(' › ')}</span>
                            <span className="kailo-td kailo-col-modified kailo-cell-muted" role="cell" title={t.title}>{t.text}</span>
                            <span className="kailo-td kailo-col-actions" role="cell">
                                <button type="button" className="kailo-icon-button kailo-row-action" aria-label={kt('unfavorite')} title={kt('unfavorite')} onClick={() => remove(node)}>
                                    <KailoIcon name="star" size={16}/>
                                </button>
                            </span>
                        </div>
                    )
                })}
            </div>
        )
    }
    return (
        <div className="kailo-files-page kailo-favorites">
            <div className={'kailo-files-body'}>
                <div className={'kailo-list-column' + (state.loading && state.nodes.length ? ' kailo-list-busy' : '')}>
                    <div className="kailo-scroll">{body}</div>
                    {!state.error && state.nodes.length > 0 &&
                        <div className="kailo-files-footer">
                            <KailoPager
                                total={p.total} page={p.page} pages={p.pages} size={p.size}
                                sizes={k && k.pageSizes ? k.pageSizes('list') : [20, 50, 100]}
                                loading={state.loading}
                                onPage={setPage}
                                onSize={(s) => { storePageSize(pydio, s); setSize(s); setPage(1) }}
                            />
                        </div>
                    }
                </div>
            </div>
        </div>
    )
}
