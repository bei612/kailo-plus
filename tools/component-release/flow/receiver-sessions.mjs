#!/usr/bin/env node
// DD-124(4): real HUMAN sessions of the isolated receiver deployment. Uses the
// original Desktop/Mobile authorization-code + PKCE client and native gateway
// listener. No direct-access grant, forged Core header or production identity.
// --out is a private directory: identities.json is immutable; each token file
// is atomically refreshed only after /api/v1/session returns the same identity.
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { account, deployEnv, FlowError, launch, main, parseArgs, privateText, UUID } from './lib.mjs';

const fail = (message) => { throw new FlowError(message, 2); };
const identities = (session) => Object.fromEntries(['tenantId', 'humanIdentityId', 'tenantPrincipalId'].map((key) => [key, session[key]]));
function atomic(path, value) {
  const temp = `${path}.${randomBytes(8).toString('hex')}.next`;
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, value); } finally { closeSync(fd); }
  renameSync(temp, path);
}
async function tokenRequest(url, fields) {
  const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
  if (!response.ok) return null; // Do not log the provider body (may contain credentials).
  const result = await response.json();
  if (typeof result.access_token !== 'string' || !result.access_token || /\s/.test(result.access_token)
      || typeof result.refresh_token !== 'string' || !result.refresh_token) fail('isolated IdP returned incomplete tokens');
  return result;
}
async function authorize(name, issuer, clientId) {
  const verifier = randomBytes(48).toString('base64url'), state = randomBytes(32).toString('hex');
  // The existing native client's registered loopback redirect. Playwright
  // intercepts this exact URL; no listener or persistent callback server.
  const callback = 'http://127.0.0.1/kailo/receiver-conformance';
  const ctx = await (await launch()).newContext();
  try {
    const page = await ctx.newPage();
    let callbackUrl;
    await page.route(`${callback}**`, async (route) => {
      callbackUrl = new URL(route.request().url());
      await route.fulfill({ status: 200, contentType: 'text/plain', body: 'Isolated receiver authentication completed.' });
    });
    const query = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: callback,
      scope: 'openid profile email', state, code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url') });
    await page.goto(`${issuer}/protocol/openid-connect/auth?${query}`, { waitUntil: 'domcontentloaded' });
    const credentials = account(name);
    await page.locator('#username').fill(credentials.user);
    await page.locator('#password').fill(credentials.pass);
    await Promise.all([page.waitForURL((url) => url.href.startsWith(callback), { timeout: 60000 }), page.locator('#kc-login').click()]);
    if (!callbackUrl || callbackUrl.origin + callbackUrl.pathname !== callback
        || callbackUrl.searchParams.get('state') !== state || !callbackUrl.searchParams.get('code')
        || callbackUrl.searchParams.has('error')) fail(`${name}: isolated authorization callback refused`);
    const tokens = await tokenRequest(`${issuer}/protocol/openid-connect/token`, { grant_type: 'authorization_code',
      client_id: clientId, redirect_uri: callback, code_verifier: verifier, code: callbackUrl.searchParams.get('code') });
    if (!tokens) fail(`${name}: isolated authorization exchange refused`);
    return tokens;
  } finally { await ctx.close(); }
}

