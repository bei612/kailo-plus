/*
 * DD-167 (20 §15.1, §15.3): the columns of a Kailo-mode file list.
 *
 * Files: name (type icon + name, Body/500), modified (relative time, the
 * absolute time on hover, Callout muted), size (right aligned, tabular
 * digits; folders "—"). Search results: name, location, modified.
 * The service sorts by name, size and modification time (remote sort when
 * the folder spans pages); folders come first in a name sort.
 */
import React from 'react'
import Pydio from 'pydio'
import PathUtils from 'pydio/util/path'
import {kt} from './useKailo'

const {moment} = Pydio.requireLib('boot')

export function relativeTime(seconds) {
    const value = parseFloat(seconds)
    if (!value) {
        return {text: '—', title: ''}
    }
    const m = moment(value * 1000)
    let text = m.calendar()
    if (text.indexOf('/') > -1) {
        text = m.fromNow()
    }
    return {text, title: PathUtils.formatModifDate(m.toDate())}
}

export function sizeText(node) {
    if (!node.isLeaf()) {
        return '—'
    }
    const bytes = parseInt(node.getMetadata().get('bytesize'))
    return bytes >= 0 && !isNaN(bytes) ? PathUtils.roundFileSize(bytes) : '—'
}

export function locationText(node, pydio) {
    const meta = node.getMetadata()
    let where = PathUtils.getDirname(node.getPath())
    if (where && where.charAt(0) === '/') {
        where = where.substr(1)
    }
    let repo = meta.get('repository_display') || ''
    if (repo === '{{RefLabel}}' && pydio) {
        repo = pydio.getContextHolder().getRootNode().getLabel()
    }
    if (repo && pydio && window.KailoCells && window.KailoCells.locationLabel) {
        const ws = pydio.user && meta.get('repository_id') ? pydio.user.getRepositoriesList().get(meta.get('repository_id')) : null
        const label = ws && ws.getSlug ? window.KailoCells.locationLabel(ws.getSlug()) : ''
        if (label) {
            repo = label
        }
    }
    return [repo, where].filter(Boolean).join(' › ') || '/'
}

/**
 * @param renderName (node) => element: icon + label of the entry
 * @param searchResults boolean
 * @param pydio Pydio
 */
export function kailoColumns(renderName, searchResults, pydio) {
    const name = {
        label: kt('colName'),
        name: 'ajxp_label',
        sortType: 'string',
        remoteSortAttribute: 'name',
        renderCell: (node) => renderName(node),
    }
    const modified = {
        label: kt('colModified'),
        name: 'ajxp_modiftime',
        sortType: 'number',
        remoteSortAttribute: 'mtime',
        renderCell: (node) => {
            const t = relativeTime(node.getMetadata().get('ajxp_modiftime'))
            return <span className="kailo-cell-muted" title={t.title}>{t.text}</span>
        },
    }
    if (searchResults) {
        return {
            ajxp_label: name,
            ajxp_dirname: {
                label: kt('colLocation'),
                name: 'ajxp_dirname',
                renderCell: (node) => {
                    const where = locationText(node, pydio)
                    return <span className="kailo-cell-muted" title={where}>{where}</span>
                },
            },
            ajxp_modiftime: modified,
        }
    }
    return {
        ajxp_label: name,
        ajxp_modiftime: modified,
        bytesize: {
            label: kt('colSize'),
            name: 'bytesize',
            sortType: 'number',
            sortAttribute: 'bytesize',
            remoteSortAttribute: 'size',
            renderCell: (node) => <span className="kailo-cell-muted kailo-cell-number">{sizeText(node)}</span>,
        },
    }
}
