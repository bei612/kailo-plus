// Unit fixture for provisioning semantics only. No real Bao or Gateway is used.
// Bounded CI container: ephemeral /volumes/data and --add-host openbao:127.0.0.1.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, createPrivateKey, createPublicKey } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';

async function fixture(t) {
  const root = `/volumes/data/kailo/conformance/runs/gateway-unit-${randomUUID()}`;
  const deployment = join(root, 'receiver/apps/deploy/local');
  const directory = join(root, 'receiver/gateway');
  await mkdir(join(deployment, 'secrets'), { recursive: true, mode: 0o700 });
  await mkdir(join(directory, 'bootstrap'), { recursive: true, mode: 0o700 });
  await mkdir(join(directory, 'public'), { mode: 0o755 });
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(deployment, 'secrets/openbao_init.json'), JSON.stringify({ root_token: 'fixture-operator' }), { mode: 0o600 });
  const saved = new Map(), calls = [];
  const server = createServer(async (req, res) => {
    calls.push(`${req.method} ${req.url}`);
    assert.equal(req.headers['x-vault-token'], 'fixture-operator');
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    res.setHeader('content-type', 'application/json');
    const material = '/v1/kv/data/service-signing';
    if (req.method !== 'GET') {
      if (req.url === material) {
        assert.equal(body.options.cas, 0);
        if (saved.has(material)) { res.writeHead(409).end('{}'); return; }
        saved.set(material, { data: body.data, metadata: { version: 1 } });
      } else if (req.url.endsWith('/secret-id')) {
        assert.equal(req.headers['x-vault-wrap-ttl'], '5m');
        res.end(JSON.stringify({ wrap_info: { token: 'fixture-one-use-wrapped' } })); return;
      } else saved.set(req.url, body);
      res.writeHead(204).end(); return;
    }
    if (req.url === '/v1/sys/mounts') { res.end(JSON.stringify({ data: saved.has('/v1/sys/mounts/kv') ? { 'kv/': saved.get('/v1/sys/mounts/kv') } : {} })); return; }
    if (req.url === '/v1/sys/auth') { res.end(JSON.stringify({ data: saved.has('/v1/sys/auth/approle') ? { 'approle/': saved.get('/v1/sys/auth/approle') } : {} })); return; }
    if (req.url.endsWith('/role-id')) { res.end(JSON.stringify({ data: { role_id: 'fixture-role-id' } })); return; }
    if (!saved.has(req.url)) { res.writeHead(404).end('{}'); return; }
    res.end(JSON.stringify({ data: saved.get(req.url) }));
  });
  await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const input = { deployment, project: `kailo-receiver-${root.split('-').at(-1)}`, baoUrl: `http://openbao:${server.address().port}`,
    privateRoot: '/run/receiver-private', gatewayUid: 65532, gatewayGid: 65532, operatorUid: process.getuid(), operatorGid: process.getgid() };
  const path = join(directory, 'input.json');
  const run = async (change = {}) => {
    await writeFile(path, JSON.stringify({ ...input, ...change }), { mode: 0o600 });
    const child = spawn(process.execPath, [new URL('./receiver-gateway.mjs', import.meta.url).pathname, '--input', path], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; child.stdout.on('data', (chunk) => { out += chunk; }); child.stderr.on('data', (chunk) => { err += chunk; });
    const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
    assert.equal(err, '');
    return { code, result: JSON.parse(out) };
  };
  return { run, saved, calls, directory, input };
}

test('Gateway key is create-only in Bao; Agent alone gets the private-file template', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.run()).code, 0);
  const material = f.saved.get('/v1/kv/data/service-signing').data;
  const key = createPrivateKey(material.private_key);
  assert.equal(key.asymmetricKeyDetails.namedCurve, 'prime256v1');
  const publicKey = JSON.parse(material.public_jwks).keys[0];
  assert.equal(publicKey.x, createPublicKey(key).export({ format: 'jwk' }).x);
  assert.equal((await f.run()).code, 0);
  assert.equal(f.calls.filter((c) => c === 'POST /v1/kv/data/service-signing').length, 1);
  const identity = await readFile(join(f.directory, 'identity.json'), 'utf8');
  const hcl = await readFile(join(f.directory, 'bootstrap/agent.hcl'), 'utf8');
  assert.ok(!identity.includes('PRIVATE KEY') && !hcl.includes('PRIVATE KEY'));
  assert.match(hcl, /uid = 65532/);
  assert.match(hcl, /perms = "0600"/);
  assert.match(hcl, /kv\/data\/service-signing\?version=1/);
  assert.match(hcl, /\.Data\.data\.private_key/);
  assert.match(hcl, /\.Data\.data\.public_jwks/);
  // Optional external CI SDK verification reads only this non-secret HCL.
  if (process.env.RECEIVER_GATEWAY_HCL_CHECK_OUT) await writeFile(process.env.RECEIVER_GATEWAY_HCL_CHECK_OUT, hcl, { mode: 0o600 });
});

test('changed Gateway key version refuses before policy or credential renewal', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.run()).code, 0);
  f.saved.get('/v1/kv/data/service-signing').metadata.version = 2;
  const before = f.calls.length;
  assert.equal((await f.run()).code, 2);
  assert.ok(f.calls.slice(before).every((call) => call.startsWith('GET ')));
});

test('production deployment and foreign project refuse before any Bao request', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.run({ deployment: '/volumes/kailo/apps/deploy/local' })).code, 2);
  assert.equal((await f.run({ project: 'kailo-receiver-foreign' })).code, 2);
  assert.equal(f.calls.length, 0);
});