await main(async () => {
  try {
  const args = parseArgs(process.argv.slice(2), ['out']);
  const deployment = process.env.KAILO_DEPLOY_DIR, out = resolve(args.out ?? '');
  if (!args.out || !deployment || !/^\/volumes\/data\/kailo\/conformance\/runs\/[^/]+\/receiver\/apps\/deploy\/local$/.test(deployment)
      || realpathSync(deployment) !== deployment || !out.startsWith(deployment.split('/receiver/apps/')[0] + '/')) {
    fail('receiver sessions require the canonical isolated deployment and its own output directory');
  }
  const project = readFileSync(join(deployment, 'compose.yaml'), 'utf8').match(/^name: (kailo-receiver-[a-z0-9-]+)$/m)?.[1];
  if (!project) fail('receiver sessions require a dedicated receiver Compose project');
  const env = deployEnv('OIDC_HOST', 'KEYCLOAK_PORT', 'OIDC_REALM', 'OIDC_NATIVE_CLIENT_ID', 'AGENTGATEWAY_NATIVE_PORT', 'PUBLIC_BIND_ADDR');
  // deploy/local derives OIDC_ISSUER using shell interpolation; deployEnv reads
  // literal declarations only. Derive from its exact non-secret identity facts.
  const issuer = `http://${env.OIDC_HOST}:${env.KEYCLOAK_PORT}/realms/${env.OIDC_REALM}`;
  const issuerUrl = new URL(issuer);
  if (issuerUrl.hostname !== 'keycloak.kailo.local' || issuerUrl.protocol !== 'http:' || !issuerUrl.port
      || !/^[A-Za-z0-9_-]+$/.test(env.OIDC_REALM) || !env.OIDC_NATIVE_CLIENT_ID
      || !/^\d+$/.test(env.AGENTGATEWAY_NATIVE_PORT) || env.PUBLIC_BIND_ADDR !== '127.0.0.1') {
    fail('isolated native identity delivery is incomplete');
  }
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const info = lstatSync(out);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) || info.uid !== process.getuid() || realpathSync(out) !== out) {
    fail('session output must be a canonical owner-only directory');
  }
  const lock = join(out, '.refresh-lock');
  try { mkdirSync(lock, { mode: 0o700 }); } catch { fail('isolated session refresh is already running (or requires stale-lock investigation)'); }
  try {
    const identityFile = join(out, 'identities.json');
    const frozen = existsSync(identityFile) ? JSON.parse(privateText(identityFile)) : null;
    const observed = {};
    for (const [role, name] of [['human', 'admin'], ['catalog', 'platform-admin'], ['approver', 'kailo-platform-approver']]) {
      const refreshFile = join(out, `${role}.refresh.json`), tokenFile = join(out, `${role}.token`);
      let tokens;
      if (existsSync(refreshFile)) {
        const retained = JSON.parse(privateText(refreshFile));
        if (retained.issuer !== issuer || retained.clientId !== env.OIDC_NATIVE_CLIENT_ID) fail(`${role}: retained identity authority differs`);
        tokens = await tokenRequest(`${issuer}/protocol/openid-connect/token`, { grant_type: 'refresh_token',
          client_id: env.OIDC_NATIVE_CLIENT_ID, refresh_token: retained.refreshToken });
      }
      tokens ??= await authorize(name, issuer, env.OIDC_NATIVE_CLIENT_ID);
      const response = await fetch(`http://127.0.0.1:${env.AGENTGATEWAY_NATIVE_PORT}/api/v1/session`, {
        redirect: 'error', signal: AbortSignal.timeout(30000), headers: { authorization: `Bearer ${tokens.access_token}` } });
      if (!response.ok) fail(`${role}: isolated native session refused (${response.status})`);
      const session = await response.json();
      if (session.accessMode !== 'FULL' || Object.values(identities(session)).some((value) => !UUID.test(value ?? ''))) {
        fail(`${role}: isolated session is not an active HUMAN membership`);
      }
      observed[role] = identities(session);
      if (frozen && JSON.stringify(frozen[role]) !== JSON.stringify(observed[role])) fail(`${role}: isolated session identity changed`);
      atomic(refreshFile, JSON.stringify({ issuer, clientId: env.OIDC_NATIVE_CLIENT_ID, refreshToken: tokens.refresh_token }));
      atomic(tokenFile, tokens.access_token);
    }
    if (observed.human.tenantId === observed.catalog.tenantId || observed.catalog.tenantId !== observed.approver.tenantId
        || new Set(Object.values(observed).map((s) => s.humanIdentityId)).size !== 3
        || new Set(Object.values(observed).map((s) => s.tenantPrincipalId)).size !== 3) fail('isolated business/Catalog identities are not separated');
    if (!frozen) atomic(identityFile, JSON.stringify(observed, null, 2) + '\n');
    console.log(JSON.stringify({ step: 'receiver-sessions', status: 'READY', accounts: Object.keys(observed) }));
  } finally { rmSync(lock, { recursive: true }); }
  } catch (error) {
    // Browser/JSON errors may include a request URL or a retained credential
    // snippet. Only this entry's controlled refusal text reaches flow logs.
    throw error instanceof FlowError ? error : new FlowError('isolated session refresh failed; no credential details are logged');
  }
});
