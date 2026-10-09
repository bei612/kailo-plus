import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');

async function deliveredJson(path) {
  if (!path?.startsWith('/')) throw new Error('NATIVE_RESOURCE_EVIDENCE_UNAVAILABLE');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await file.stat()).isFile()) throw new Error('NATIVE_RESOURCE_EVIDENCE_UNAVAILABLE');
    return JSON.parse(await file.readFile('utf8'));
  } finally {
    await file.close();
  }
}

// Explicit operator invocation only. Read the original native database, never a
// browser's create response. Output the EXISTING adapter directory format for
// its existing delivery/Resource admission consumer; do not write either DB,
// issue grants, create an account, or replace the running directory in place.
export async function resourceEvidence(args, input = process.env) {
  const fail = () => { throw new Error('NATIVE_RESOURCE_EVIDENCE_UNAVAILABLE'); };
  const [typeKey, nativeType, nativeRef, evidenceRef] = args;
  if (args.length !== 4 || !['model', 'view'].includes(nativeType) ||
      ![typeKey, nativeRef, evidenceRef].every((value) => typeof value === 'string' && value && value.trim() === value) ||
      !/^[1-9][0-9]*$/.test(nativeRef) || !Number.isSafeInteger(Number(nativeRef))) fail();
  const paths = [input.WREN_PLATFORM_QUERY_CONFIG_FILE, input.WREN_PLATFORM_BINDING_CONFIG_FILE, input.APPLICATION_ADAPTER_DIRECTORY_FILE];
  const documents = await Promise.all(paths.map(deliveredJson));
  const [query, delivery, directory] = documents;
  const binding = delivery.binding;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!binding || binding.bindingId !== query.bindingId || binding.tenantId !== query.tenantId ||
      binding.workspaceId !== query.workspaceId || binding.nativeInstanceRef !== query.nativeInstanceRef ||
      binding.nativeScopeRef !== query.nativeScopeRef || binding.isolationMode !== 'DEDICATED_INSTANCE' ||
      query.nativeScopeRef !== String(query.projectId) || !Number.isSafeInteger(query.projectId) || query.projectId <= 0 ||
      !Number.isSafeInteger(query.requestTimeoutMs) || query.requestTimeoutMs <= 0 ||
      binding.configDigest !== digest(binding.normalizedConfig) || !/^[a-f0-9]{64}$/.test(delivery.artifactDigest) ||
      !/^[a-f0-9]{64}$/.test(query.projectConnectionDigest) || !Array.isArray(directory.adapters)) fail();
  if (['bindingId', 'tenantId', 'workspaceId', 'servicePrincipalId'].some((key) => !uuid.test(binding[key]))) fail();
  const adapters = directory.adapters.filter((value) => value.nativeInstanceRef === query.nativeInstanceRef && value.artifactDigest === delivery.artifactDigest);
  if (adapters.length !== 1 || adapters[0].adapterServiceRef !== binding.adapterServiceRef ||
      !binding.servicePrincipalId || !binding.tenantId || !binding.nativeInstanceRef) fail();
  const adapter = adapters[0];
  const allAdapters = [...directory.adapters, ...(directory.protocolPeers ?? [])];
  if (allAdapters.filter((value) => value.adapterServiceRef === adapter.adapterServiceRef).length !== 1) fail();
  const selected = adapter.bindings?.filter((value) => value.bindingId === query.bindingId);
  if (selected?.length !== 1) fail();
  const target = selected[0];
  for (const key of ['tenantId', 'workspaceId', 'servicePrincipalId', 'nativeScopeRef', 'configDigest', 'isolationMode']) {
    if (target[key] !== binding[key]) fail();
  }
  const identities = adapter.nativeHumanIdentities?.filter((value) => value.bindingId === query.bindingId);
  if (identities?.length !== 1 || identities[0].configDigest !== binding.configDigest ||
      !Number.isSafeInteger(identities[0].generation) || identities[0].generation <= 0) fail();
  if (target.nativeResources !== undefined && !Array.isArray(target.nativeResources)) fail();

  // Same database selection as the original Knex entry, but an evidence read
  // never falls back to a relative SQLite path or creates a missing database.
  if (input.DB_TYPE === 'pg' ? !input.PG_URL : !input.SQLITE_FILE?.startsWith('/')) fail();
  if (input.DB_TYPE !== 'pg' && input.DB_TYPE !== 'sqlite') fail();
  if (input.DB_TYPE === 'sqlite') {
    const file = await open(input.SQLITE_FILE, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { if (!(await file.stat()).isFile()) fail(); } finally { await file.close(); }
  }
  const knex = require('knex')(input.DB_TYPE === 'pg' ? {
    client: 'pg', connection: { connectionString: input.PG_URL,
      connectionTimeoutMillis: query.requestTimeoutMs, statement_timeout: query.requestTimeoutMs,
      query_timeout: query.requestTimeoutMs },
  } : {
    client: 'better-sqlite3', connection: { filename: input.SQLITE_FILE, options: { readonly: true } }, useNullAsDefault: true,
  });
  try {
    const reference = await knex.transaction(async (tx) => {
      if (input.DB_TYPE === 'pg') await tx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const project = await tx('project').where({ id: query.projectId }).first();
      if (!project || project.type !== 'POSTGRES') fail();
      const connectionInfo = typeof project.connection_info === 'string' ? JSON.parse(project.connection_info) : project.connection_info;
      if (digest({ type: project.type, connectionInfo, catalog: project.catalog, schema: project.schema }) !== query.projectConnectionDigest) fail();
      const object = await tx(nativeType).select('id', 'project_id').where({ id: Number(nativeRef), project_id: query.projectId }).first();
      if (!object || Number(object.id) !== Number(nativeRef) || object.project_id !== query.projectId) fail();
      const evidenceDigest = digest({
        adapterServiceRef: adapter.adapterServiceRef, artifactDigest: adapter.artifactDigest,
        nativeInstanceRef: query.nativeInstanceRef, nativeScopeRef: query.nativeScopeRef,
        bindingId: query.bindingId, configDigest: binding.configDigest,
        generation: identities[0].generation, projectConnectionDigest: query.projectConnectionDigest,
        typeKey, nativeType, nativeRef, evidenceRef,
      });
      return { typeKey, nativeType, nativeRef, evidenceRef, evidenceDigest };
    });
    // A rotated/replaced input must not publish an observation under an old
    // instance or generation. No full native row or credential is exported.
    const after = await Promise.all(paths.map(deliveredJson));
    if (canonical(after) !== canonical(documents)) fail();
    const prior = (target.nativeResources ?? []).filter((value) => value.nativeType === nativeType && value.nativeRef === nativeRef);
    if (prior.length > 1 || (prior.length === 1 && canonical(prior[0]) !== canonical(reference))) fail();
    if (!prior.length) target.nativeResources = [...(target.nativeResources ?? []), reference];
    return directory;
  } finally {
    await knex.destroy();
  }
}

