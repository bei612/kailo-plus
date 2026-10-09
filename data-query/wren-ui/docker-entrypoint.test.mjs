import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nativeEnvironment, start, resourceEvidence } from './docker-entrypoint.mjs';

const directories = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'wren-native-start-'));
  directories.push(directory);
  const password = join(directory, 'password');
  const salt = join(directory, 'salt');
  await writeFile(password, 'fixture-password-'.repeat(3) + '\n', { mode: 0o400 });
  await writeFile(salt, 'fixture-salt-'.repeat(3) + '\n', { mode: 0o400 });
  return {
    WREN_NATIVE_IDENTITY_JSON: '{"issuer":"https://issuer.example"}',
    DB_TYPE: 'sqlite',
    SQLITE_FILE: '/app/data/db.sqlite3',
    WREN_ENCRYPTION_PASSWORD_FILE: password,
    WREN_ENCRYPTION_SALT_FILE: salt,
  };
}

test('loads only explicit file keys then runs original migration before standalone server', async () => {
  const env = await fixture();
  const calls = [];
  assert.equal(await start({ ...env, ENCRYPTION_PASSWORD: 'old-inline' }, async (command, args, delivered) => {
    calls.push([command, args]);
    assert.equal(delivered.ENCRYPTION_PASSWORD, 'fixture-password-'.repeat(3));
    assert.equal(delivered.ENCRYPTION_SALT, 'fixture-salt-'.repeat(3));
    assert.equal(delivered.SQLITE_FILE, '/app/data/db.sqlite3');
    return 0;
  }), 0);
  assert.deepEqual(calls, [
    ['node', ['node_modules/knex/bin/cli.js', 'migrate:latest']],
    ['node', ['server.js']],
  ]);
});

test('failed native migration never starts server or changes its exit', async () => {
  let calls = 0;
  assert.equal(await start(await fixture(), async () => { calls++; return 7; }), 7);
  assert.equal(calls, 1);
});

test('missing identity cannot start', async () => {
  const env = await fixture();
  for (const invalid of [
    { ...env, WREN_NATIVE_IDENTITY_JSON: '' },
  ]) {
    let called = false;
    await assert.rejects(start(invalid, async () => { called = true; }), /NATIVE_STARTUP_CONFIGURATION_REQUIRED/);
    assert.equal(called, false);
  }
});

test('native database and network settings pass unchanged to original Knex and Next', async () => {
  const env = await fixture();
  const require = createRequire(import.meta.url);
  for (const configured of [
    { DB_TYPE: 'pg', PG_URL: 'postgres://fixture@native-db/wren', HOSTNAME: '127.0.0.1', PORT: '3100' },
    { DB_TYPE: 'sqlite', SQLITE_FILE: '/native/custom/db.sqlite3', HOSTNAME: '::', PORT: '3200' },
  ]) {
    let calls = 0;
    await start({ ...env, ...configured }, async (_command, _args, delivered) => {
      calls++;
      for (const [key, value] of Object.entries(configured)) assert.equal(delivered[key], value);
      const original = process.env;
      try {
        process.env = delivered;
        delete require.cache[require.resolve('./knexfile.js')];
        const knex = require('./knexfile.js');
        assert.equal(knex.client, configured.DB_TYPE === 'pg' ? 'pg' : 'better-sqlite3');
        assert.equal(knex.connection, configured.PG_URL ?? configured.SQLITE_FILE);
      } finally {
        process.env = original;
      }
      return 0;
    });
    assert.equal(calls, 2);
  }
  const delivered = await nativeEnvironment(env);
  assert.equal(delivered.HOSTNAME, undefined);
  assert.equal(delivered.PORT, undefined);
});

test('DATA_KEY input has no invented PBKDF2 passphrase length restriction', async () => {
  const env = await fixture();
  for (const value of ['short', 'a'.repeat(4097)]) {
    await chmod(env.WREN_ENCRYPTION_PASSWORD_FILE, 0o600);
    await writeFile(env.WREN_ENCRYPTION_PASSWORD_FILE, value);
    await chmod(env.WREN_ENCRYPTION_PASSWORD_FILE, 0o400);
    assert.equal((await nativeEnvironment(env)).ENCRYPTION_PASSWORD, value);
  }
});

test('missing, empty, control-character and readable-by-others keys fail before migration', async () => {
  const env = await fixture();
  for (const value of ['', 'a'.repeat(32) + '\n' + 'b']) {
    await chmod(env.WREN_ENCRYPTION_PASSWORD_FILE, 0o600);
    await writeFile(env.WREN_ENCRYPTION_PASSWORD_FILE, value, { mode: 0o400 });
    await chmod(env.WREN_ENCRYPTION_PASSWORD_FILE, 0o400);
    await assert.rejects(nativeEnvironment(env), /^Error: NATIVE_DATA_KEY_UNAVAILABLE$/);
  }
  await chmod(env.WREN_ENCRYPTION_PASSWORD_FILE, 0o600);
  await writeFile(env.WREN_ENCRYPTION_PASSWORD_FILE, 'a'.repeat(32));
  await chmod(env.WREN_ENCRYPTION_PASSWORD_FILE, 0o644);
  await assert.rejects(nativeEnvironment(env), /^Error: NATIVE_DATA_KEY_UNAVAILABLE$/);
  await rm(env.WREN_ENCRYPTION_PASSWORD_FILE);
  await assert.rejects(nativeEnvironment(env), /^Error: NATIVE_DATA_KEY_UNAVAILABLE$/);
});

