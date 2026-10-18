#!/usr/bin/env node
// Render the controlled ApplicationAdapterDirectory (DD-94 deployment delivery,
// contracts/domain/application_adapter_directory.schema.json) consumed by Core
// through APPLICATION_ADAPTER_DIRECTORY_FILE (deploy/local/.env.example).
//
// Inputs are deployment facts only: adapter service reference, in-network
// base/MCP URL, native instance, binding SERVICE principal and the component's
// isolated OpenBao AppRole. artifactDigest and actionTokenAudience are never
// typed in: they are read from the rendered release (render.mjs output) so the
// directory cannot disagree with the approved manifest's adapterBuildRef and
// executionConnector.actionTokenAudience (Core Adapter::resolve). Each secret
// reader's audience is that same service audience: binding SecretRefs written
// by the governed application_binding.create action carry it.
//
// This file is not a Catalog, binding registry or authorization source.
//
// Usage (Node >= 20, stdlib only):
//   node tools/component-release/adapter-directory.mjs --input <filled template.json> \
//     [--existing <current directory.json>] --out <directory.json>
// The input shape is tools/component-release/adapter-directory.template.json.
// With --existing, adapters with other adapterServiceRefs and protocolPeers are
// preserved unchanged; an entry with the same adapterServiceRef is replaced.
// The output is create-only (an existing identical file is accepted).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INPUT_KEYS = ['component', 'release', 'adapterServiceRef', 'baseUrl', 'nativeInstanceRef',
  'timeoutSeconds', 'maxResponseBytes', 'secretReaders'];
const OPTIONAL_KEYS = ['mcpUrl', 'modelCredentialDeliveries', 'nativeHumanIdentities', 'bindings'];
const COMPONENTS = new Set(['file-storage', 'knowledge', 'data-query']);

function fail(message) {
  process.stderr.write(`adapter-directory: ${message}\n`);
  process.exit(2);
}

function args(argv) {
  const known = new Set(['--input', '--existing', '--out']);
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!known.has(argv[i]) || argv[i + 1] === undefined || Object.hasOwn(out, argv[i])) fail(`invalid argument ${argv[i]}`);
    out[argv[i]] = argv[i + 1];
  }
  if (!out['--input'] || !out['--out']) fail('--input and --out are required');
  return out;
}

const nonempty = (value) => typeof value === 'string' && value.length > 0 && value.trim() === value && !value.includes('{{');
const positive = (value) => Number.isSafeInteger(value) && value > 0;

// Same URL constraints as Core Adapter::resolve / mcp_url.
function url(value, field, rootPath) {
  if (!nonempty(value)) fail(`${field} missing`);
  let parsed;
  try { parsed = new URL(value); } catch { fail(`${field} is not a URL`); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password
    || parsed.search || parsed.hash || value.includes('?') || value.includes('#')
    || (rootPath && parsed.pathname !== '/')) {
    fail(`${field} must be http(s) without credentials, query or fragment${rootPath ? ' and with path "/"' : ''}`);
  }
  return value;
}

function release(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const connector = manifest.executionConnector ?? {};
  if (connector.mode !== 'REMOTE_ADAPTER' || connector.adapterProtocolRange !== '1'
    || !nonempty(connector.actionTokenAudience) || connector.actionTokenAudience === 'NONE'
    || !/^[0-9a-f]{64}$/.test(manifest.adapterBuildRef ?? '')) {
    fail(`${dir} is not a rendered REMOTE_ADAPTER release (run render.mjs first)`);
  }
  return manifest;
}

