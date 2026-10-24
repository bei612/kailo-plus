/*
 * Kailo design tokens → native Material 3 system colors (07 §4.7.1, DD-133).
 *
 * The Kailo tokens (client-kit/embed/kailo-theme-tokens.css, light on :root,
 * dark under [data-kailo-theme="dark"]) give every color as a bare
 * "H S% L%" triplet in --kailo-hsl-<name>. Every --md-sys-color-* value the native styles and Material-UI
 * themes consume is derived here from those tokens, so no page hard-codes a
 * color and a Kailo theme change re-themes the whole native page.
 */
import Color from 'color'

const HSL_TRIPLET = /^(-?[\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*([\d.]+%?))?$/

// Fallback when the sheet carries no --kailo-font-sans (never in a release).
export const KAILO_FONT_FAMILY = '"Inter Variable", Inter, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei UI", system-ui, sans-serif'

// Token names (without the --kailo-hsl- prefix); the sidebar ones are optional.
export const KAILO_COLOR_NAMES = [
    'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
    'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
    'accent', 'accent-foreground', 'destructive', 'destructive-foreground', 'border', 'input', 'ring',
    'sidebar-background', 'sidebar-foreground',
]

/**
 * Parse one token value into a Color: an HSL triplet, or any CSS color.
 * @param value string
 * @return Color|null
 */
export function tokenColor(value) {
    const v = String(value || '').trim()
    if (!v) {
        return null
    }
    const m = HSL_TRIPLET.exec(v)
    try {
        if (m) {
            const color = Color.hsl(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]))
            if (m[4] !== undefined) {
                const alpha = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
                return color.alpha(alpha)
            }
            return color
        }
        return Color(v)
    } catch (e) {
        return null
    }
}

/**
 * --radius in px (rem resolved at 16px, the Kailo root size).
 */
export function tokenRadius(value) {
    const v = String(value || '').trim()
    const m = /^([\d.]+)(rem|px)?$/.exec(v)
    if (!m) {
        return 10
    }
    const n = parseFloat(m[1])
    return Math.round(m[2] === 'px' ? n : n * 16)
}

/**
 * Read the Kailo tokens currently applied to the document.
 * @param element HTMLElement
 * @return {Object<string,string>}
 */
export function readKailoTokens(element = document.documentElement) {
    const style = window.getComputedStyle(element)
    const read = (name) => ((element.style && element.style.getPropertyValue(name)) || style.getPropertyValue(name) || '').trim()
    const out = {}
    KAILO_COLOR_NAMES.forEach((name) => {
        const v = read('--kailo-hsl-' + name)
        if (v) {
            out['--' + name] = v
        }
    })
    const radius = read('--kailo-radius')
    if (radius) {
        out['--radius'] = radius
    }
    const font = read('--kailo-font-sans')
    if (font) {
        out['--font-sans'] = font
    }
    // DD-141 roles (complete colors) when the sheet carries them.
    ;['selected', 'selected-foreground', 'brand-hover', 'success', 'warning-text', 'info', 'hover'].forEach((name) => {
        const v = read('--kailo-color-' + name)
        if (v) {
            out['--' + name] = v
        }
    })
    return out
}

/**
 * Whether the Kailo presentation is active: bridge loaded and tokens present.
 */
export function kailoThemeActive(tokens) {
    return !!(typeof window !== 'undefined' && window.KailoCells && tokenColor((tokens || {})['--background']) && tokenColor((tokens || {})['--primary']))
}

const css = (c) => (c.alpha() < 1 ? c.rgb().string() : c.hex().toLowerCase())

/**
 * Material 3 system colors (the native mui3 keys) from the Kailo tokens.
 * @param tokens {Object<string,string>}
 * @param dark boolean
 * @return {{colors: Object<string,string>, radius: number, fontFamily: string}}
 */
export function kailoScheme(tokens, dark) {
    const t = (name, fallback) => tokenColor(tokens[name]) || (fallback ? tokenColor(tokens[fallback]) : null)
    const background = t('--background')
    const foreground = t('--foreground')
    const primary = t('--primary')
    if (!background || !foreground || !primary) {
        throw new Error('Kailo tokens are incomplete')
    }
    const card = t('--card', '--background')
    const cardForeground = t('--card-foreground', '--foreground')
    const popover = t('--popover', '--card')
    const muted = t('--muted', '--card')
    const mutedForeground = t('--muted-foreground', '--foreground')
    const accent = t('--accent', '--muted')
    const accentForeground = t('--accent-foreground', '--foreground')
    const destructive = t('--destructive') || Color('#d32f2f')
    const destructiveForeground = t('--destructive-foreground', '--background')
    const border = t('--border', '--muted')
    const input = t('--input', '--border')
    const sidebar = t('--sidebar-background', '--muted') || muted
    const primaryForeground = t('--primary-foreground', '--background')
    // DD-141: the Kailo selected role (brand-soft) when present, else a tint.
    const primaryContainer = t('--selected') || background.mix(primary, dark ? 0.24 : 0.14)
    const onPrimaryContainer = t('--selected-foreground') || foreground
    const errorContainer = background.mix(destructive, dark ? 0.24 : 0.14)
    // DD-157 (20 §13.6): selected rows/entries use the Kailo selected role
    // (brand-soft), hover the Kailo hover role.
    const selected = t('--selected')
    const selectedForeground = t('--selected-foreground')
    const hover = t('--hover')

    const colors = {
        'primary': css(primary),
        'on-primary': css(primaryForeground),
        'primary-container': css(primaryContainer),
        'on-primary-container': css(onPrimaryContainer),
        'secondary': css(mutedForeground),
        'on-secondary': css(background),
        'secondary-container': css(selected || accent),
        'on-secondary-container': css(selected && selectedForeground ? selectedForeground : accentForeground),
        'tertiary': css(primary),
        'on-tertiary': css(primaryForeground),
        'tertiary-container': css(primaryContainer),
        'on-tertiary-container': css(onPrimaryContainer),
        'error': css(destructive),
        'on-error': css(destructiveForeground),
        'error-container': css(errorContainer),
        'on-error-container': css(destructive),
        'background': css(background),
        'on-background': css(foreground),
        'surface': css(card),
        'on-surface': css(cardForeground),
        'surface-variant': css(background),
        'on-surface-variant': css(mutedForeground),
        'outline': css(input),
        'outline-variant': css(border),
        'shadow': '#000000',
        'scrim': '#000000',
        'inverse-surface': css(foreground),
        'inverse-on-surface': css(background),
        'inverse-primary': css(primary),
        'surface-1': css(card),
        'surface-2': css(popover),
        'surface-3': css(sidebar),
        'surface-4': css(popover),
        'surface-5': css(accent),
        'outline-variant-50': css(border.fade(dark ? 0.2 : 0.5)),
        'field-underline-idle': css(input),
        'inline-tags-border': css(border),
        'mimefont-background': css(accent.fade(0.4)),
        'mimefont-color': css(accentForeground),
        'hover-background': hover ? css(hover) : dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)',
    }
    const radius = tokenRadius(tokens['--radius'])
    colors['paper-border-radius'] = Math.round(radius * 1.2) + 'px'
    colors['card-border-radius'] = radius + 'px'
    colors['fstemplate-master-margin'] = '8px'
    return {colors, radius, fontFamily: tokens['--font-sans'] || KAILO_FONT_FAMILY}
}