test('symlinked delivery is rejected and key values do not enter failure details', async () => {
  const env = await fixture();
  await rm(env.WREN_ENCRYPTION_PASSWORD_FILE);
  await symlink(env.WREN_ENCRYPTION_SALT_FILE, env.WREN_ENCRYPTION_PASSWORD_FILE);
  await assert.rejects(nativeEnvironment(env), /^Error: NATIVE_DATA_KEY_UNAVAILABLE$/);
});

const require = createRequire(import.meta.url);
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');

async function referenceFixture() {
  const root = await mkdtemp(join(tmpdir(), 'wren-reference-'));
  directories.push(root);
  const env = { DB_TYPE: 'sqlite', SQLITE_FILE: join(root, 'native.sqlite'),
    WREN_PLATFORM_QUERY_CONFIG_FILE: join(root, 'query.json'),
    WREN_PLATFORM_BINDING_CONFIG_FILE: join(root, 'binding.json'),
    APPLICATION_ADAPTER_DIRECTORY_FILE: join(root, 'directory.json') };
  const knex = require('knex')({ client: 'better-sqlite3', connection: { filename: env.SQLITE_FILE }, useNullAsDefault: true });
  try {
    const connection = { password: 'native-secret-never-output' };
    await knex.transaction(async (tx) => {
      for (const migration of ['20240125070643_create_project_table', '20240530062133_update_project_table', '20240125071855_create_model_table', '20240129021453_create_view_table']) {
        await require(`./migrations/${migration}.js`).up(tx);
      }
      await tx('project').insert({ id: 3, type: 'POSTGRES', catalog: 'fixture-catalog', schema: 'fixture-schema', connection_info: JSON.stringify(connection) });
      await tx('model').insert([{ id: 5, project_id: 3, reference_name: 'native_model', ref_sql: 'private native body' }, { id: 9, project_id: 7, reference_name: 'other_scope' }]);
      await tx('view').insert({ id: 6, project_id: 3, name: 'native_view', statement: 'private view SQL' });
    });
    const query = { bindingId: '11111111-1111-4111-8111-111111111111', tenantId: '22222222-2222-4222-8222-222222222222',
      workspaceId: '33333333-3333-4333-8333-333333333333', nativeInstanceRef: 'fixture-instance', nativeScopeRef: '3', projectId: 3,
      requestTimeoutMs: 3000,
      projectConnectionDigest: digest({ type: 'POSTGRES', connectionInfo: connection, catalog: 'fixture-catalog', schema: 'fixture-schema' }) };
    const binding = { bindingId: query.bindingId, tenantId: query.tenantId, workspaceId: query.workspaceId,
      nativeInstanceRef: query.nativeInstanceRef, nativeScopeRef: query.nativeScopeRef, adapterServiceRef: 'fixture-adapter',
      servicePrincipalId: '44444444-4444-4444-8444-444444444444', normalizedConfig: {}, configDigest: digest({}), isolationMode: 'DEDICATED_INSTANCE' };
    const delivery = { binding, artifactDigest: 'a'.repeat(64) };
    const { normalizedConfig, nativeInstanceRef, adapterServiceRef, ...bindingReference } = binding;
    const publicFile = join(root, 'public.json');
    await writeFile(publicFile, JSON.stringify({ keys: [{ kty: 'EC', crv: 'P-256', kid: 'fixture', x: 'A'.repeat(43), y: 'A'.repeat(43) }] }));
    const directory = { adapters: [{ adapterServiceRef, nativeInstanceRef, artifactDigest: delivery.artifactDigest,
      baseUrl: 'https://adapter.invalid', actionTokenAudience: 'fixture-action', timeoutSeconds: 3, maxResponseBytes: 1024,
      secretReaders: [], bindings: [bindingReference], nativeHumanIdentities: [{ bindingId: query.bindingId, configDigest: binding.configDigest,
        generation: 2, identityProviderId: '55555555-5555-4555-8555-555555555555', audience: 'fixture-native', jwksFile: publicFile }] }] };
    const save = async () => {
      await writeFile(env.WREN_PLATFORM_QUERY_CONFIG_FILE, JSON.stringify(query));
      await writeFile(env.WREN_PLATFORM_BINDING_CONFIG_FILE, JSON.stringify(delivery));
      await writeFile(env.APPLICATION_ADAPTER_DIRECTORY_FILE, JSON.stringify(directory));
    };
    await save();
    return { env, query, delivery, directory, save };
  } finally {
    await knex.destroy();
  }
}

