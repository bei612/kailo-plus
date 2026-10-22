// DD-133(2) (`.design/07` §4.7.2): behaviour of the public /kailo-embed/ page
// exactly as the native Gateway serves it (body and CSP rendered into
// native-gateway.yaml), plus the Gateway's back-channel logout configuration.
// Run: node --test data-query/docker/kailo-embed/page.test.mjs (Node >= 18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const yaml = readFileSync(new URL('../native-gateway.yaml', import.meta.url), 'utf8');
const lines = yaml.split('\n');
const start = lines.findIndex((line) => line.trim() === 'body: |');
const indent = lines[start + 1].match(/^ */)[0].length;
const body = [];
for (const line of lines.slice(start + 1)) {
  if (line.trim() && line.match(/^ */)[0].length < indent) break;
  body.push(line.slice(indent));
}
const html = body.join('\n');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const csp = lines.find((line) => line.includes('content-security-policy:'));
const KAILO = 'http://kailo.example.test:58090';
const WREN = 'http://wren.example.test:58095';
const plain = (value) => JSON.parse(JSON.stringify(value));

test('the served script is pinned by the CSP hash and survives $-expansion', () => {
  const digest = createHash('sha256').update(script).digest('base64');
  assert.ok(csp.includes(`'sha256-${digest}'`), 'CSP hash matches the body');
  assert.ok(!script.includes('$'), 'no $ for the configuration loader');
  assert.ok(csp.includes("frame-ancestors ''self'' ${KAILO_FRAME_ANCESTORS}"));
  assert.ok(html.includes('<meta name="kailo-web-origin" content="${KAILO_FRAME_ANCESTORS}">'));
});

test('the Gateway receives back-channel logout on the fixed path (07 §4.7.5)', () => {
  const at = lines.findIndex((line) => line.trim() === 'backchannelLogout:');
  assert.ok(at > 0);
  assert.equal(lines[at + 1].trim(), 'path: /oauth/backchannel-logout');
});

function run({ path, search = '', embedded = true, probe = 'ok', logout = '', stored = null }) {
  const calls = { replace: [], posted: [], shown: null, theme: null };
  const elements = {
    m: { style: {} },
    t: { textContent: '' },
    l: {
      style: {},
      attributes: {},
      textContent: '',
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
    },
  };
  const parent = { postMessage: (message, origin) => calls.posted.push({ message: plain(message), origin }) };
  const self = {};
  const window = {
    self,
    top: embedded ? parent : self,
    parent: embedded ? parent : self,
    sessionStorage: { getItem: () => (stored ? JSON.stringify(stored) : null) },
  };
  const meta = { 'kailo-web-origin': `${KAILO} not-an-origin`, 'kailo-logout-url': logout };
  const document = {
    documentElement: { setAttribute: (name, value) => name === 'data-kailo-theme' && (calls.theme = value) },
    querySelector: (selector) => {
      const name = selector.match(/name="([^"]+)"/)[1];
      return { getAttribute: () => meta[name] };
    },
    getElementById: (id) => elements[id],
    createElement: () => {
      const listeners = {};
      const frame = {
        style: {},
        remove() {},
        addEventListener: (event, fn) => (listeners[event] = fn),
        get contentWindow() {
          return {
            get location() {
              if (probe === 'cross-origin') throw new Error('SecurityError');
              return { pathname: probe === 'ok' ? '/kailo-embed/auth-ok' : '/oauth/callback' };
            },
          };
        },
      };
      frame.load = () => listeners.load();
      return frame;
    },
    body: { appendChild: (frame) => frame.load() },
  };
  const location = { pathname: path, search, origin: WREN, replace: (url) => calls.replace.push(url) };
  vm.runInNewContext(script, {
    window,
    document,
    location,
    URL,
    URLSearchParams,
    JSON,
    encodeURIComponent,
    setTimeout: () => {},
  });
  calls.shown = elements.m.style.display === 'block' ? elements : null;
  return calls;
}

const signin = (returnTo) => `?returnTo=${encodeURIComponent(returnTo)}`;

test('top level: unauthenticated pages go straight to the IdP sign-in', () => {
  const calls = run({ path: '/kailo-embed/signin', search: signin('/home?kailo_theme=dark'), embedded: false });
  assert.deepEqual(calls.replace, ['/auth/login?returnTo=%2Fhome%3Fkailo_theme%3Ddark']);
});

test('in Kailo with an IdP session: silent sign-in, back to the same page', () => {
  const calls = run({ path: '/kailo-embed/signin', search: signin('/knowledge/instructions') });
  assert.deepEqual(calls.replace, ['/knowledge/instructions']);
  assert.equal(calls.posted.length, 0);
  assert.equal(calls.shown, null);
});

test('in Kailo without an IdP session: wire v1 auth-required to the exact origin, no login in the frame', () => {
  for (const probe of ['cross-origin', 'callback-error']) {
    const calls = run({ path: '/kailo-embed/signin', search: signin('/home?kailo_theme=dark&kailo_locale=en'), probe });
    assert.deepEqual(calls.replace, []);
    assert.deepEqual(calls.posted, [{ message: { source: 'kailo-embed', version: 1, type: 'auth-required' }, origin: KAILO }]);
    assert.ok(calls.shown);
    assert.match(calls.shown.t.textContent, /Sign in to Kailo again/);
    assert.equal(calls.shown.l.style.display, 'none', 'no sign-in link or form in the frame');
    assert.equal(calls.theme, 'dark', 'Kailo theme kept');
  }
});

test('the theme this tab already received from Kailo is kept after redirects', () => {
  const calls = run({ path: '/kailo-embed/signin', search: signin('/home'), probe: 'cross-origin', stored: { theme: 'dark', locale: 'zh-CN' } });
  assert.equal(calls.theme, 'dark');
  assert.match(calls.shown.t.textContent, /重新登录 Kailo/);
});

test('return targets are local paths only', () => {
  for (const evil of ['//evil.example', '/\t/evil.example', '/\\evil.example', 'https://evil.example/x'])
    assert.deepEqual(run({ path: '/kailo-embed/signin', search: signin(evil), embedded: false }).replace, ['/auth/login?returnTo=%2F']);
});

test('sign-out: top level continues to the Kailo sign-out; inside Kailo nothing is posted', () => {
  const top = run({ path: '/kailo-embed/signed-out', embedded: false, logout: `${KAILO}/logout` });
  assert.deepEqual(top.replace, [`${KAILO}/logout`]);
  const framed = run({ path: '/kailo-embed/signed-out', logout: `${KAILO}/logout` });
  assert.deepEqual(framed.replace, []);
  assert.deepEqual(framed.posted, []);
  assert.ok(framed.shown);
  const fallback = run({ path: '/kailo-embed/signed-out', embedded: false });
  assert.equal(fallback.shown.l.attributes.href, `${KAILO}/`);
});
