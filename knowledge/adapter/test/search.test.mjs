// DD-138(5), .design/07 §4.8.4 / §5.2: the adapter `search` operation.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { canonical, componentPath } from '../../../client-kit/adapter/protocol.mjs';
import { createAdapter } from '../src/query-revision.mjs';
import { documentPath, knowledgeBasePath, snippet } from '../src/search.mjs';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function reply(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

const REVISION = '2026-10-20T08:00:00.123456789Z';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'knowledge-search-'));
  const ids = { binding: randomUUID(), tenant: randomUUID(), kb: randomUUID(), other: randomUUID(),
    doc1: randomUUID(), doc2: randomUUID(), doc3: randomUUID() };
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwks = join(directory, 'jwks');
  const nativeSecretFile = join(directory, 'native');
  const oidcSecretFile = join(directory, 'oidc');
  const nativeSecret = randomUUID();
  await writeFile(jwks, JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'core' }] }));
  await writeFile(nativeSecretFile, nativeSecret, { mode: 0o600 });
  await writeFile(oidcSecretFile, randomUUID(), { mode: 0o600 });
  const state = { calls: [], proofs: [], peps: 0 };
  const documents = {
    [ids.doc1]: { id: ids.doc1, title: 'Travel policy 2026', file_name: 'travel.pdf', native_revision: REVISION },
    [ids.doc2]: { id: ids.doc2, title: '  ', file_name: 'per-diem.md', native_revision: REVISION },
  };
  const upstream = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    if (request.method !== 'POST') return reply(response, 405, {});
    if (request.url === '/service/v1/adapter/pep_check' || request.url === '/token') {
      state.peps++;
      return reply(response, 500, {});
    }
    const body = JSON.parse(raw);
    if (body.method === 'initialize') return reply(response, 200, { jsonrpc: '2.0', id: body.id,
      result: { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'native-test', version: '1' } } });
    if (body.method === 'notifications/initialized') { response.writeHead(202); return response.end(); }
    assert.equal(request.headers.authorization, `Bearer ${nativeSecret}`);
    assert.equal(body.method, 'tools/call');
    state.calls.push({ name: body.params.name, arguments: body.params.arguments });
    state.proofs.push(JSON.parse(Buffer.from(request.headers['x-kailo-native-action'], 'base64url')));
    let value;
    if (body.params.name === 'list_knowledge_bases') {
      value = { knowledge_bases: [
        { id: ids.other, name: 'Travel elsewhere', native_revision: REVISION },
        { id: ids.kb, name: 'Travel Handbook', description: 'Company\ttravel rules', native_revision: REVISION },
      ] };
    } else if (body.params.name === 'search_knowledge') {
      value = { query: body.params.arguments.query, knowledge_base_ids: [ids.kb], status: 'completed', count: 4, results: [
        { knowledge_id: ids.doc1, knowledge_base_id: ids.kb, match_snippet: 'Economy class\nfor flights ![chart](https://x/y.png) under six hours', content: 'full chunk one' },
        { knowledge_id: ids.doc1, knowledge_base_id: ids.kb, match_snippet: 'second chunk', content: 'second' },
        { knowledge_id: ids.doc2, knowledge_base_id: ids.kb, content: 'x'.repeat(500) },
        { knowledge_id: ids.doc3, knowledge_base_id: ids.other, content: 'foreign knowledge base' },
      ] };
    } else if (body.params.name === 'read_document') {
      assert.equal(body.params.arguments.metadata_only, true);
      value = { document: documents[body.params.arguments.knowledge_id], knowledge_base: { id: ids.kb, name: 'Travel Handbook' } };
    } else {
      return reply(response, 200, { jsonrpc: '2.0', id: body.id, result: { content: [], isError: true } });
    }
    return reply(response, 200, { jsonrpc: '2.0', id: body.id, result: { content: [], structuredContent: value } });
  });
  const origin = await listen(upstream);
  const config = { bindingId: ids.binding, tenantId: ids.tenant, nativeKnowledgeBaseId: ids.kb,
    nativeMcpUrl: `${origin}/mcp/native`, nativeMcpBearerFile: nativeSecretFile,
    actionTokenIssuer: origin, actionTokenAudience: 'knowledge-test', actionTokenJwksFile: jwks,
    corePepUrl: `${origin}/service/v1/adapter/pep_check`, oidcTokenUrl: `${origin}/token`,
    oidcClientId: 'binding-client', oidcClientSecretFile: oidcSecretFile,
    timeoutMs: 5000, maxBodyBytes: 65536, listenHost: '127.0.0.1', listenPort: 1 };
  const adapter = createAdapter(config);
  const endpoint = await listen(adapter);
  t.after(async () => {
    adapter.closeAllConnections(); upstream.closeAllConnections();
    await new Promise(resolve => adapter.close(resolve));
    await new Promise(resolve => upstream.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const body = (overrides = {}) => ({ idempotencyKey: randomUUID(), limit: 10, locale: 'EN', query: 'travel',
    resources: [{ resourceId: randomUUID(), nativeType: 'knowledge_base', nativeId: ids.kb }], ...overrides });
  const token = (args, claims = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const value = { iss: origin, aud: 'knowledge-test', iat: now - 1, exp: now + 59, jti: randomUUID(),
      token_use: 'COMPONENT_SEARCH', tenant_id: ids.tenant, binding_id: ids.binding, actor_principal_id: randomUUID(),
      projection_generation: 4, authorization_min_zed_token: 'zed',
      normalized_parameter_hash: createHash('sha256').update(canonical(args)).digest('hex'), ...claims };
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'core', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${header}.${payload}.${sign('sha256', Buffer.from(`${header}.${payload}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  };
  const invoke = (args, options = {}) => fetch(`${endpoint}/platform-adapter/v1/search`, {
    method: 'POST',
    headers: { authorization: `Bearer ${options.token ?? token(args, options.claims)}`, 'content-type': 'application/json',
      'idempotency-key': options.key ?? args.idempotencyKey, ...(options.headers ?? {}) },
    body: options.raw ?? canonical(args),
  });
  // Plain node:http so browser-only headers (Origin, Cookie) are sent as given.
  const post = (args, headers) => new Promise((resolve, reject) => {
    const raw = canonical(args);
    const outgoing = httpRequest(`${endpoint}/platform-adapter/v1/search`, { method: 'POST', headers: {
      authorization: `Bearer ${token(args)}`, 'content-type': 'application/json',
      'idempotency-key': args.idempotencyKey, 'content-length': Buffer.byteLength(raw), ...headers } }, (answer) => {
      answer.resume();
      answer.on('end', () => resolve(answer.statusCode));
    });
    outgoing.on('error', reject);
    outgoing.end(raw);
  });
  return { ids, state, body, token, invoke, post };
}

test('search returns the bound knowledge base and its documents with native page paths', async t => {
  const f = await fixture(t);
  const args = f.body();
  const response = await f.invoke(args);
  assert.equal(response.status, 200);
  const { results } = await response.json();
  assert.deepEqual(results.map(item => item.kind), ['KNOWLEDGE_BASE', 'DOCUMENT', 'DOCUMENT']);
  assert.deepEqual(results[0], { kind: 'KNOWLEDGE_BASE', title: 'Travel Handbook', summary: 'Company travel rules',
    path: `/platform/knowledge-bases/${f.ids.kb}`, updatedAt: new Date(REVISION).toISOString() });
  assert.equal(results[1].title, 'Travel policy 2026');
  assert.equal(results[1].path, `/platform/knowledge-bases/${f.ids.kb}?knowledge_id=${f.ids.doc1}`);
  assert.equal(results[1].summary, 'Economy class for flights under six hours');
  assert.equal(results[2].title, 'per-diem.md', 'the file name stands in for a blank title');
  assert.ok([...results[2].summary].length <= 200);
  for (const item of results) assert.ok(componentPath(item.path), item.path);
  assert.ok(!JSON.stringify(results).includes(f.ids.doc3), 'hits of another knowledge base are dropped');
  // Only read-only native tools, scoped to the bound knowledge base, with the
  // Search Token and the exact body as the native action proof; no PEP call.
  assert.deepEqual(f.state.calls.map(call => call.name),
    ['list_knowledge_bases', 'search_knowledge', 'read_document', 'read_document']);
  assert.deepEqual(f.state.calls[1].arguments, { query: 'travel', knowledge_base_ids: [f.ids.kb] });
  for (const proof of f.state.proofs) {
    assert.deepEqual(Object.keys(proof).sort(), ['actionToken', 'argumentsJson', 'operation']);
    assert.equal(proof.operation, 'search');
    assert.equal(proof.argumentsJson, canonical(args));
  }
  assert.equal(f.state.peps, 0);
});

test('search honours the limit and omits the knowledge base when its name does not match', async t => {
  const f = await fixture(t);
  const response = await f.invoke(f.body({ query: 'flights', limit: 1 }));
  assert.equal(response.status, 200);
  const { results } = await response.json();
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, 'DOCUMENT');
});

test('resources outside the binding are ignored without touching the native service', async t => {
  const f = await fixture(t);
  for (const resources of [
    [{ resourceId: randomUUID(), nativeType: 'knowledge_base', nativeId: f.ids.other }],
    [{ resourceId: randomUUID(), nativeType: 'folder', nativeId: f.ids.kb }],
  ]) {
    const response = await f.invoke(f.body({ resources }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { results: [] });
  }
  assert.equal(f.state.calls.length, 0);
});

test('a Search Token for another binding, body or use is refused with 401', async t => {
  const f = await fixture(t);
  for (const claims of [{ binding_id: randomUUID() }, { tenant_id: randomUUID() }, { token_use: 'ACTION' },
    { normalized_parameter_hash: 'f'.repeat(64) }, { action_key: 'knowledge.search@v3' },
    { exp: Math.floor(Date.now() / 1000) + 300 }, { aud: 'other-adapter' }]) {
    const response = await f.invoke(f.body(), { claims });
    assert.equal(response.status, 401, JSON.stringify(claims));
  }
  const args = f.body();
  const other = f.body({ query: 'salaries' });
  assert.equal((await f.invoke(args, { token: f.token(other) })).status, 401, 'token of another body');
  assert.equal(f.state.calls.length, 0);
});

test('a malformed body is refused with 400 and browser contexts with 403', async t => {
  const f = await fixture(t);
  const args = f.body();
  assert.equal((await f.invoke(args, { key: randomUUID() })).status, 400, 'Idempotency-Key must match');
  assert.equal((await f.invoke(args, { raw: JSON.stringify(args, null, 1) })).status, 400, 'body must be canonical');
  assert.equal((await f.invoke(f.body({ limit: 21 }))).status, 400);
  assert.equal((await f.invoke(f.body({ query: ' padded ' }))).status, 400);
  assert.equal(f.state.calls.length, 0);
  assert.equal(await f.post(args, {}), 200, 'the same request without browser context is served');
  const before = f.state.calls.length;
  assert.equal(await f.post(args, { origin: 'https://kailo.example' }), 403);
  assert.equal(await f.post(args, { cookie: 'session=1' }), 403);
  assert.equal(f.state.calls.length, before);
});

test('paths and snippets are sanitised', () => {
  const kb = randomUUID();
  assert.equal(knowledgeBasePath(kb), `/platform/knowledge-bases/${kb}`);
  const odd = 'a b/../?token=x';
  assert.ok(componentPath(knowledgeBasePath(odd)), 'ids are encoded into one path segment');
  assert.ok(componentPath(documentPath(kb, odd)), 'the document id cannot inject a credential query');
  assert.equal(new URL(documentPath(kb, odd), 'https://x.invalid').searchParams.get('token'), null);
  assert.equal(snippet('a\u0000b\n\n<b>c</b> ![img](http://x/y.png) d'), 'a b c d');
  const long = snippet('字'.repeat(300));
  assert.equal([...long].length, 200);
  assert.ok(long.endsWith('…'));
  assert.equal(snippet(undefined), '');
});
