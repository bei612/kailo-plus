import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { extractTokens, REQUIRED_TOKENS } from './extract-tokens.mjs'

const tokens = (extra) => REQUIRED_TOKENS.map((n, i) => `    ${n}: ${i} 10% 20%;`).join('\n') + '\n' + extra

// Same shape as client-kit/ts/platform/src/theme.css: tokens inside @layer
// base, Tailwind directives and Buzz shell rules around them.
const THEME = `@layer base {
  :root {
    /* Catppuccin Latte */
${tokens('    --chart-1: 345 57.65% 74.12%;')}
  }

  .dark {
${tokens('    --sidebar-background: 234 22.75% 17.25%;')}
  }

  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground antialiased;
    font-family: "Inter Variable", Inter, sans-serif;
  }
}
:root.dark { --sidebar-row-subtle-active-surface: rgb(255 255 255 / 16%); }
:root[data-buzz-sidebar] { --buzz-muted-foreground: rgb(0 0 0 / 40%); }
`

describe('Kailo token extraction', () => {
    it('keeps only the custom properties of the light and dark token blocks', () => {
        const css = extractTokens(THEME)
        expect(css).toContain(':root {\n    --radius: 0 10% 20%;')
        expect(css).toContain('--chart-1: 345 57.65% 74.12%;')
        expect(css).toMatch(/:root\.dark \{[^}]*--sidebar-background: 234 22\.75% 17\.25%;/)
        for (const banned of ['@apply', '@layer', 'font-family', 'data-buzz', 'sidebar-row-subtle']) {
            expect(css).not.toContain(banned)
        }
    })

    it('refuses a source without the Kailo tokens', () => {
        expect(() => extractTokens(':root { --background: 0 0% 100%; }\n.dark { --background: 0 0% 0%; }')).toThrow(/lacks/)
        expect(() => extractTokens('body { color: red; }')).toThrow(/token blocks/)
    })

    // On the CI node the real client-kit source is passed in: the build input
    // must keep producing every required token.
    it.runIf(!!process.env.KAILO_THEME_CSS && existsSync(process.env.KAILO_THEME_CSS || ''))('accepts the client-kit theme variables', () => {
        const css = extractTokens(readFileSync(process.env.KAILO_THEME_CSS, 'utf8'))
        for (const name of REQUIRED_TOKENS) {
            expect(css).toContain(name + ':')
        }
        expect(css).toContain(':root.dark {')
    })
})
