/*
 * DD-167 (20 §9, §15.4) list states in Kailo mode.
 *
 *   empty / readonly / forbidden / unconfigured: centered 64 px line
 *     illustration in the brand gradient, Title 2, Body muted, at most one
 *     main action (none for read-only members and for forbidden).
 *   filtered: the small form, "没有符合条件的…" and "清除…".
 *   error: inline block — icon, "未能载入…", reason category, "重试".
 *   skeleton: rows (or cards) shaped like the list, count = page size (≤ 10).
 */
import React from 'react'
import KailoIcon from './KailoIcons'
import {kt, kailoCells} from './useKailo'

let gradientSeq = 0

function Illustration({icon}) {
    const [id] = React.useState(() => 'kailo-illus-' + (++gradientSeq))
    return (
        <span className="kailo-state-illustration" aria-hidden="true">
            <svg width="0" height="0" style={{position: 'absolute'}} focusable="false">
                <defs>
                    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" className="kailo-gradient-start"/>
                        <stop offset="55%" className="kailo-gradient-mid"/>
                        <stop offset="100%" className="kailo-gradient-end"/>
                    </linearGradient>
                </defs>
            </svg>
            <KailoIcon name={icon} size={64} style={{stroke: `url(#${id})`, strokeWidth: 1.25}}/>
        </span>
    )
}

export function KailoEmptyState({icon = 'folder-open', title, body, actionLabel, onAction, small = false, className = ''}) {
    if (small) {
        return (
            <div className={'kailo-state kailo-state-small ' + className} role="status">
                <div className="kailo-state-title">{title}</div>
                {body && <div className="kailo-state-body">{body}</div>}
                {actionLabel && onAction &&
                    <button type="button" className="kailo-button kailo-button-secondary" onClick={onAction}>{actionLabel}</button>
                }
            </div>
        )
    }
    return (
        <div className={'kailo-state ' + className} role="status">
            <Illustration icon={icon}/>
            <div className="kailo-state-title">{title}</div>
            {body && <div className="kailo-state-body">{body}</div>}
            {actionLabel && onAction &&
                <button type="button" className="kailo-button kailo-button-primary" onClick={onAction}>{actionLabel}</button>
            }
        </div>
    )
}

/**
 * Failed read: forbidden (403) is the access state, anything else the
 * inline error with its reason and a retry. No toast, no navigation.
 */
export function KailoLoadError({error, titleKey = 'loadFailed', forbiddenKey = 'forbiddenTitle', forbiddenHint = 'forbiddenOwner', onRetry, className = ''}) {
    const k = kailoCells()
    const kind = k && k.loadErrorKind ? k.loadErrorKind(error) : 'unknown'
    if (kind === 'forbidden') {
        const managed = /KAILO_MANAGED|KAILO_ADMIN_REQUIRED/.test(String((error && (error.code || error.message)) || ''))
        return (
            <KailoEmptyState
                icon="lock"
                className={'kailo-state-forbidden ' + className}
                title={kt(forbiddenKey)}
                body={kt(managed ? 'forbiddenAdmin' : forbiddenHint)}
            />
        )
    }
    return (
        <div className={'kailo-inline-error-block ' + className} role="alert">
            <KailoIcon name="alert-circle" size={20} className="kailo-inline-error-icon"/>
            <div className="kailo-inline-error-text">
                <div className="kailo-inline-error-title">{kt(titleKey)}</div>
                <div className="kailo-inline-error-reason">{k && k.loadErrorReason ? k.loadErrorReason(kind) : ''}</div>
            </div>
            {onRetry &&
                <button type="button" className="kailo-button kailo-button-secondary" onClick={onRetry}>
                    <KailoIcon name="refresh" size={14}/>{kt('retry')}
                </button>
            }
        </div>
    )
}

/** Skeleton rows or cards with the list's shape (count = page size, at most 10). */
export function KailoSkeleton({rows = 10, grid = false, rowHeight = 40}) {
    const n = Math.max(1, Math.min(10, rows))
    const list = []
    for (let i = 0; i < n; i++) {
        list.push(i)
    }
    if (grid) {
        return (
            <div className="kailo-skeleton kailo-skeleton-grid" aria-busy="true" aria-hidden="true">
                {list.map(i => (
                    <div key={i} className="kailo-skeleton-card">
                        <div className="kailo-skeleton-block kailo-skeleton-thumb"/>
                        <div className="kailo-skeleton-block kailo-skeleton-line" style={{width: (60 + (i * 13) % 30) + '%'}}/>
                    </div>
                ))}
            </div>
        )
    }
    return (
        <div className="kailo-skeleton" aria-busy="true" aria-hidden="true">
            {list.map(i => (
                <div key={i} className="kailo-skeleton-row" style={{height: rowHeight}}>
                    <div className="kailo-skeleton-block kailo-skeleton-icon"/>
                    <div className="kailo-skeleton-block kailo-skeleton-line" style={{width: (28 + (i * 17) % 32) + '%'}}/>
                    <span style={{flex: 1}}/>
                    <div className="kailo-skeleton-block kailo-skeleton-line" style={{width: 96}}/>
                    <div className="kailo-skeleton-block kailo-skeleton-line" style={{width: 56}}/>
                </div>
            ))}
        </div>
    )
}