test('actual native model and view produce only existing directory reference facts, without native or directory writes', async () => {
  const { env, directory } = await referenceFixture();
  const before = await readFile(env.SQLITE_FILE);
  for (const [kind, id] of [['model', '5'], ['view', '6']]) {
    const result = await resourceEvidence(['component.fixture.model', kind, id, 'controlled-observation'], env);
    const resource = result.adapters[0].bindings[0].nativeResources[0];
    assert.deepEqual(Object.keys(resource).sort(), ['evidenceDigest', 'evidenceRef', 'nativeRef', 'nativeType', 'typeKey']);
    assert.equal(resource.nativeRef, id);
    assert.equal(resource.nativeType, kind);
    assert.match(resource.evidenceDigest, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(result), /native-secret-never-output|private native body|private view SQL/);
    assert.deepEqual(await readFile(env.SQLITE_FILE), before);
    assert.deepEqual(JSON.parse(await readFile(env.APPLICATION_ADAPTER_DIRECTORY_FILE, 'utf8')), directory);
    await writeFile(env.APPLICATION_ADAPTER_DIRECTORY_FILE, JSON.stringify(result));
    assert.deepEqual(await resourceEvidence(['component.fixture.model', kind, id, 'controlled-observation'], env), result);
    await writeFile(env.APPLICATION_ADAPTER_DIRECTORY_FILE, JSON.stringify(directory));
  }
});

test('absent and different-project native objects never become registration facts', async () => {
  const { env } = await referenceFixture();
  for (const id of ['9', '999']) await assert.rejects(resourceEvidence(['component.fixture.model', 'model', id, 'controlled-observation'], env));
  for (const id of ['0', '-1', '5 or 1=1', '9007199254740992']) await assert.rejects(resourceEvidence(['component.fixture.model', 'model', id, 'controlled-observation'], env));
  await assert.rejects(resourceEvidence(['component.fixture.model', 'project', '3', 'controlled-observation'], env));
});

test('changed connection, binding scope, instance, artifact, generation and duplicate directory owners refuse evidence', async () => {
  const changes = [
    ({ query }) => { query.projectConnectionDigest = 'b'.repeat(64); },
    ({ delivery }) => { delivery.binding.nativeScopeRef = '7'; },
    ({ directory }) => { directory.adapters[0].nativeInstanceRef = 'other-instance'; },
    ({ directory }) => { directory.adapters[0].artifactDigest = 'b'.repeat(64); },
    ({ directory }) => { directory.adapters[0].nativeHumanIdentities[0].generation = 0; },
    ({ directory }) => { directory.adapters[0].bindings[0].servicePrincipalId = 'other-principal'; },
    ({ directory }) => { directory.adapters.push(structuredClone(directory.adapters[0])); },
    ({ directory }) => { directory.adapters[0].bindings[0].nativeResources = [{ typeKey: 'component.fixture.model', nativeType: 'model', nativeRef: '5', evidenceRef: 'different', evidenceDigest: 'c'.repeat(64) }]; },
  ];
  const fixture = await referenceFixture();
  const original = structuredClone({ query: fixture.query, delivery: fixture.delivery, directory: fixture.directory });
  for (const change of changes) {
    for (const key of ['query', 'delivery', 'directory']) Object.assign(fixture[key], structuredClone(original[key]));
    change(fixture); await fixture.save();
    await assert.rejects(resourceEvidence(['component.fixture.model', 'model', '5', 'controlled-observation'], fixture.env));
  }
});

test('missing native database is not created; symlinked trusted input is refused', async () => {
  const { env } = await referenceFixture();
  const absent = env.SQLITE_FILE + '.absent';
  await assert.rejects(resourceEvidence(['component.fixture.model', 'model', '5', 'controlled-observation'], { ...env, SQLITE_FILE: absent }));
  await assert.rejects(readFile(absent), { code: 'ENOENT' });
  const link = env.WREN_PLATFORM_QUERY_CONFIG_FILE + '.link';
  await symlink(env.WREN_PLATFORM_QUERY_CONFIG_FILE, link);
  await assert.rejects(resourceEvidence(['component.fixture.model', 'model', '5', 'controlled-observation'], { ...env, WREN_PLATFORM_QUERY_CONFIG_FILE: link }));
});

test('original executable emits the existing directory for the Core delivery consumer', async () => {
  const { env } = await referenceFixture();
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./docker-entrypoint.mjs', import.meta.url)),
    'resource-evidence', 'component.fixture.model', 'model', '5', 'controlled-observation'],
  { env: { ...process.env, ...env }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout);
  assert.equal(observed.adapters[0].bindings[0].nativeResources[0].nativeRef, '5');
  const delivered = process.env.WREN_RESOURCE_EVIDENCE_TEST_RECEIPT ?? env.APPLICATION_ADAPTER_DIRECTORY_FILE + '.observed';
  await writeFile(delivered, result.stdout);
  assert.deepEqual(JSON.parse(await readFile(delivered, 'utf8')), observed);
  // Keep this isolated original database/config/public-key fixture only when
  // explicitly requested for the existing Core delivery verification step.
  if (process.env.WREN_RESOURCE_EVIDENCE_TEST_RECEIPT) {
    const index = directories.indexOf(env.SQLITE_FILE.slice(0, env.SQLITE_FILE.lastIndexOf('/')));
    assert.ok(index >= 0);
    directories.splice(index, 1);
  }
});
