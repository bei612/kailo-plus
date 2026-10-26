// Bounded CI unit tests with a local HTTP fixture and placeholder credentials.
// These prove recovery side-effect boundaries, not original native/OIDC E2E.
// Run only in the check container with an ephemeral /volumes/data tmpfs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';

const user = 'a45aa396-ec64-407d-bc14-fae7f296818c';
const modelIds = { chat: 'b7c46cb2-71e6-4d07-80a3-ed864b2eaeac', embedding: '70aac6ac-5da2-4c8b-8dcc-6adc6e77137b' };
const declarations = { chat: { name: 'fixture-chat', baseUrl: 'http://receiver-model:8080/v1' },
  embedding: { name: 'fixture-embedding', baseUrl: 'http://receiver-model:8080/v1', dimension: 2560 } };
const modelState = Object.fromEntries(Object.entries(declarations).map(([role, row]) => [role, { nativeModelRef: modelIds[role], ...row }]));
const kb = { id: '362628de-bd1c-42f5-953c-876d0bffdcf3', tenant_id: 7,
  embedding_model_id: modelIds.embedding, summary_model_id: modelIds.chat };
const endpoint = { id: 'a597ebbb-1a28-4aa8-a2b3-c474f4e5bef2', tenant_id: 7, enabled: true,
  knowledge_base_ids: [kb.id], tools: ['search_knowledge', 'read_document', 'export_document', 'add_document', 'delete_document'] };

