// DD-133 §2: behaviour of the public /kailo-embed/ page exactly as the native
// Gateway serves it (the body and CSP rendered into native-gateway.yaml).
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

test('the served script is pinned by the CSP hash and survives $-expansion', () => {
  const digest = createHash('sha256').update(script).digest('base64');
  assert.ok(csp.includes(`'sha256-${digest}'`), 'CSP hash matches the body');
  assert.ok(!script.includes('$'), 'no $ for the configuration loader');
  assert.ok(csp.includes("frame-ancestors ''self'' ${KAILO_FRAME_ANCESTORS}"));
  assert.ok(html.includes('content="${KAILO_FRAME_ANCESTORS}"'));
});

function run({ path, search = '', embedded = true, probe = 'ok', logout = '', opener = null }) {
  const calls = { replace: [], posted: [], opened: [], closed: false, shown: null };
  const elements = {
    m: { style: {} },
    t: { textContent: '' },
    l: {
      attributes: {},
      listeners: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
      addEventListener(event, fn) {
        this.listeners[event] = fn;
      },
    },
  };
  // Objects built inside the page's VM realm are compared as plain data.
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const parent = {
    postMessage: (message, origin) => calls.posted.push({ message: plain(message), origin }),
  };
  const self = {};
  const listeners = {};
  const window = {
    self,
    top: embedded ? parent : self,
    parent: embedded ? parent : self,
    opener,
    addEventListener: (event, fn) => (listeners[event] = fn),
    open: (url) => {
      calls.opened.push(url);
      return {};
    },
    close: () => (calls.closed = true),
  };
  const meta = { 'kailo-origins': KAILO, 'kailo-logout-url': logout };
  const timers = [];
  const document = {
    referrer: '',
    documentElement: {},
    querySelector: (selector) => {
      const name = selector.match(/name="([^"]+)"/)[1];
      return { getAttribute: () => meta[name] };
    },
    getElementById: (id) => elements[id],
    createElement: () => {
      const frameListeners = {};
      const frame = {
        style: {},
        remove() {},
        addEventListener: (event, fn) => (frameListeners[event] = fn),
        get contentWindow() {
          return {
            get location() {
              if (probe === 'cross-origin') throw new Error('SecurityError');
              return { pathname: probe === 'ok' ? '/kailo-embed/auth-ok' : '/oauth/callback' };
            },
          };
        },
      };
      frame.load = () => frameListeners.load();
      return frame;
    },
    body: { appendChild: (frame) => frame.load() },
  };
  const location = {
    pathname: path,
    search,
    origin: WREN,
    ancestorOrigins: embedded ? [KAILO] : [],
    replace: (url) => calls.replace.push(url),
  };
  vm.runInNewContext(script, {
    window,
    document,
    location,
    navigator: { language: 'zh-CN' },
    URL,
    URLSearchParams,
    encodeURIComponent,
    setTimeout: (fn) => timers.push(fn),
  });
  calls.shown = elements.m.style.display === 'block' ? elements : null;
  calls.listeners = listeners;
  return calls;
}

const signin = (returnTo) => `?returnTo=${encodeURIComponent(returnTo)}`;

test('top level: unauthenticated pages go straight to the IdP sign-in', () => {
  const calls = run({ path: '/kailo-embed/signin', search: signin('/home?kailo_theme=dark'), embedded: false });
  assert.deepEqual(calls.replace, ['/auth/login?returnTo=%2Fhome%3Fkailo_theme%3Ddark']);
});

test('in Kailo with an IdP session: silent sign-in, back to the page', () => {
  const calls = run({ path: '/kailo-embed/signin', search: signin('/knowledge/instructions') });
  assert.deepEqual(calls.replace, ['/knowledge/instructions']);
  assert.equal(calls.posted.length, 0);
  assert.equal(calls.shown, null);
});

test('in Kailo without an IdP session: the host is told, no IdP page in the frame', () => {
  for (const probe of ['cross-origin', 'callback-error']) {
    const calls = run({ path: '/kailo-embed/signin', search: signin('/home'), probe });
    assert.deepEqual(calls.replace, []);
    assert.deepEqual(calls.posted, [
      {
        message: { source: 'kailo-native-page', component: 'data-query', type: 'auth-required', detail: { returnTo: '/home' } },
        origin: KAILO,
      },
    ]);
    assert.ok(calls.shown, 'fallback sign-in offered');
    assert.equal(calls.shown.l.attributes.href, '/auth/login?returnTo=%2Fkailo-embed%2Fpopup-done');
    const event = { preventDefault() { this.prevented = true; } };
    calls.shown.l.listeners.click(event);
    assert.deepEqual(calls.opened, ['/auth/login?returnTo=%2Fkailo-embed%2Fpopup-done']);
    assert.ok(event.prevented);
  }
});

test('a finished sign-in window resumes the framed page (same origin only)', () => {
  const calls = run({ path: '/kailo-embed/signin', search: signin('/home'), probe: 'cross-origin' });
  calls.listeners.message({ origin: KAILO, data: { source: 'kailo-native-page', type: 'signed-in' } });
  assert.deepEqual(calls.replace, []);
  calls.listeners.message({ origin: WREN, data: { source: 'kailo-native-page', type: 'signed-in' } });
  assert.deepEqual(calls.replace, ['/home']);
  const opener = { postMessage: (message, origin) => (opener.got = JSON.parse(JSON.stringify({ message, origin }))) };
  const done = run({ path: '/kailo-embed/popup-done', embedded: false, opener });
  assert.deepEqual(opener.got, { message: { source: 'kailo-native-page', type: 'signed-in' }, origin: WREN });
  assert.ok(done.closed);
});

test('return targets are local paths or exact Kailo origins only', () => {
  for (const evil of ['//evil.example', '/\t/evil.example', '/\\evil.example', 'https://evil.example/x'])
    assert.deepEqual(run({ path: '/kailo-embed/signin', search: signin(evil), embedded: false }).replace, ['/auth/login?returnTo=%2F']);
  assert.deepEqual(run({ path: '/kailo-embed/return', search: `?to=${encodeURIComponent(`${KAILO}/app/x`)}`, embedded: false }).replace, [`${KAILO}/app/x`]);
  assert.deepEqual(run({ path: '/kailo-embed/return', search: `?to=${encodeURIComponent('https://evil.example/app')}`, embedded: false }).replace, ['/']);
});

test('sign-out: Kailo is told inside the frame; top level continues to the Kailo sign-out', () => {
  const framed = run({ path: '/kailo-embed/signed-out', logout: `${KAILO}/logout` });
  assert.deepEqual(framed.posted.map((call) => [call.message.type, call.origin]), [['signed-out', KAILO]]);
  assert.deepEqual(framed.replace, []);
  const top = run({ path: '/kailo-embed/signed-out', embedded: false, logout: `${KAILO}/logout` });
  assert.deepEqual(top.replace, [`${KAILO}/logout`]);
  assert.equal(top.posted.length, 0);
});