function entry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('adapter input must be an object');
  const keys = Object.keys(input);
  if (INPUT_KEYS.some((key) => !keys.includes(key)) || keys.some((key) => !INPUT_KEYS.includes(key) && !OPTIONAL_KEYS.includes(key))) {
    fail(`adapter input keys must be ${INPUT_KEYS.join(',')} (+ optional ${OPTIONAL_KEYS.join(',')})`);
  }
  if (!COMPONENTS.has(input.component)) fail(`unknown component ${input.component}`);
  for (const key of ['release', 'adapterServiceRef', 'nativeInstanceRef']) if (!nonempty(input[key])) fail(`${key} missing`);
  if (!positive(input.timeoutSeconds) || !positive(input.maxResponseBytes)) fail('timeoutSeconds/maxResponseBytes must be positive integers');
  const manifest = release(resolve(input.release));
  const audience = manifest.executionConnector.actionTokenAudience;
  if (!Array.isArray(input.secretReaders) || input.secretReaders.length === 0) fail('secretReaders must be non-empty');
  const principals = new Set();
  const secretReaders = input.secretReaders.map((reader) => {
    if (!reader || Object.keys(reader).sort().join(',') !== 'roleName,servicePrincipalId'
      || !UUID.test(reader.servicePrincipalId) || !nonempty(reader.roleName) || principals.has(reader.servicePrincipalId)) {
      fail('each secret reader needs exactly a unique lowercase servicePrincipalId uuid and roleName');
    }
    principals.add(reader.servicePrincipalId);
    return { servicePrincipalId: reader.servicePrincipalId, roleName: reader.roleName, audience };
  });
  const out = {
    adapterServiceRef: input.adapterServiceRef,
    baseUrl: url(input.baseUrl, 'baseUrl', true),
    nativeInstanceRef: input.nativeInstanceRef,
    artifactDigest: manifest.adapterBuildRef,
    actionTokenAudience: audience,
    timeoutSeconds: input.timeoutSeconds,
    maxResponseBytes: input.maxResponseBytes,
    secretReaders,
  };
  if (input.mcpUrl !== undefined) out.mcpUrl = url(input.mcpUrl, 'mcpUrl', false);
  // Pre-existing controlled facts are carried verbatim; Core validates them.
  for (const key of ['modelCredentialDeliveries', 'nativeHumanIdentities', 'bindings']) {
    if (input[key] === undefined) continue;
    if (!Array.isArray(input[key]) || (key === 'bindings' && input[key].length === 0)) fail(`${key} must be an array (bindings: omit instead of empty)`);
    out[key] = input[key];
  }
  if (JSON.stringify(out).includes('{{')) fail(`unfilled template value in ${input.adapterServiceRef}`);
  return out;
}

function main() {
  const options = args(process.argv.slice(2));
  const input = JSON.parse(readFileSync(options['--input'], 'utf8'));
  if (!input || Object.keys(input).join(',') !== 'adapters' || !Array.isArray(input.adapters) || input.adapters.length === 0) {
    fail('input must be {"adapters":[...]}');
  }
  const rendered = input.adapters.map(entry);
  const existing = options['--existing'] ? JSON.parse(readFileSync(options['--existing'], 'utf8')) : { adapters: [] };
  if (!Array.isArray(existing.adapters) || Object.keys(existing).some((key) => !['adapters', 'protocolPeers'].includes(key))) {
    fail('existing directory has an unexpected shape');
  }
  const replaced = new Set(rendered.map((item) => item.adapterServiceRef));
  const directory = { adapters: [...existing.adapters.filter((item) => !replaced.has(item?.adapterServiceRef)), ...rendered] };
  if (existing.protocolPeers !== undefined) directory.protocolPeers = existing.protocolPeers;
  // Core rejects a directory where any adapterServiceRef repeats, including across protocolPeers.
  const refs = [...directory.adapters, ...(directory.protocolPeers ?? [])].map((item) => item?.adapterServiceRef);
  if (refs.some((ref) => !nonempty(ref)) || new Set(refs).size !== refs.length) fail('adapterServiceRef must be unique across adapters and protocolPeers');
  const text = `${JSON.stringify(directory, null, 2)}\n`;
  const out = resolve(options['--out']);
  if (existsSync(out)) {
    if (readFileSync(out, 'utf8') !== text) fail(`${out} exists with different content; write a new file and switch the delivery`);
  } else {
    writeFileSync(out, text, { mode: 0o644, flag: 'wx' });
  }
  process.stdout.write(`${JSON.stringify({ out, adapters: directory.adapters.map((item) => item.adapterServiceRef) })}\n`);
}

main();