// Native DATA_KEY delivery only. This does not read Core state or provision
// a native account. Do not rotate these keys without native re-encryption.
async function dataKey(path) {
  if (!path?.startsWith('/')) throw new Error('NATIVE_DATA_KEY_UNAVAILABLE');
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
      throw new Error('NATIVE_DATA_KEY_UNAVAILABLE');
    }
    const value = (await file.readFile('utf8')).replace(/\r?\n$/, '');
    if (!value || /[\x00-\x1f\x7f]/.test(value)) {
      throw new Error('NATIVE_DATA_KEY_UNAVAILABLE');
    }
    return value;
  } catch {
    throw new Error('NATIVE_DATA_KEY_UNAVAILABLE');
  } finally {
    await file?.close();
  }
}

export async function nativeEnvironment(input = process.env) {
  if (!input.WREN_NATIVE_IDENTITY_JSON) {
    throw new Error('NATIVE_STARTUP_CONFIGURATION_REQUIRED');
  }
  // Identity claims remain verified by the existing middleware on each request.
  // File delivery overrides rather than retaining a stale inline key.
  return {
    ...input,
    ENCRYPTION_PASSWORD: await dataKey(input.WREN_ENCRYPTION_PASSWORD_FILE),
    ENCRYPTION_SALT: await dataKey(input.WREN_ENCRYPTION_SALT_FILE),
  };
}

async function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' });
    let stopped;
    const interrupt = () => { stopped = 130; child.kill('SIGINT'); };
    const terminate = () => { stopped = 143; child.kill('SIGTERM'); };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    const cleanup = () => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    };
    child.once('error', () => { cleanup(); reject(new Error('NATIVE_START_FAILED')); });
    child.once('exit', (code) => { cleanup(); resolve(stopped ?? code ?? 1); });
  });
}

export async function start(input = process.env, execute = run) {
  const env = await nativeEnvironment(input);
  // The original native Knex migration owns the Wren database. A failure must
  // never continue into Next. Nothing here connects to a platform database.
  const migrated = await execute('node', ['node_modules/knex/bin/cli.js', 'migrate:latest'], env);
  if (migrated !== 0) return migrated;
  return execute('node', ['server.js'], env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === 'resource-evidence') {
      process.stdout.write(`${JSON.stringify(await resourceEvidence(process.argv.slice(3)))}\n`);
    } else if (process.argv.length === 2) {
      process.exitCode = await start();
    } else {
      throw new Error('NATIVE_STARTUP_CONFIGURATION_REQUIRED');
    }
  } catch {
    // Never print a filesystem error, environment or key value.
    console.error('NATIVE_STARTUP_FAILED');
    process.exitCode = 1;
  }
}
