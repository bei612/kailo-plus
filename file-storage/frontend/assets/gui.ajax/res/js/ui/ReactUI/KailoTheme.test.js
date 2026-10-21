import { describe, it, expect, afterEach } from 'vitest'
import Color from 'color'
import { tokenColor, tokenRadius, kailoScheme, kailoThemeActive, readKailoTokens } from './KailoTheme'

// client-kit theme.css static values (Catppuccin Latte / Macchiato).
const LIGHT = {
    '--radius': '0.625rem', '--background': '220 23.08% 94.9%', '--foreground': '234 16.02% 35.49%',
    '--card': '220 23.08% 94.9%', '--card-foreground': '234 16.02% 35.49%', '--popover': '220 23.08% 94.9%',
    '--primary': '266 85.05% 58.04%', '--primary-foreground': '220 23.08% 94.9%', '--muted': '223 15.91% 82.75%',
    '--muted-foreground': '233 12.8% 41.37%', '--accent': '223 15.91% 82.75%', '--accent-foreground': '234 16.02% 35.49%',
    '--destructive': '347 86.67% 44.12%', '--destructive-foreground': '220 23.08% 94.9%', '--border': '225 13.56% 76.86%',
    '--input': '225 13.56% 76.86%', '--sidebar-background': '218 25.1% 93.73%',
}
const DARK = { ...LIGHT, '--background': '232 23.4% 18.43%', '--foreground': '227 68.25% 87.65%', '--card': '232 23.4% 18.43%',
    '--card-foreground': '227 68.25% 87.65%', '--primary': '267 82.69% 79.61%', '--primary-foreground': '232 23.4% 18.43%' }

const hsl = (v) => Color.hsl(...v.replace(/%/g, '').split(' ').map(parseFloat)).hex().toLowerCase()

describe('Kailo tokens → Material system colors', () => {
    afterEach(() => {
        delete window.KailoCells
        document.documentElement.removeAttribute('style')
    })

    it('parses HSL triplets, alpha triplets and CSS colors', () => {
        expect(tokenColor('266 85.05% 58.04%').hex()).toBe(Color.hsl(266, 85.05, 58.04).hex())
        expect(tokenColor('0 0% 0% / 40%').alpha()).toBeCloseTo(0.4)
        expect(tokenColor('rgb(0 0 0 / 7%)')).not.toBeNull()
        expect(tokenColor('')).toBeNull()
        expect(tokenColor('not a color')).toBeNull()
        expect(tokenRadius('0.625rem')).toBe(10)
        expect(tokenRadius('6px')).toBe(6)
        expect(tokenRadius('')).toBe(10)
    })

    it('derives every native surface, text and accent color from the tokens', () => {
        const { colors, radius, fontFamily } = kailoScheme(LIGHT, false)
        expect(colors.primary).toBe(hsl(LIGHT['--primary']))
        expect(colors['on-primary']).toBe(hsl(LIGHT['--primary-foreground']))
        expect(colors.background).toBe(hsl(LIGHT['--background']))
        expect(colors['on-surface']).toBe(hsl(LIGHT['--card-foreground']))
        expect(colors['on-surface-variant']).toBe(hsl(LIGHT['--muted-foreground']))
        expect(colors['secondary-container']).toBe(hsl(LIGHT['--accent']))
        expect(colors['outline-variant']).toBe(hsl(LIGHT['--border']))
        expect(colors.error).toBe(hsl(LIGHT['--destructive']))
        expect(colors['surface-3']).toBe(hsl(LIGHT['--sidebar-background']))
        expect(colors['card-border-radius']).toBe('10px')
        expect(radius).toBe(10)
        expect(fontFamily).toMatch(/^"Inter Variable"/)
        // Containers are tints of the Kailo primary on the Kailo background.
        expect(colors['primary-container']).not.toBe(colors.background)
    })

    it('follows the dark tokens', () => {
        const { colors } = kailoScheme(DARK, true)
        expect(colors.background).toBe(hsl(DARK['--background']))
        expect(colors.primary).toBe(hsl(DARK['--primary']))
        expect(colors['hover-background']).toBe('rgba(255,255,255,.06)')
    })

    it('refuses incomplete tokens and is inactive without the bridge', () => {
        expect(() => kailoScheme({ '--background': '0 0% 100%' }, false)).toThrow()
        expect(kailoThemeActive(LIGHT)).toBe(false)
        window.KailoCells = {}
        expect(kailoThemeActive(LIGHT)).toBe(true)
        expect(kailoThemeActive({})).toBe(false)
    })

    it('reads the tokens applied to the document', () => {
        document.documentElement.style.setProperty('--primary', '210 80% 50%')
        expect(readKailoTokens()['--primary']).toBe('210 80% 50%')
    })
})
