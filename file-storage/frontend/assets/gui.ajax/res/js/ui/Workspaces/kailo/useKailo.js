/*
 * DD-167 (07 §4.8.10, 20 §15.2): Kailo-mode components re-render in place
 * when Kailo's language, theme, text size, zoom or list density changes;
 * nothing reloads and no route or input is reset.
 */
import {useEffect, useState} from 'react'

export const kailoCells = () => (typeof window !== 'undefined' && window.KailoCells) || null

export function kailoMode() {
    const k = kailoCells()
    return !!(k && k.kailoMode && k.kailoMode())
}

// Kailo wording for a key (kailo-cells.js TEXT), or the key itself.
export function kt(key, a, b) {
    const k = kailoCells()
    return k && k.text ? k.text(key, a, b) : key
}

export function useKailo() {
    const [, setTick] = useState(0)
    useEffect(() => {
        const k = kailoCells()
        if (!k) {
            return undefined
        }
        const bump = () => setTick(t => t + 1)
        const stops = []
        if (k.subscribe) {
            stops.push(k.subscribe(bump))
        }
        if (k.onListDensity) {
            stops.push(k.onListDensity(bump))
        }
        if (k.onTypeChange) {
            stops.push(k.onTypeChange(bump))
        }
        return () => stops.forEach(stop => typeof stop === 'function' && stop())
    }, [])
    const k = kailoCells()
    return {
        t: kt,
        density: k && k.listDensity ? k.listDensity() : 'comfortable',
        rowHeight: k && k.rowHeight ? k.rowHeight() : 40,
        locale: k && k.presentation ? k.presentation().locale : '',
    }
}
