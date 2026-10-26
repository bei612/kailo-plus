// Unit-only HTTP fixture; no real credentials or OpenBao service.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';

async function fixture(t) {
  const root = `/volumes/data/kailo/conformance/runs/secrets-unit-${randomUUID()}`;
  const deployment = join(root, 'receiver/apps/deploy/local'), tenantId = randomUUID();
  for (const directory of ['receiver/apps/deploy/local/secrets', 'receiver/source-cells/secrets', 'receiver/knowledge']) {
    await mkdir(join(root, directory), { recursive: true, mode: 0o700 });
  }
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(deployment, 'secrets/openbao_init.json'), JSON.stringify({ root_token: 'fixture-operator' }), { mode: 0o600 });
  const endpoints = [];
  for (const [role, key, file, audience] of [
    ['SOURCE', 'cells_bearer', 'receiver/source-cells/secrets/service.pat', 'kailo-adapter-file-storage'],
    ['RECEIVER', 'native_mcp_bearer', 'receiver/knowledge/mcp-bearer', 'kailo-adapter-knowledge'],
  ]) {
    const bindingId = randomUUID(), nativeFile = join(root, file);
    await writeFile(nativeFile, `fixture-${role}-native`, { mode: 0o600 });
    endpoints.push({ role, bindingId, nativeFile, secretRefs: [key, 'oidc_client_secret'].map((secretKey) => ({
      secretKey, locator: `tenants/${tenantId}/kv/application-binding/${bindingId}/${secretKey}`, version: 1, audience,
    })) });
  }
  const saved = new Map(), calls = [];
  const server = createServer(async (req, res) => {
    calls.push(`${req.method} ${req.url}`);
    assert.equal(req.headers['x-vault-token'], 'fixture-operator');
    assert.equal(req.headers['x-vault-namespace'], `tenants/${tenantId}`);
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/sys/mounts') { res.end(JSON.stringify({ data: { 'kv/': { type: 'kv', options: { version: '2' } } } })); return; }
    if (req.url === '/v1/sys/auth') { res.end(JSON.stringify({ data: { 'approle/': { type: 'approle' } } })); return; }
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); assert.equal(body.options.cas, 0);
      assert.ok(!saved.has(req.url)); saved.set(req.url, { data: body.data, metadata: { version: 1 } });
      res.writeHead(204).end(); return;
    }
    if (!saved.has(req.url)) { res.writeHead(404).end('{}'); return; }
    res.end(JSON.stringify({ data: saved.get(req.url) }));
  });
  await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const input = { deployment, project: `kailo-receiver-${root.split('-').at(-1)}`, tenantId, endpoints,
    baoUrl: `http://openbao:${server.address().port}` };
  const run = async (change = {}) => {
    const path = join(root, 'receiver/secrets-input.json');
    await writeFile(path, JSON.stringify({ ...input, ...change }), { mode: 0o600 });
    const child = spawn(process.execPath, [new URL('./receiver-adapter-secrets.mjs', import.meta.url).pathname, '--input', path], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; child.stdout.on('data', (chunk) => { out += chunk; }); child.stderr.on('data', (chunk) => { err += chunk; });
    const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
    assert.equal(err, ''); assert.ok(!out.includes('fixture-SOURCE-native'));
    return { code, result: JSON.parse(out) };
  };
  return { run, input, saved, calls };
}

test('fixed original SecretRefs persist native values and independent IdP credentials once', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.run()).code, 0);
  assert.equal(f.saved.size, 4);
  const values = [...f.saved.values()].map((row) => row.data.value);
  assert.equal(new Set(values).size, 4);
  assert.ok(values.includes('fixture-SOURCE-native') && values.includes('fixture-RECEIVER-native'));
  const before = f.calls.length;
  assert.equal((await f.run()).code, 0);
  assert.ok(f.calls.slice(before).every((call) => call.startsWith('GET ')));
});

test('native rotation or fixed version drift refuses before any further writes', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.run()).code, 0);
  await writeFile(f.input.endpoints[1].nativeFile, 'rotated-native', { mode: 0o600 });
  const before = f.calls.length;
  assert.equal((await f.run()).code, 2);
  assert.ok(f.calls.slice(before).every((call) => call.startsWith('GET ')));
  await writeFile(f.input.endpoints[1].nativeFile, 'fixture-RECEIVER-native', { mode: 0o600 });
  [...f.saved.values()][0].metadata.version = 2;
  assert.equal((await f.run()).code, 2);
});

test('foreign native files and cross-tenant locators refuse before contacting OpenBao', async (t) => {
  const f = await fixture(t);
  const altered = structuredClone(f.input.endpoints);
  altered[0].nativeFile = altered[1].nativeFile;
  assert.equal((await f.run({ endpoints: altered })).code, 2);
  altered[0] = structuredClone(f.input.endpoints[0]);
  altered[1].secretRefs[0].locator = altered[1].secretRefs[0].locator.replace(f.input.tenantId, randomUUID());
  assert.equal((await f.run({ endpoints: altered })).code, 2);
  assert.equal(f.calls.length, 0);
});


test('forward delivery uses only its explicit scope and refuses cross-binding drift', async (t) => {
  const f = await fixture(t);
  const directory = f.input.deployment.replace('/apps/deploy/local', '/knowledge');
  const bindingId = f.input.endpoints[1].bindingId;
  await writeFile(join(directory, 'adapter-plan.json'), JSON.stringify({ tenantId: f.input.tenantId, bindingId }), { mode: 0o600 });
  await writeFile(join(directory, 'forward-mcp-bearer'), 'fixture-forward-native', { mode: 0o600 });
  const endpoint = { role: 'FORWARD', bindingId, nativeFile: join(directory, 'forward-mcp-bearer'),
    secretRefs: ['native_mcp_bearer', 'oidc_client_secret'].map((secretKey) => ({ secretKey,
      locator: `tenants/${f.input.tenantId}/kv/conformance-forward/${bindingId}/${secretKey}`,
      version: 1, audience: 'kailo-conformance-knowledge' })) };
  assert.equal((await f.run({ purpose: 'FORWARD_PROTOCOL', endpoints: [endpoint] })).code, 0);
  assert.equal(f.saved.size, 2);
  assert.ok([...f.saved.keys()].every((path) => path.includes('/conformance-forward/')));
  const before = f.calls.length;
  assert.equal((await f.run({ purpose: 'FORWARD_PROTOCOL', endpoints: [endpoint] })).code, 0);
  assert.ok(f.calls.slice(before).every((call) => call.startsWith('GET ')));
  assert.equal((await f.run({ purpose: 'FORWARD_PROTOCOL', endpoints: [{ ...endpoint, bindingId: randomUUID() }] })).code, 2);
  const wrong = structuredClone(endpoint); wrong.secretRefs[0].locator = wrong.secretRefs[0].locator.replace('/conformance-forward/', '/application-binding/');
  assert.equal((await f.run({ purpose: 'FORWARD_PROTOCOL', endpoints: [wrong] })).code, 2);
  assert.equal(f.saved.size, 2);
});
