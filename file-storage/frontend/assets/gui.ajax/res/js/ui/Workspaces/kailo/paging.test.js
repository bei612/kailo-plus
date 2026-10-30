import {describe, expect, it, vi} from 'vitest'
import {nodePaging, requestPage, requestPageSize, viewOf} from './paging'

function node({pagination, children = 0} = {}) {
    const meta = new Map()
    if (pagination) {
        meta.set('paginationData', new Map(Object.entries(pagination)))
    }
    const kids = new Map()
    for (let i = 0; i < children; i++) {
        kids.set('/f' + i, {})
    }
    return {getMetadata: () => meta, getChildren: () => kids}
}

describe('DD-167 folder pages (20 §15.3)', () => {
    it('counts a folder that fits one page from its children', () => {
        expect(nodePaging(node({children: 7}), 20)).toEqual({total: 7, page: 1, pages: 1, size: 20, known: true})
        expect(nodePaging(node({children: 0}), 50)).toEqual({total: 0, page: 1, pages: 1, size: 50, known: true})
    })

    it('uses the service total of a paginated folder', () => {
        const n = node({pagination: {current: 2, total: 3, size: 20, count: 45}, children: 20})
        expect(nodePaging(n, 20)).toEqual({total: 45, page: 2, pages: 3, size: 20, known: true})
    })

    it('keeps pages without a count from an older answer', () => {
        const n = node({pagination: {current: 2, total: -1, size: 20}, children: 20})
        expect(nodePaging(n, 20)).toMatchObject({total: -1, page: 2, known: false})
    })

    it('asks the data model for another page or size', () => {
        const dm = {requireContextChange: vi.fn()}
        const n = node({pagination: {current: 1, total: 3, size: 20, count: 45}})
        requestPage(dm, n, 3)
        expect(n.getMetadata().get('paginationData').get('new_page')).toBe(3)
        expect(dm.requireContextChange).toHaveBeenLastCalledWith(n)
        const single = node({children: 30})
        requestPageSize(dm, single, 20)
        const p = single.getMetadata().get('paginationData')
        expect(p.get('size')).toBe(20)
        expect(p.get('current')).toBe(1)
        expect(dm.requireContextChange).toHaveBeenLastCalledWith(single, true)
    })

    it('maps display modes to the pager sizes', () => {
        expect(viewOf('grid-160')).toBe('grid')
        expect(viewOf('detail')).toBe('list')
    })
})
