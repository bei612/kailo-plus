// DD-95/103, SS-CEL-WOPI: this is the same binding adapter's execute consumer,
// not another editor, native token store, or platform tool registry.
import { extname } from 'node:path';
import { Refused, object, exactKeys, nonempty, canonical, fixedUrl, boundedBody,
  verifyToken, freshPep, nativeDocumentTarget, secret } from './query-revision.mjs';

function origin(value) {
  const url = fixedUrl(value);
  if (url.pathname !== '/' || url.origin !== value) throw new Refused(503);
  return value;
}

export function documentConfiguration(value) {
  if (!exactKeys(value, ['cellsPublicOrigin', 'documentServerOrigin'])) throw new Refused(503);
  return Object.freeze({ cellsPublicOrigin: origin(value.cellsPublicOrigin),
    documentServerOrigin: origin(value.documentServerOrigin) });
}

function launchInput(raw, key) {
  let args;
  try { args = JSON.parse(raw); } catch { throw new Refused(400); }
  if (!exactKeys(args, ['protocolSessionId', 'reference', 'authorizationTargetNativeRef', 'admittedMode', 'theme', 'locale', 'expiresAt', 'idempotencyKey'])
    || args.protocolSessionId !== key || args.idempotencyKey !== key
    || !['VIEW', 'EDIT'].includes(args.admittedMode) || !['LIGHT', 'DARK'].includes(args.theme)
    || !['en', 'zh-CN'].includes(args.locale) || !nonempty(args.expiresAt)
    || !Number.isFinite(Date.parse(args.expiresAt)) || Date.parse(args.expiresAt) <= Date.now()
    || !nonempty(args.authorizationTargetNativeRef)
    || !object(args.reference) || !nonempty(args.reference.nativeObjectRef)
    || !nonempty(args.reference.nativeRevision) || raw !== canonical(args)) throw new Refused(400);
  return args;
}

async function response(config, deadline, url, options) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Refused(503);
  try {
    const result = await fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(remaining) });
    if (!result.ok || !result.body) { await result.body?.cancel(); throw new Refused(503); }
    return { headers: result.headers, body: await boundedBody(result.body, config.maxBodyBytes) };
  } catch { throw new Refused(503); }
}

async function discoveryAction(config, deadline, path, mode) {
  const extension = extname(path).slice(1).toLowerCase();
  if (!extension || !/^[a-z0-9]+$/.test(extension)) throw new Refused(403);
  const discovery = await response(config, deadline,
    new URL('/hosting/discovery', config.documentLaunch.documentServerOrigin), {});
  // The fixed native discovery is XML; use the adapter's locked XML parser,
  // never regex or a user-picked URL.
  if (/<!DOCTYPE|<!ENTITY/i.test(discovery.body)) throw new Refused(503);
  let parsed;
  try {
    const { parseStringPromise } = await import('xml2js');
    parsed = await parseStringPromise(discovery.body, { strict: true, explicitArray: true });
  } catch { throw new Refused(503); }
  const zones = parsed?.['wopi-discovery']?.['net-zone'];
  if (!Array.isArray(zones)) throw new Refused(503);
  const wanted = mode === 'EDIT' ? 'edit' : 'view';
  const actions = zones.flatMap((zone) => Array.isArray(zone.app) ? zone.app : [])
    .flatMap((app) => Array.isArray(app.action) ? app.action : [])
    .filter((action) => action?.$?.ext === extension && action.$.name === wanted);
  if (actions.length !== 1 || !nonempty(actions[0].$.urlsrc)) throw new Refused(503);
  // ONLYOFFICE's existing discovery urlsrc is a fixed /hosting/wopi action,
  // with protocol parameter placeholders. Their values come only from this
  // adapter's admitted Session; no URL, host or access token comes from input.
  // Fixed server d6df308acb9877a9365c741b30741de96202816e,
  // wopiClient.js::discovery builds these entity-escaped placeholders itself.
  // Accept its native XML representation, not an arbitrary template grammar.
  const placeholders = new Set(['rs=DC_LLCC&', 'dchat=DISABLE_CHAT&', 'embed=EMBEDDED&',
    'fs=FULLSCREEN&', 'hid=HOST_SESSION_ID&', 'rec=RECORDING&', 'sc=SESSION_CONTEXT&',
    'thm=THEME_ID&', 'ui=UI_LLCC&', 'wopisrc=WOPI_SOURCE&']);
  const decoded = actions[0].$.urlsrc.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  const template = decoded.replace(/<([^<>]*)>/g, (_, value) => {
    if (!placeholders.has(value)) throw new Refused(503);
    return '';
  });
  if (/[<>]/.test(template)) throw new Refused(503);
  const url = new URL(template);
  if (url.origin !== config.documentLaunch.documentServerOrigin
    || !/^\/hosting\/wopi\/(word|cell|slide|pdf|diagram)\/(view|edit)$/.test(url.pathname)
    || !url.pathname.endsWith(`/${wanted}`) || url.username || url.password || url.hash
    || [...url.searchParams.keys()].some((key) => !['ui', 'lang', 'thm', 'dchat', 'wopisrc', 'usid'].includes(key.toLowerCase()))) {
    throw new Refused(503);
  }
  return url;
}

