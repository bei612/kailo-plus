#!/usr/bin/env node
// Render one built-in reference ComponentRelease (DD-88/94, design 07 §2.5/§3,
// 08 §9.1) from its checked-in material <component>/fork/release/ into the exact
// ComponentReleaseRegistration input. Digests are never copied by hand: the
// adapter digest comes from <component>/fork/upstream.yaml (or an explicit
// build receipt), and the schema/manifest digests are recomputed here with
// the same canonical JSON as collab_bridge::limits::canonical_json.
//
// This only prepares bytes. Registration, conformance and approval remain the
// governed component_release.register / component_release.approve actions.
//
// Usage (Node >= 20, stdlib only, run from the apps repository root):
//   node tools/component-release/render.mjs --component file-storage \
//     --source-commit <40-hex> --native-page-origin http://192.168.0.193:58092 \
//     [--adapter-digest sha256:<64-hex>|<64-hex>] [--receipt <file.json>] --out <dir>
//
// --receipt accepts either {"<artifact-name>": "sha256:..."} or
// {"artifacts":[{"name":"<artifact-name>","artifact_digest":"sha256:..."}]}.
// Output files (create-only; an existing identical file is accepted):
//   manifest.json, package.json, binding-config.schema.json, registration.json
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Fixed namespace for deterministic release IDs: uuidv5(NS, "<type>@<version>").
// A changed source commit, digest or declaration with an unchanged version is
// refused by Core (TargetStateConflict); bump the version for a new release.
const RELEASE_NAMESPACE = '434ca4dc-c43a-4816-874e-f72e5a7b57b8';

// The REMOTE_ADAPTER runtime artifact of each built-in reference component.
// Wren serves Adapter Protocol v1 from its native UI (/platform-adapter/v1/*).
const COMPONENTS = {
  'file-storage': { adapterArtifact: 'file-storage-adapter' },
  knowledge: { adapterArtifact: 'knowledge-adapter' },
  'data-query': { adapterArtifact: 'data-query-ui' },
};

const PLACEHOLDER = /^\{\{[A-Za-z]+\}\}$/;

function fail(message) {
  process.stderr.write(`render: ${message}\n`);
  process.exit(2);
}

function args(argv) {
  const known = new Set(['--component', '--source-commit', '--native-page-origin', '--adapter-digest', '--receipt', '--out']);
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!known.has(argv[i]) || argv[i + 1] === undefined || Object.hasOwn(out, argv[i])) fail(`invalid argument ${argv[i]}`);
    out[argv[i]] = argv[i + 1];
  }
  for (const key of ['--component', '--source-commit', '--native-page-origin', '--out']) {
    if (!out[key]) fail(`missing ${key}`);
  }
  return out;
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isSafeInteger(value)) fail('non-integer number in release material');
  return JSON.stringify(value);
}

export const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');

export function uuidv5(namespace, name) {
  const ns = Buffer.from(namespace.replaceAll('-', ''), 'hex');
  const bytes = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function bareDigest(value, source) {
  const match = /^(?:sha256:)?([0-9a-f]{64})$/.exec(String(value ?? '').trim());
  if (!match) fail(`${source} has no usable artifact digest (got ${JSON.stringify(value ?? null)})`);
  return match[1];
}

// Minimal scan of the fixed upstream.yaml artifact list: "- name: X" opens an
// entry; its "artifact_digest:" line closes the lookup. No YAML evaluation.
export function upstreamDigest(text, artifact) {
  let current = null;
  for (const line of text.split('\n')) {
    const name = /^\s*-\s+name:\s*(\S+)\s*$/.exec(line);
    if (name) { current = name[1]; continue; }
    const value = /^\s+artifact_digest:\s*(\S+)\s*$/.exec(line);
    if (value && current === artifact) return value[1];
  }
  return undefined;
}

function receiptDigest(path, artifact) {
  const receipt = JSON.parse(readFileSync(path, 'utf8'));
  if (Array.isArray(receipt?.artifacts)) {
    const rows = receipt.artifacts.filter((row) => row?.name === artifact);
    if (rows.length !== 1) fail(`receipt does not contain exactly one ${artifact}`);
    return rows[0].artifact_digest;
  }
  return receipt?.[artifact];
}

function origin(value) {
  let url;
  try { url = new URL(value); } catch { fail('native page origin is not a URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin !== value) {
    fail('native page origin must be an exact http(s) origin without path, query or credentials');
  }
  return value;
}

function fill(value, values) {
  if (Array.isArray(value)) return value.map((item) => fill(item, values));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item, values)]));
  }
  if (typeof value === 'string' && PLACEHOLDER.test(value)) {
    const key = value.slice(2, -2);
    if (!Object.hasOwn(values, key)) return value;
    return values[key];
  }
  return value;
}

