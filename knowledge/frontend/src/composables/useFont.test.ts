import assert from 'node:assert/strict'
import test from 'node:test'
import { fontStacks, SANS_STACKS, MONO_STACKS } from './useFont'

// Acceptance batch 5: in Kailo mode the page rendered in the native -apple-system
// stack because the default font preference was written inline on <html>, above the
// Kailo token overlay (--app-font-family: var(--kailo-font-sans)).
test('in Kailo mode the default fonts are left to the Kailo tokens', () => {
  assert.deepEqual(fontStacks('system', 'system', true), { sans: '', mono: '' })
})

test('an explicitly chosen font still applies in Kailo mode', () => {
  assert.deepEqual(fontStacks('georgia', 'menlo', true), { sans: SANS_STACKS.georgia, mono: MONO_STACKS.menlo })
})

test('outside Kailo mode the native default stack is unchanged', () => {
  assert.deepEqual(fontStacks('system', 'system', false), { sans: SANS_STACKS.system, mono: MONO_STACKS.system })
})
