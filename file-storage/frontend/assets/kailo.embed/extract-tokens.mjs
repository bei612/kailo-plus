#!/usr/bin/env node
/*
 * Build-time generator of kailo-theme-tokens.css (DD-133 §4): the Kailo design
 * tokens are the client-kit theme variables. Only the custom properties of
 * the light (:root) and dark (.dark) token blocks are kept; Buzz shell rules,
 * Tailwind directives and selectors never reach the native page.
 *
 *   node extract-tokens.mjs <client-kit theme css> <output css>
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Tokens the native overlay and theme mapping consume; a source without them
// is not a Kailo token source and fails the build.
export const REQUIRED_TOKENS = [
    '--radius', '--background', '--foreground', '--card', '--card-foreground', '--popover',
    '--popover-foreground', '--primary', '--primary-foreground', '--secondary', '--secondary-foreground',
    '--muted', '--muted-foreground', '--accent', '--accent-foreground', '--destructive',
    '--destructive-foreground', '--border', '--input', '--ring',
];

function block(text, selector) {
    const match = selector.exec(text);
    if (!match) {
        return null;
    }
    const start = match.index + match[0].length;
    const end = text.indexOf('}', start);
    return end === -1 ? null : text.slice(start, end);
}

function declarations(body) {
    const out = [];
    const seen = new Set();
    for (const raw of body.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
        const m = /^\s*(--[a-z0-9-]+)\s*:\s*([^{}]+?)\s*$/i.exec(raw);
        if (m && !seen.has(m[1])) {
            seen.add(m[1]);
            out.push([m[1], m[2].replace(/\s+/g, ' ')]);
        }
    }
    return out;
}

export function extractTokens(text) {
    const light = block(text, /(^|[\s{}]):root\s*\{/);
    const dark = block(text, /(^|[\s{}])(?::root)?\.dark\s*\{/);
    if (light === null || dark === null) {
        throw new Error('no :root and .dark token blocks in the token source');
    }
    const lightTokens = declarations(light);
    const darkTokens = declarations(dark);
    const names = new Set(lightTokens.map(([name]) => name));
    const missing = REQUIRED_TOKENS.filter((name) => !names.has(name));
    if (missing.length) {
        throw new Error('token source lacks ' + missing.join(', '));
    }
    const render = (selector, tokens) => selector + ' {\n' + tokens.map(([n, v]) => `    ${n}: ${v};`).join('\n') + '\n}\n';
    return '/* Generated at build time from the client-kit theme variables (DD-133 §4). Do not edit. */\n' +
        render(':root', lightTokens) + render(':root.dark', darkTokens);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [input, output] = process.argv.slice(2);
    if (!input || !output) {
        console.error('usage: extract-tokens.mjs <theme css> <output css>');
        process.exit(2);
    }
    writeFileSync(output, extractTokens(readFileSync(input, 'utf8')));
}
