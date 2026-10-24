// 07 §8A, DD-136(5): native steps of the unattended isolated Wren (data_query@2)
// conformance run, called by tools/component-release/conformance/auto_data_query.py
// inside the constrained Node SDK container (source at /src read-only, the installed
// data-query/wren-ui dependency tree of the same yarn.lock at /node_modules).
//
// Everything acts on the run's own isolated instance only, through its original
// native entries: the native identity of that instance is a key pair generated
// here (the public JWKS is what the instance's verifier fetches), the native
// service token passes the original JOSE middleware, onboarding is the original
// GraphQL saveDataSource/saveTables (whose deploy is the original DeployService),
// and the retained manifest is the original MDLService output checked against the
// hash DeployService stored. No credential or token is printed or logged; every
// secret is read from or written to an owner-only file named in the step config.
//
//   node wren-isolated.cjs keygen <dir>               -> <dir>/private.pem, <dir>/jwks.json
//   node wren-isolated.cjs sign <config.json>         -> config.out (one token)
//   node wren-isolated.cjs serve-jwks <jwks.json> <port>
//   node wren-isolated.cjs onboard <config.json>
//   node wren-isolated.cjs retain <config.json>       -> config.out (manifest record)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');

class Refused extends Error {}
const refuse = (message) => { throw new Refused(message); };

function ownerOnly(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.uid !== process.geteuid()) refuse(`${path.basename(file)}: owner-only regular file required`);
  return fs.readFileSync(file, 'utf8');
}
const json = (file) => JSON.parse(ownerOnly(file));
function writePrivate(file, text) {
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, file);
}
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const digest = (value) => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const parsed = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

function keygen(dir) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = crypto.createHash('sha256').update(publicKey.export({ format: 'der', type: 'spki' })).digest('hex').slice(0, 32);
  jwk.alg = 'ES256';
  jwk.use = 'sig';
  writePrivate(path.join(dir, 'private.pem'), privateKey.export({ format: 'pem', type: 'pkcs8' }));
  writePrivate(path.join(dir, 'jwks.json'), JSON.stringify({ keys: [jwk] }));
  return { kid: jwk.kid };
}

async function sign(config) {
  const { importPKCS8, SignJWT } = require('jose');
  const key = await importPKCS8(ownerOnly(config.privateKeyFile), 'ES256');
  const now = Math.floor(Date.now() / 1000);
  const claims = { [config.claim]: [config.value] };
  if (config.azp) claims.azp = config.azp;
  const token = await new SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: config.kid, typ: 'JWT' })
    .setIssuer(config.issuer).setAudience(config.audience).setSubject(config.subject)
    .setIssuedAt(now).setExpirationTime(now + config.seconds).setJti(crypto.randomUUID()).sign(key);
  writePrivate(config.out, token);
  return { token: path.basename(config.out), seconds: config.seconds };
}

function serveJwks(file, port) {
  const body = JSON.stringify(json(file));
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    if (request.method === 'GET' && request.url === '/jwks') response.end(body);
    else response.writeHead(404).end('{}');
  });
  server.listen(Number(port), '0.0.0.0');
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close(() => process.exit(0)));
}