function leftover(value, path = '$') {
  if (Array.isArray(value)) return value.flatMap((item, index) => leftover(item, `${path}[${index}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => leftover(item, `${path}.${key}`));
  return typeof value === 'string' && value.includes('{{') ? [path] : [];
}

function writeCreateOnly(path, text) {
  if (existsSync(path)) {
    if (readFileSync(path, 'utf8') !== text) fail(`${path} exists with different content; choose a new --out`);
    return;
  }
  writeFileSync(path, text, { mode: 0o644, flag: 'wx' });
}

function main() {
  const options = args(process.argv.slice(2));
  const component = options['--component'];
  const fixed = COMPONENTS[component];
  if (!fixed) fail(`unknown component ${component}`);
  const commit = options['--source-commit'];
  if (!/^[0-9a-f]{40}$/.test(commit)) fail('source commit must be the exact 40-hex apps commit the artifacts were built from');
  const read = (name) => JSON.parse(readFileSync(join(component, 'fork', 'release', name), 'utf8'));
  const manifestTemplate = read('manifest.json');
  const packageTemplate = read('package.json');
  const config = read('binding-config.schema.json');
  if (leftover(config).length) fail('binding config schema must not contain placeholders');

  let adapter = options['--adapter-digest'];
  let source = '--adapter-digest';
  if (adapter === undefined && options['--receipt']) {
    adapter = receiptDigest(options['--receipt'], fixed.adapterArtifact);
    source = `receipt ${fixed.adapterArtifact}`;
  }
  if (adapter === undefined) {
    adapter = upstreamDigest(readFileSync(join(component, 'fork', 'upstream.yaml'), 'utf8'), fixed.adapterArtifact);
    source = `${component}/fork/upstream.yaml ${fixed.adapterArtifact}`;
  }
  const adapterBuildRef = bareDigest(adapter, source);

  if (manifestTemplate.admissionPath !== 'BUILTIN_REFERENCE' || 'vendor' in manifestTemplate || 'artifactVersion' in manifestTemplate) {
    fail('built-in reference material must declare BUILTIN_REFERENCE without vendor/artifactVersion');
  }
  const releaseId = uuidv5(RELEASE_NAMESPACE, `${manifestTemplate.componentTypeKey}@${manifestTemplate.version}`);
  const manifest = fill(manifestTemplate, {
    releaseId, sourceCommit: commit, nativePageOrigin: origin(options['--native-page-origin']),
    adapterBuildRef, bindingConfigSchemaDigest: digest(config),
  });
  const unresolved = leftover(manifest);
  if (unresolved.length) fail(`manifest placeholders left: ${unresolved.join(', ')}`);
  const pkg = fill(packageTemplate, { releaseId, manifestDigest: digest(manifest) });
  const left = leftover(pkg);
  if (left.length) fail(`package placeholders left: ${left.join(', ')}`);
  if (pkg.componentReleaseId !== manifest.id || pkg.backendDelivery !== 'EXTERNAL_SERVICE'
    || !Array.isArray(pkg.webArtifacts) || pkg.webArtifacts.length !== 0) fail('package does not match manifest');

  const out = resolve(options['--out']);
  mkdirSync(out, { recursive: true, mode: 0o755 });
  const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;
  writeCreateOnly(join(out, 'manifest.json'), pretty(manifest));
  writeCreateOnly(join(out, 'package.json'), pretty(pkg));
  writeCreateOnly(join(out, 'binding-config.schema.json'), pretty(config));
  // Exact ComponentReleaseRegistration: three JSON strings, nothing else.
  writeCreateOnly(join(out, 'registration.json'), pretty({
    manifestJson: JSON.stringify(manifest), packageJson: JSON.stringify(pkg), bindingConfigSchemaJson: JSON.stringify(config),
  }));
  process.stdout.write(`${JSON.stringify({ component, releaseId, componentTypeKey: manifest.componentTypeKey,
    version: manifest.version, adapterBuildRef, manifestDigest: pkg.manifestDigest, packageDigest: digest(pkg),
    bindingConfigSchemaDigest: manifest.bindingConfigSchemaDigest, out })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
