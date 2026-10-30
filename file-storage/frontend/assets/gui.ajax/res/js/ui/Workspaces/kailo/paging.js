/*
 * DD-167 (20 §15.3): server-side pages of a folder listing in Kailo mode.
 *
 * The native listing asks the meta service for one page (Offset/Limit) and
 * the answer carries the total of the folder (Pagination.Total) whenever the
 * folder holds more than one page; MetaNodeProvider keeps it in the node's
 * "paginationData" (current, total pages, size, count). A folder that fits
 * in one page carries no pagination: its total is the number of children.
 * Page and size live in the node (the Cells node context), so going back to
 * a folder shows the same page; the size is a user layout preference.
 */

export const SIZE_PREF = 'FSTemplate.Kailo.PageSize'

const kailo = () => (typeof window !== 'undefined' && window.KailoCells) || null

export function kailoMode() {
    const k = kailo()
    return !!(k && k.kailoMode && k.kailoMode())
}

// Children shown in the list: the internal ".pydio" entries never come back
// from the service; the recycle bin is a regular entry of the root.
export function childCount(node) {
    if (!node || !node.getChildren) {
        return 0
    }
    return node.getChildren().size
}

/**
 * {total, page, pages, size, known}: total items of the folder (server count
 * when paginated, else the loaded children), the current page and size.
 * known is false when the service could not count (TotalPages -1).
 */
export function nodePaging(node, fallbackSize) {
    const meta = node && node.getMetadata ? node.getMetadata() : null
    const p = meta && meta.get('paginationData')
    if (p && p.get) {
        const size = parseInt(p.get('size')) || fallbackSize || 20
        const current = parseInt(p.get('current')) || 1
        const totalPages = parseInt(p.get('total'))
        const count = parseInt(p.get('count'))
        if (count >= 0 && !isNaN(count)) {
            const pages = Math.max(1, Math.ceil(count / size))
            return {total: count, page: Math.min(current, pages), pages, size, known: true}
        }
        // An older answer without a count: pages only.
        const pages = totalPages > 0 ? totalPages : current
        return {total: -1, page: current, pages, size, known: totalPages > 0}
    }
    const total = childCount(node)
    const size = fallbackSize || 20
    return {total, page: 1, pages: 1, size, known: true}
}

/** Load page n of the folder (keeps the rows on screen until it arrived). */
export function requestPage(dataModel, node, page) {
    const meta = node.getMetadata()
    const p = meta.get('paginationData')
    if (!p) {
        return
    }
    p.set('new_page', page)
    dataModel.requireContextChange(node)
}

/** Use another page size: back to page 1 of the same folder, then reload. */
export function requestPageSize(dataModel, node, size) {
    const meta = node.getMetadata()
    let p = meta.get('paginationData')
    if (!p) {
        p = new Map()
        meta.set('paginationData', p)
    }
    p.set('size', size)
    p.set('current', 1)
    p.delete('new_page')
    dataModel.requireContextChange(node, true)
}

export function storedPageSize(pydio, view) {
    const k = kailo()
    const stored = pydio && pydio.user ? pydio.user.getLayoutPreference(SIZE_PREF, 0) : 0
    if (k && k.normalizePageSize) {
        return k.normalizePageSize(stored || 0, view)
    }
    return view === 'grid' ? 24 : 20
}

export function storePageSize(pydio, size) {
    if (pydio && pydio.user) {
        pydio.user.setLayoutPreference(SIZE_PREF, size)
    }
}

/** Grid or list for the pager sizes of a display mode. */
export function viewOf(displayMode) {
    return String(displayMode || '').indexOf('grid') === 0 ? 'grid' : 'list'
}