async function fixture(t, { previous = {}, kbRows = [], endpointRows = [], failAt, bearerDirectory = false, missingModel, emptyModels = false } = {}) {
  const base = '/volumes/data/kailo/conformance/runs';
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, 'native-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const deployment = join(root, 'receiver/apps/deploy/local'), directory = join(root, 'receiver/knowledge');
  await mkdir(deployment, { recursive: true });
  await mkdir(directory, { mode: 0o700 });
  const name = `kailo-receiver-unit-${randomUUID()}`;
  const calls = [];
  const models = Object.entries(declarations).map(([role, row]) => ({ id: modelIds[role], tenant_id: 7, name: row.name,
    display_name: `${name}-${role}`, is_builtin: false, type: role === 'chat' ? 'KnowledgeQA' : 'Embedding',
    source: 'remote', status: 'active', parameters: { base_url: row.baseUrl, interface_type: 'openai', provider: 'generic',
      ...(role === 'embedding' ? { embedding_parameters: { dimension: row.dimension } } : {}) } }));
  let observedModels = emptyModels ? [] : models.filter((row) => row.id !== modelIds[missingModel]);
  const server = createServer(async (req, res) => {
    calls.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    if (req.url === failAt) { res.writeHead(503).end('{}'); return; }
    if (req.url === '/api/v1/models') {
      if (req.method === 'POST') {
        let raw = ''; for await (const part of req) raw += part;
        const body = JSON.parse(raw);
        assert.equal(body.parameters.api_key, undefined);
        const model = models.find((row) => row.name === body.name);
        observedModels.push(model);
        res.end(JSON.stringify({ data: model }));
      } else res.end(JSON.stringify({ data: observedModels }));
      return;
    }
    const data = req.url === '/api/v1/auth/refresh' ? { access_token: 'fixture-access', refresh_token: 'fixture-refresh' }
      : req.url === '/api/v1/auth/me' ? { data: { user: { id: user }, tenant: { id: 7 }, memberships: [{ tenant_id: 7, role: 'admin' }] } }
        : req.url === '/api/v1/knowledge-bases' ? { data: req.method === 'GET' ? kbRows.map((v) => ({ ...v, name })) : { ...kb, name } }
          : req.url === '/api/v1/mcp-endpoints' ? { data: req.method === 'GET' ? endpointRows.map((v) => ({ ...v, name }))
            : { ...endpoint, name, token: 'fixture-mcp-bearer' } } : null;
    if (!data) { res.writeHead(404).end('{}'); return; }
    res.end(JSON.stringify(data));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const stateFile = join(directory, 'native.json');
  const identity = { origin, userId: user, tenantId: 7 };
  if (previous !== null) await writeFile(stateFile, JSON.stringify({ ...identity, ...(previous.knowledgeBaseId ? { models: modelState } : {}), ...previous }), { mode: 0o600 });
  await writeFile(join(directory, 'native.refresh'), 'fixture-refresh', { mode: 0o600 });
  const input = join(directory, 'input.json');
  await writeFile(input, JSON.stringify({ directory, origin, name, models: declarations }), { mode: 0o600 });
  if (bearerDirectory) await mkdir(join(directory, 'mcp-bearer'));
  const run = async (...args) => {
    const child = spawn(process.execPath, [new URL('./receiver-knowledge-native.mjs', import.meta.url).pathname, '--input', input, ...args],
      { env: { ...process.env, KAILO_DEPLOY_DIR: deployment }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    assert.equal(errors, '');
    return { code, result: JSON.parse(output) };
  };
  return { run, calls, state: async () => JSON.parse(await readFile(stateFile, 'utf8')), identity };
}

test('a confirmed missing KB refuses before any replacement POST', async (t) => {
  const f = await fixture(t, { previous: { knowledgeBaseId: kb.id } });
  assert.equal((await f.run()).code, 2);
  assert.ok(!f.calls.includes('POST /api/v1/knowledge-bases'));
  assert.equal((await f.state()).knowledgeBaseId, kb.id);
});

test('a confirmed missing MCP endpoint refuses before any replacement POST', async (t) => {
  const f = await fixture(t, { previous: { knowledgeBaseId: kb.id, mcpEndpointId: endpoint.id }, kbRows: [kb] });
  assert.equal((await f.run()).code, 2);
  assert.ok(!f.calls.includes('POST /api/v1/mcp-endpoints'));
  assert.equal((await f.state()).mcpEndpointId, endpoint.id);
});

test('identity is retained when the first native object request fails; its session can refresh', async (t) => {
  const f = await fixture(t, { previous: null, failAt: '/api/v1/knowledge-bases' });
  assert.equal((await f.run()).code, 2);
  assert.deepEqual(await f.state(), f.identity);
  assert.equal((await f.run('--refresh-only')).code, 0);
});

test('confirmed KB survives a later endpoint failure, so a retry cannot recreate it', async (t) => {
  const f = await fixture(t, { previous: null, failAt: '/api/v1/mcp-endpoints' });
  assert.equal((await f.run()).code, 2);
  assert.equal((await f.state()).knowledgeBaseId, kb.id);
  assert.equal((await f.run()).code, 2);
  assert.equal(f.calls.filter((c) => c === 'POST /api/v1/knowledge-bases').length, 1);
});

test('confirmed endpoint is retained before a bearer file write can fail', async (t) => {
  const f = await fixture(t, { previous: null, bearerDirectory: true });
  assert.equal((await f.run()).code, 1);
  assert.equal((await f.state()).mcpEndpointId, endpoint.id);
});

test('confirmed missing native model refuses before any replacement model or KB POST', async (t) => {
  const f = await fixture(t, { previous: { models: modelState }, missingModel: 'chat' });
  assert.equal((await f.run()).code, 2);
  assert.ok(!f.calls.includes('POST /api/v1/models'));
  assert.ok(!f.calls.includes('POST /api/v1/knowledge-bases'));
});

test('native model creation is keyless and each confirmed original identity survives later failure', async (t) => {
  const f = await fixture(t, { previous: null, emptyModels: true, failAt: '/api/v1/mcp-endpoints' });
  assert.equal((await f.run()).code, 2);
  assert.deepEqual((await f.state()).models, modelState);
  assert.equal(f.calls.filter((call) => call === 'POST /api/v1/models').length, 2);
  assert.equal((await f.run()).code, 2);
  assert.equal(f.calls.filter((call) => call === 'POST /api/v1/models').length, 2);
});