async function graphql(config, token, document, variables) {
  const response = await fetch(config.graphqlUrl, {
    method: 'POST', redirect: 'error',
    headers: { authorization: `Bearer ${token}`, origin: config.publicOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({ query: document, variables }), signal: AbortSignal.timeout(config.timeoutMs),
  });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch { refuse(`GraphQL HTTP ${response.status}: no JSON answer`); }
  if (!response.ok || result.errors?.length || !result.data) {
    // Native error codes and messages name the failed field, never the bearer or the password.
    const errors = (result.errors ?? []).map((e) => e.extensions?.code ?? 'ERROR').join(',');
    refuse(`GraphQL HTTP ${response.status} ${errors}`);
  }
  return result.data;
}

async function onboard(config) {
  const token = ownerOnly(config.tokenFile).trim();
  const connection = json(config.connectionFile);
  const status = await graphql(config, token, 'query { onboardingStatus { status } }');
  if (status.onboardingStatus?.status !== 'NOT_STARTED') refuse(`onboarding already ${status.onboardingStatus?.status}; a run starts from a fresh instance`);
  await graphql(config, token, 'mutation Save($data: DataSourceInput!) { saveDataSource(data: $data) { type } }',
    { data: { type: 'POSTGRES', properties: { displayName: config.displayName, ...connection } } });
  const tables = await graphql(config, token, 'query { listDataSourceTables { name } }');
  const names = (tables.listDataSourceTables ?? []).map((t) => t.name);
  if (!names.includes(config.table)) refuse(`source table ${config.table} not listed by the native data source`);
  await graphql(config, token, 'mutation Tables($data: SaveTablesInput!) { saveTables(data: $data) }', { data: { tables: [config.table] } });
  return { onboarded: true, tables: names.length };
}

async function retain(config) {
  const knex = require('knex')({ client: 'pg', connection: { connectionString: ownerOnly(config.databaseUrlFile).trim() } });
  try {
    // Wait for the original deployment the native onboarding started (saveTables).
    const deadline = Date.now() + config.timeoutMs;
    let deployment;
    for (;;) {
      deployment = await knex('deploy_log').orderBy('id', 'desc').first();
      if (deployment && deployment.status !== 'IN_PROGRESS') break;
      if (Date.now() > deadline) refuse('the native deployment did not finish in time');
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    if (deployment.status !== 'SUCCESS') refuse(`the native deployment ended ${deployment.status}`);
    Object.assign(process.env, {
      DB_TYPE: 'pg', TELEMETRY_ENABLED: 'false', EXPERIMENTAL_ENGINE_RUST_VERSION: config.experimentalEngineRust,
      ENCRYPTION_PASSWORD: ownerOnly(config.encryptionPasswordFile).trim(),
      ENCRYPTION_SALT: ownerOnly(config.encryptionSaltFile).trim(),
    });
    const ts = require('typescript');
    const root = config.uiSourceRoot;
    process.env.TS_NODE_PROJECT = path.join(root, 'tsconfig.json');
    process.env.TS_NODE_TRANSPILE_ONLY = 'true';
    require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json'),
      compilerOptions: { module: 'commonjs' } });
    const paths = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile).config.compilerOptions.paths;
    require('tsconfig-paths').register({ baseUrl: root, paths });
    const { MDLService } = require('@server/services/mdlService');
    const { ProjectRepository } = require('@server/repositories/projectRepository');
    const { ModelRepository } = require('@server/repositories/modelRepository');
    const { ModelColumnRepository } = require('@server/repositories/modelColumnRepository');
    const { ModelNestedColumnRepository } = require('@server/repositories/modelNestedColumnRepository');
    const { RelationRepository } = require('@server/repositories/relationshipRepository');
    const { ViewRepository } = require('@server/repositories/viewRepository');
    const record = await knex.transaction(async (tx) => {
      await tx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const projects = await tx('project').orderBy('id');
      if (projects.length !== 1) refuse('expected exactly one native project');
      const project = projects[0];
      const models = await tx('model').where({ project_id: project.id }).orderBy('id');
      if (models.length !== 1) refuse('expected exactly one native model');
      const service = new MDLService({
        projectRepository: new ProjectRepository(tx), modelRepository: new ModelRepository(tx),
        modelColumnRepository: new ModelColumnRepository(tx), modelNestedColumnRepository: new ModelNestedColumnRepository(tx),
        relationRepository: new RelationRepository(tx), viewRepository: new ViewRepository(tx),
      });
      const { manifest, nativeObjectRefs } = await service.makeCurrentModelMDL();
      const hash = crypto.createHash('sha1').update(`${project.id} ${JSON.stringify(manifest)}`).digest('hex');
      const last = await tx('deploy_log').where({ project_id: project.id }).orderBy('id', 'desc').first();
      // The retained input must be byte-identical to what DeployService hashed.
      if (!last || last.hash !== hash || canonical(parsed(last.manifest)) !== canonical(manifest)) {
        refuse('the original MDL of the current model differs from the deployed manifest');
      }
      return { projectId: project.id, modelId: models[0].id, manifest, nativeObjectRefs, deploymentId: last.id,
        projectConnectionDigest: digest({ type: project.type, connectionInfo: parsed(project.connection_info),
          catalog: project.catalog, schema: project.schema }),
        connectionKeys: Object.keys(parsed(project.connection_info)).sort() };
    });
    writePrivate(config.out, JSON.stringify(record));
    return { projectId: record.projectId, modelId: record.modelId, deploymentId: record.deploymentId, models: record.manifest.models.length };
  } finally {
    await knex.destroy();
  }
}

(async () => {
  const [command, argument, extra] = process.argv.slice(2);
  let result;
  if (command === 'keygen') result = keygen(argument);
  else if (command === 'sign') result = await sign(json(argument));
  else if (command === 'serve-jwks') return serveJwks(argument, extra);
  else if (command === 'onboard') result = await onboard(json(argument));
  else if (command === 'retain') result = await retain(json(argument));
  else refuse('usage: wren-isolated.cjs keygen|sign|serve-jwks|onboard|retain');
  process.stdout.write(`${JSON.stringify(result)}\n`);
})().catch((error) => {
  process.stderr.write(`wren-isolated: ${error instanceof Refused ? error.message : `${error?.name ?? 'Error'} ${error?.code ?? ''}`}\n`);
  process.exitCode = 1;
});
