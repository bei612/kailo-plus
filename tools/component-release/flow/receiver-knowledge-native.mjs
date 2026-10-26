#!/usr/bin/env node
// DD-124/133: original WeKnora OIDC and native APIs, inside one isolated run.
// A directory-projected native admin can create a KB and MCP endpoint. It is
// deliberately not elevated to native Owner to mint an all-powerful API key.
import { existsSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { account, FlowError, launch, main, parseArgs, privateText, UUID } from './lib.mjs';

const fail = (message) => { throw new FlowError(message, 2); };
function atomic(path, value) {
  const next = `${path}.${randomBytes(8).toString('hex')}.next`;
  writeFileSync(next, value, { mode: 0o600, flag: 'wx' });
  renameSync(next, path);
}

await main(async () => {
  let lock;
  try {
    const args = parseArgs(process.argv.slice(2), ['input'], ['refresh-only']);
    const input = JSON.parse(privateText(args.input));
    const deployment = process.env.KAILO_DEPLOY_DIR;
    if (!/^\/volumes\/data\/kailo\/conformance\/runs\/[^/]+\/receiver\/apps\/deploy\/local$/.test(deployment ?? '')
        || realpathSync(deployment) !== deployment) fail('canonical isolated receiver deployment required');
    const root = deployment.split('/receiver/apps/')[0];
    if (typeof input.directory !== 'string' || !input.directory.startsWith(`${root}/`)
        || realpathSync(input.directory) !== input.directory || !lstatSync(input.directory).isDirectory()
        || (lstatSync(input.directory).mode & 0o077) || lstatSync(input.directory).uid !== process.getuid()) {
      fail('native knowledge state must belong to the isolated run');
    }
    const origin = new URL(input.origin);
    if (origin.origin !== input.origin || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1'
        || !origin.port || !/^kailo-receiver-[a-z0-9-]+$/.test(input.name ?? '')) fail('isolated native origin and run name required');
    const lockPath = join(input.directory, 'native-session.lock');
    try { mkdirSync(lockPath, { mode: 0o700 }); } catch { fail('native knowledge session is already being refreshed'); }
    lock = lockPath;
    const stateFile = join(input.directory, 'native.json'), tokenFile = join(input.directory, 'native.token');
    const refreshFile = join(input.directory, 'native.refresh');
    const previous = existsSync(stateFile) ? JSON.parse(privateText(stateFile)) : null;
    let token;
    const request = async (method, path, body, auth = true) => {
      const response = await fetch(new URL(path, origin), { method, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
      if (!response.ok) fail(`native knowledge ${method} request refused (${response.status})`);
      const value = await response.json();
      return value.data ?? value;
    };
    if (existsSync(refreshFile)) {
      const response = await fetch(new URL('/api/v1/auth/refresh', origin), { method: 'POST', redirect: 'error',
        signal: AbortSignal.timeout(30000), headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: privateText(refreshFile).trim() }) });
      if (response.ok) {
        const tokens = await response.json();
        if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string') fail('incomplete native refreshed session');
        token = tokens.access_token;
        atomic(refreshFile, tokens.refresh_token);
      }
    }
    if (!token) {
      const context = await (await launch()).newContext();
      try {
        const page = await context.newPage();
        await page.goto(`${origin.origin}/api/v1/auth/oidc/start`, { waitUntil: 'domcontentloaded' });
        const credentials = account('admin');
        await page.locator('#username').fill(credentials.user);
        await page.locator('#password').fill(credentials.pass);
        await page.locator('#kc-login').click();
        await page.waitForURL((url) => url.origin === origin.origin, { timeout: 60000 });
        await page.waitForFunction(() => Boolean(localStorage.getItem('weknora_token')), null, { timeout: 60000 });
        const tokens = await page.evaluate(() => ({ token: localStorage.getItem('weknora_token'), refresh: localStorage.getItem('weknora_refresh_token') }));
        if (!tokens.token || !tokens.refresh) fail('native OIDC returned no session');
        token = tokens.token;
        atomic(refreshFile, tokens.refresh);
      } finally { await context.close(); }
    }
    const identity = await request('GET', '/api/v1/auth/me');
    const user = identity.user?.id, tenant = identity.tenant?.id;
    if (!UUID.test(user ?? '') || !Number.isSafeInteger(tenant) || tenant <= 0
        || !identity.memberships?.some((m) => m.tenant_id === tenant && m.role === 'admin')) {
      fail('native session is not the directory-projected administrator');
    }
    if (previous && (previous.userId !== user || previous.tenantId !== tenant || previous.origin !== input.origin)) {
      fail('native knowledge identity changed');
    }
    atomic(tokenFile, token);
    if (args['refresh-only']) {
      if (!previous) fail('native identity has not been prepared');
      console.log(JSON.stringify({ step: 'receiver-knowledge-session', status: 'READY' }));
      return;
    }
    // Retain each confirmed identity before starting the next native mutation.
    // Partial progress is a resumable session, never proof of complete objects.
    const confirmed = { ...previous, origin: input.origin, userId: user, tenantId: tenant };
    const remember = () => atomic(stateFile, JSON.stringify(confirmed, null, 2) + '\n');
    remember();
    const rows = await request('GET', '/api/v1/knowledge-bases');
    if (!Array.isArray(rows)) fail('native knowledge base list is incomplete');
    const matching = rows.filter((row) => row.name === input.name);
    if (matching.length > 1) fail('ambiguous native knowledge base');
    if (previous?.knowledgeBaseId && !matching.length) fail('confirmed native knowledge base is missing; refusing to recreate it');
    // Receiver model delivery is scoped to tenant-owned native models. The
    // native-page builtins have another binding's key and cannot prove it.
    if (!input.models || Object.keys(input.models).sort().join(',') !== 'chat,embedding') fail('two receiver model declarations required');
    if (previous?.knowledgeBaseId && (!previous.models?.chat || !previous.models?.embedding)) fail('confirmed KB lacks receiver model identities; refusing to modify it');
    const models = await request('GET', '/api/v1/models');
    if (!Array.isArray(models)) fail('native model list is incomplete');
    confirmed.models ??= {};
    for (const [role, type] of [['chat', 'KnowledgeQA'], ['embedding', 'Embedding']]) {
      const declared = input.models[role];
      if (!declared || typeof declared.name !== 'string' || !declared.name.trim()
          || typeof declared.baseUrl !== 'string') fail('receiver model declaration incomplete');
      const url = new URL(declared.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
          || (role === 'embedding' && (!Number.isSafeInteger(declared.dimension) || declared.dimension <= 0))) {
        fail('receiver model endpoint or dimension is invalid');
      }
      const display = `${input.name}-${role}`;
      const foundModels = models.filter((model) => model.display_name === display);
      if (foundModels.length > 1) fail('ambiguous receiver native model');
      const prior = previous?.models?.[role];
      if (prior && !foundModels.length) fail('confirmed native model is missing; refusing to recreate it');
      const parameters = { base_url: declared.baseUrl, interface_type: 'openai', provider: 'generic',
        ...(role === 'embedding' ? { embedding_parameters: { dimension: declared.dimension } } : {}) };
      const model = foundModels[0] ?? await request('POST', '/api/v1/models', {
        name: declared.name, display_name: display, type, source: 'remote', parameters,
      });
      if (!UUID.test(model.id ?? '') || model.tenant_id !== tenant || model.is_builtin !== false
          || model.status !== 'active' || model.name !== declared.name || model.type !== type || model.source !== 'remote'
          || model.parameters?.base_url !== declared.baseUrl || model.parameters?.interface_type !== 'openai'
          || model.parameters?.provider !== 'generic' || (role === 'embedding' && model.parameters?.embedding_parameters?.dimension !== declared.dimension)
          || (prior && prior.nativeModelRef !== model.id)) fail('native model differs from this receiver');
      confirmed.models[role] = { nativeModelRef: model.id, name: declared.name, baseUrl: declared.baseUrl,
        ...(role === 'embedding' ? { dimension: declared.dimension } : {}) };
      remember();
    }
    const kb = matching[0] ?? await request('POST', '/api/v1/knowledge-bases', {
      name: input.name, type: 'document', embedding_model_id: confirmed.models.embedding.nativeModelRef, summary_model_id: confirmed.models.chat.nativeModelRef,
      chunking_config: { chunk_size: 512, chunk_overlap: 50, separators: ['\n\n', '\n'] },
    });
    if (!UUID.test(kb.id ?? '') || kb.tenant_id !== tenant || kb.embedding_model_id !== confirmed.models.embedding.nativeModelRef
        || kb.summary_model_id !== confirmed.models.chat.nativeModelRef || (previous?.knowledgeBaseId && previous.knowledgeBaseId !== kb.id)) {
      fail('native knowledge base differs from this run');
    }
    confirmed.knowledgeBaseId = kb.id;
    remember();
    const observationFile = join(input.directory, 'knowledge-base-observed.json');
    if (!existsSync(observationFile)) atomic(observationFile, JSON.stringify(kb, null, 2) + '\n');
    else if (JSON.parse(privateText(observationFile)).id !== kb.id) fail('native KB evidence belongs to another object');
    const endpoints = await request('GET', '/api/v1/mcp-endpoints');
    if (!Array.isArray(endpoints)) fail('native MCP endpoint list is incomplete');
    const found = endpoints.filter((row) => row.name === input.name);
    if (found.length > 1) fail('ambiguous native MCP endpoint');
    let endpoint = found[0];
    if (previous?.mcpEndpointId && !endpoint) fail('confirmed native MCP endpoint is missing; refusing to recreate it');
    const tools = ['search_knowledge', 'read_document', 'export_document', 'add_document', 'delete_document'];
    if (!endpoint) endpoint = await request('POST', '/api/v1/mcp-endpoints', {
      name: input.name, enabled: true, knowledge_base_ids: [kb.id], tools,
    });
    if (!UUID.test(endpoint.id ?? '') || endpoint.enabled !== true || endpoint.knowledge_base_ids?.length !== 1
        || endpoint.knowledge_base_ids[0] !== kb.id || endpoint.tenant_id !== tenant
        || JSON.stringify([...(endpoint.tools ?? [])].sort()) !== JSON.stringify([...tools].sort())
        || (previous?.mcpEndpointId && previous.mcpEndpointId !== endpoint.id)) {
      fail('native MCP endpoint scope differs from this run');
    }
    confirmed.mcpEndpointId = endpoint.id;
    remember();
    const bearerFile = join(input.directory, 'mcp-bearer');
    // Recover a lost one-time response only through the native rotate endpoint
    // on this exact isolated endpoint, never by extracting its stored hash.
    if (!existsSync(bearerFile) && !endpoint.token) endpoint = await request('POST', `/api/v1/mcp-endpoints/${endpoint.id}/rotate-token`);
    if (endpoint.token) atomic(bearerFile, endpoint.token);
    if (!privateText(bearerFile).trim()) fail('native MCP bearer is missing');
    console.log(JSON.stringify({ step: 'receiver-knowledge-native', status: 'READY' }));
  } catch (error) {
    throw error instanceof FlowError ? error : new FlowError('isolated native knowledge preparation failed; credential details are not logged');
  } finally {
    if (lock) rmSync(lock, { recursive: true });
  }
});