export async function launchDocument(config, deadline, raw, key, token) {
  if (config.documentLaunch === undefined) throw new Refused(503);
  const args = launchInput(raw, key);
  const claims = await verifyToken(token, config, args, 'execute');
  if (claims.agent_principal_id !== undefined || claims.action_execution_id !== args.protocolSessionId
    || (claims.action_key === 'file_storage.open_edit@v1' ? args.admittedMode !== 'EDIT' : args.admittedMode !== 'VIEW')) {
    throw new Refused(401);
  }
  await freshPep(config, deadline, token, args, claims, 'execute');
  // The native document token producer independently resolves exact VersionId
  // under the projected HUMAN's native ACL. A head query is not historical
  // existence proof and never substitutes the frozen reference's revision.
  const native = await nativeDocumentTarget(config, deadline,
    { nativeObjectRef: args.reference.nativeObjectRef, authorizationTargetNativeRef: args.authorizationTargetNativeRef }, claims);
  if (args.admittedMode === 'EDIT' && native.head !== args.reference.nativeRevision) throw new Refused(409);
  const action = await discoveryAction(config, deadline, native.path, args.admittedMode);
  const bearer = await secret(config.cellsBearerFile);
  const base = fixedUrl(config.cellsRestBaseUrl);
  base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
  // This POST is issued once by Core's OPENING/UNKNOWN dispatch fence. It must
  // never be retried by the adapter after a missing ACK. The original native
  // PAT UUID/revocation key is the Session UUID, not another token authority.
  const created = await response(config, deadline, new URL('auth/token/document', base), {
    method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ Path: native.path, ClientID: args.protocolSessionId }),
  });
  let tokenValue;
  try { tokenValue = JSON.parse(created.body); } catch { throw new Refused(503); }
  const nativeRef = created.headers.get('x-kailo-native-session-ref');
  if (!exactKeys(tokenValue, ['AccessToken']) || !nonempty(tokenValue.AccessToken)
    || /[\r\n]/.test(tokenValue.AccessToken) || nativeRef !== args.protocolSessionId
    || Date.parse(args.expiresAt) <= Date.now()) throw new Refused(503);
  const current = await verifyToken(token, config, args, 'execute');
  await freshPep(config, deadline, token, args, current, 'execute');
  // Standard form POST: the PAT appears only in form_fields, never the URL.
  action.searchParams.set('wopisrc', `${config.documentLaunch.cellsPublicOrigin}/wopi/files/${args.reference.nativeObjectRef}`);
  action.searchParams.set('usid', args.protocolSessionId);
  action.searchParams.set('thm', args.theme === 'DARK' ? '2' : '1');
  const language = args.locale === 'zh-CN' ? 'zh-CN' : 'en-US';
  action.searchParams.set('ui', language); action.searchParams.set('lang', language);
  action.searchParams.set('dchat', '1');
  const descriptor = { method: 'POST', actionUrl: action.toString(),
    formFields: { access_token: tokenValue.AccessToken, access_token_ttl: String(Date.parse(args.expiresAt)) },
    editorOrigin: config.documentLaunch.documentServerOrigin, expiresAt: args.expiresAt };
  const observed = new Date().toISOString();
  return { execution: { idempotencyKey: key, nativeType: 'document.pat', nativeId: nativeRef,
    nativeStatus: 'CREATED', platformStatus: 'SUCCEEDED', cancelCapability: 'SUPPORTED',
    lastObservedAt: observed, terminalAt: observed },
  resultJson: JSON.stringify({ nativeSessionRef: nativeRef, launchDescriptor: descriptor }) };
}
