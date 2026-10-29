// Unit-only native HTTP fixture. Proves retained creation/ack boundaries, not E2E.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

async function fixture(t, { lostAck = false, commit = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'knowledge-seed-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const nodes = new Map(), puts = [];
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'PUT') {
      for await (const _ of req) { /* original S3 bytes, no source content retained */ }
      const id = req.headers['x-amz-meta-create-resource-uuid'];
      puts.push(id);
      if (commit) nodes.set(id, { Uuid: id, Type: 'LEAF' });
      if (lostAck && puts.length === 1) { res.writeHead(503).end('{}'); return; }
      res.end('{}'); return;
    }
    const match = /^\/v2\/n\/node\/([0-9a-f-]{36})(\/versions|\?Flags=WithMetaDefaults)$/.exec(req.url);
    if (!match || !nodes.has(match[1])) { res.writeHead(404).end('{}'); return; }
    if (match[2] === '/versions') res.end(JSON.stringify({ Versions: [{ VersionId: 'fixture-v1', Draft: false }] }));
    else res.end(JSON.stringify(nodes.get(match[1])));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const registration = new URL('../../../contracts/adapter/knowledge.v3/registration.json', import.meta.url).pathname;
  const seed = { requirementsFile: join(dir, 'requirements.json'), registrationFile: registration,
    cellsOrigin: origin, restBasePath: '/v2/', cellsExternal: origin, workspaceSlug: 'fixture',
    adminTokenFile: join(dir, 'native-token'), s3Secret: 'gatewaysecret',
    sourceFolders: { 'knowledge:3:knowledge_roundtrip/ingest_source': 'roundtrip',
      'knowledge:3:knowledge_native_retire/sync_source': 'retiring', 'knowledge:3:knowledge_native_apply/sync_source': 'applying' },
    sourceText: 'fixture source', retiredText: 'fixture retired', timeoutMs: 3000, waitSeconds: 2,
    nativeOut: join(dir, 'native.json'), out: join(dir, 'governed.json') };
  await writeFile(seed.requirementsFile, JSON.stringify({ component: 'knowledge', satisfiable: true }), { mode: 0o600 });
  await writeFile(seed.adminTokenFile, 'fixture-native-token', { mode: 0o600 });
  const input = join(dir, 'seed.json');
  await writeFile(input, JSON.stringify(seed), { mode: 0o600 });
  const run = async () => {
    const child = spawn(process.execPath, [new URL('./seed-knowledge.mjs', import.meta.url).pathname, '--phase', 'native', '--seed', input],
      { stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = ''; child.stdout.resume(); child.stderr.on('data', (chunk) => { errors += chunk; });
    const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
    return { code, errors };
  };
  return { run, puts, nodes, record: async () => JSON.parse(await readFile(seed.nativeOut, 'utf8')) };
}

test('native seed observes retained files and refuses to recreate a confirmed missing one', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.run()).code, 0);
  const first = await f.record(), count = f.puts.length;
  assert.equal((await f.run()).code, 0);
  assert.equal(f.puts.length, count);
  assert.deepEqual(await f.record(), first);
  f.nodes.delete(first.files[0].nativeObjectRef);
  assert.equal((await f.run()).code, 1);
  assert.equal(f.puts.length, count);
});

test('lost native PUT acknowledgement recovers only by the original proposed UUID', async (t) => {
  const f = await fixture(t, { lostAck: true });
  assert.equal((await f.run()).code, 1);
  const first = f.puts[0];
  assert.equal((await f.run()).code, 0);
  assert.equal(f.puts.filter((id) => id === first).length, 1);
  assert.equal((await f.record()).files[0].nativeObjectRef, first);
});

test('uncertain absent native PUT is not replayed or replaced by another identity', async (t) => {
  const f = await fixture(t, { lostAck: true, commit: false });
  assert.equal((await f.run()).code, 1);
  assert.equal((await f.run()).code, 1);
  assert.equal(f.puts.length, 1);
});
