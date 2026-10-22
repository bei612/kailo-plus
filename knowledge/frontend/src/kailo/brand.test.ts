import assert from 'node:assert/strict'
import test from 'node:test'
import { brandLocaleMessages, brandMessages, brandText, productName } from './brand'

test('product name is the Kailo display name plus the component label', () => {
  assert.equal(productName('zh-CN', 'Kailo'), 'Kailo 知识库')
  assert.equal(productName('en-US', 'Kailo'), 'Kailo Knowledge')
  assert.equal(productName('ja-JP', 'Kailo'), 'Kailo Knowledge')
  assert.equal(productName('zh-CN', ''), '知识库')
  assert.equal(productName('en-US', '  '), 'Knowledge')
})

test('standalone upstream product word is replaced in prose', () => {
  const product = 'Kailo Knowledge'
  assert.equal(brandText('Welcome to WeKnora', product), 'Welcome to Kailo Knowledge')
  assert.equal(brandText('Welcome to WeKnora.', product), 'Welcome to Kailo Knowledge.')
  assert.equal(brandText("Hi, I am WeKnora, your assistant", product), 'Hi, I am Kailo Knowledge, your assistant')
  assert.equal(brandText('欢迎使用WeKnora！', 'Kailo 知识库'), '欢迎使用Kailo 知识库！')
  assert.equal(brandText("WeKnora's memory", product), "Kailo Knowledge's memory")
})

test('identifiers, URLs, file names and env keys are left untouched', () => {
  const product = 'Kailo Knowledge'
  for (const text of [
    'load weknora-widget.js',
    'github.com/Tencent/WeKnora',
    'docker pull wechatopenai/WeKnora-app',
    'set WeKnora_theme',
    'open WeKnora.js',
    'WeKnora-sandbox:main',
    'mail@WeKnora',
  ]) {
    assert.equal(brandText(text, product), text, text)
  }
})

test('message trees are copied, not mutated, and non-strings are kept', () => {
  const fn = () => 'x'
  const tree = { a: 'WeKnora rocks', nested: { b: ['to WeKnora', 3], f: fn }, n: 1 }
  const branded = brandMessages(tree, 'P')
  assert.deepEqual(branded, { a: 'P rocks', nested: { b: ['to P', 3], f: fn }, n: 1 })
  assert.equal(tree.a, 'WeKnora rocks')
})

test('each locale gets its own product name and display-name syntax stays literal', () => {
  const out = brandLocaleMessages({
    'zh-CN': { t: '欢迎使用 WeKnora' },
    'en-US': { t: 'Welcome to WeKnora' },
  }, 'Ka{il}o@|$')
  assert.equal(out['zh-CN'].t, '欢迎使用 Kailo 知识库')
  assert.equal(out['en-US'].t, 'Welcome to Kailo Knowledge')
})
