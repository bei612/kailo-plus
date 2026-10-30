/*
 * DD-167 (20 §15.3, §15.4): the pagination bar under the Kailo-mode files
 * list, bound to the current folder (or to the search results).
 *
 * Folder: total from the service ("共 N 条"), page and size kept in the
 * folder node (Cells node context: back/forward show the same page) and the
 * size in the user's layout preference. While a page loads the old rows stay
 * (dimmed by the parent through onBusy) under a 2 px progress line; after
 * 10 s "仍在载入…" appears.
 */
import React, {useEffect, useState} from 'react'
import KailoPager from './KailoPager'
import {kt, kailoCells, useKailo} from './useKailo'
import {nodePaging, requestPage, requestPageSize, storePageSize, storedPageSize, viewOf} from './paging'

function useNodeState(dataModel) {
    const [node, setNode] = useState(() => dataModel.getContextNode())
    const [busy, setBusy] = useState(false)
    const [, setTick] = useState(0)
    useEffect(() => {
        const onContext = () => setNode(dataModel.getContextNode())
        const onLoading = () => setBusy(true)
        const onLoaded = () => { setBusy(false); setTick(t => t + 1) }
        dataModel.observe('context_changed', onContext)
        dataModel.observe('context_loading', onLoading)
        dataModel.observe('context_loaded', onLoaded)
        return () => {
            dataModel.stopObserving('context_changed', onContext)
            dataModel.stopObserving('context_loading', onLoading)
            dataModel.stopObserving('context_loaded', onLoaded)
        }
    }, [dataModel])
    useEffect(() => {
        if (!node || !node.observe) {
            return undefined
        }
        const onLoading = () => setBusy(true)
        const onLoaded = () => { setBusy(false); setTick(t => t + 1) }
        const onChildren = () => setTick(t => t + 1)
        node.observe('loading', onLoading)
        node.observe('loaded', onLoaded)
        node.observe('child_added', onChildren)
        node.observe('child_removed', onChildren)
        return () => {
            node.stopObserving('loading', onLoading)
            node.stopObserving('loaded', onLoaded)
            node.stopObserving('child_added', onChildren)
            node.stopObserving('child_removed', onChildren)
        }
    }, [node])
    return {node, busy}
}

function useSlow(busy) {
    const [slow, setSlow] = useState(false)
    useEffect(() => {
        if (!busy) {
            setSlow(false)
            return undefined
        }
        const t = setTimeout(() => setSlow(true), 10000)
        return () => clearTimeout(t)
    }, [busy])
    return slow
}

export default function KailoFilesFooter({pydio, dataModel, displayMode, searchView, searchTools, onBusy}) {
    useKailo()
    const view = viewOf(displayMode)
    const k = kailoCells()
    const sizes = k && k.pageSizes ? k.pageSizes(view) : (view === 'grid' ? [24, 48, 96] : [20, 50, 100])
    const {node, busy: nodeBusy} = useNodeState(dataModel)
    const busy = searchView ? !!(searchTools && searchTools.searchLoading) : nodeBusy
    const slow = useSlow(busy)
    useEffect(() => { onBusy && onBusy(busy) }, [busy])

    let pager
    if (searchView && searchTools) {
        const {resultsCount = 0, page = 1, pageSize = sizes[0], empty} = searchTools
        if (empty) {
            return null
        }
        const p = k && k.paging ? k.paging(resultsCount, page, pageSize) : {total: resultsCount, page, pages: 1, size: pageSize}
        pager = (
            <KailoPager
                total={p.total} page={p.page} pages={p.pages} size={p.size} sizes={k && k.pageSizes ? k.pageSizes('list') : sizes}
                loading={busy}
                onPage={(n) => searchTools.setPage(n)}
                onSize={(s) => { storePageSize(pydio, s); searchTools.setPageSize(s) }}
            />
        )
    } else {
        if (!node || !node.isLoaded || (!node.isLoaded() && !busy)) {
            return null
        }
        if (node.getLoadError && node.getLoadError()) {
            return null
        }
        const size = storedPageSize(pydio, view)
        const p = nodePaging(node, size)
        pager = (
            <KailoPager
                total={p.total} page={p.page} pages={p.pages} size={p.size} sizes={sizes}
                loading={busy}
                onPage={(n) => requestPage(dataModel, node, n)}
                onSize={(s) => { storePageSize(pydio, s); requestPageSize(dataModel, node, s) }}
            />
        )
    }
    return (
        <div className="kailo-files-footer">
            {slow && <div className="kailo-still-loading" role="status">{kt('stillLoading')}</div>}
            {pager}
        </div>
    )
}
