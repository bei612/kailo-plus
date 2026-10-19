// node --test tools/component-release/conformance/seed-cells.test.mjs
// S3 uploads of the conformance seeds (seed-cells.mjs, seed-knowledge.mjs via
// cells-s3.mjs) against a local stand-in for the Cells gateway behind its own
// proxy, which overwrites Host with the external host (CELLS_EXTERNAL) before
// the gateway verifies SigV4. Placeholder credentials only.
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { externalOrigin, s3Put, sigv4 } from './cells-s3.mjs';

const ACCESS = 'placeholder-access-token';
const SECRET = 'gatewaysecret';
const EXTERNAL = 'https://files.example.test:8443';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();

// Independent SigV4 check as the gateway performs it after the proxy rewrote
// Host: canonical request rebuilt from the received request, host forced to
// the external host, every other signed header as received.
function gatewayAccepts(req, path, externalHost) {
  const match = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/
    .exec(req.headers.authorization ?? '');
  if (!match) return false;
  const [, access, day, region, signedList, signature] = match;
  const amzDate = req.headers['x-amz-date'] ?? '';
  if (access !== ACCESS || !amzDate.startsWith(day)) return false;
  const names = signedList.split(';');
  if (!names.includes('host')) return false;
  const seen = { ...req.headers, host: externalHost };
  const canonical = ['PUT', path, '', ...names.map((name) => `${name}:${String(seen[name] ?? '').trim()}`), '',
    signedList, req.headers['x-amz-content-sha256']].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  let key = hmac(`AWS4${SECRET}`, day);
  for (const part of [region, 's3', 'aws4_request']) key = hmac(key, part);
  return hmac(key, ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n')).toString('hex') === signature;
}

async function gateway(t) {
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const path = new URL(req.url, 'http://unused').pathname;
      const accepted = req.method === 'PUT' && gatewayAccepts(req, path, new URL(EXTERNAL).host);
      seen.push({ host: req.headers.host, path, accepted, body: Buffer.concat(chunks).toString('utf8'), meta: req.headers['x-amz-meta-create-resource-uuid'] });
      res.writeHead(accepted ? 200 : 403).end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { origin: new URL(`http://127.0.0.1:${server.address().port}`), seen };
}

const upload = (origin, external) => s3Put({ origin, external, path: '/io/kailo-binding/root/file-1.txt', body: 'hello',
  headers: { 'content-type': 'text/plain', 'x-amz-meta-create-resource-uuid': '6f1c2a52-6a39-4d1c-9a5e-0d4c2f1b7e10' },
  accessKey: ACCESS, secretKey: SECRET, signal: AbortSignal.timeout(5000) });

test('upload connects to the internal origin and is signed for the external host', async (t) => {
  const { origin, seen } = await gateway(t);
  assert.equal(await upload(origin, externalOrigin(EXTERNAL)), 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].host, origin.host, 'request must reach the internal address');
  assert.equal(seen[0].path, '/io/kailo-binding/root/file-1.txt');
  assert.equal(seen[0].body, 'hello');
  assert.equal(seen[0].meta, '6f1c2a52-6a39-4d1c-9a5e-0d4c2f1b7e10');
});

test('a signature for the internal host is refused by the gateway behind the proxy', async (t) => {
  const { origin, seen } = await gateway(t);
  assert.equal(await upload(origin, origin), 403);
  assert.equal(seen[0].accepted, false);
});

test('sigv4 uses the injected date and never sends Host itself', () => {
  const headers = sigv4('PUT', new URL('/io/ws/a.txt', EXTERNAL), { 'Content-Type': 'text/plain' }, ACCESS, SECRET, new Date('2026-10-19T12:00:00.123Z'));
  assert.equal(headers['x-amz-date'], '20261019T120000Z');
  assert.equal(headers.host, undefined);
  assert.match(headers.authorization, /Credential=placeholder-access-token\/20261019\/us-east-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
});

test('cellsExternal must be a bare http(s) origin', () => {
  assert.equal(externalOrigin('https://files.example.test').host, 'files.example.test');
  assert.equal(externalOrigin('http://cells.example:8443/').host, 'cells.example:8443');
  for (const refused of [undefined, '', 'files.example.test', 'ftp://files.example.test', 'https://user:pw@files.example.test',
    'https://files.example.test/cells', 'https://files.example.test/?a=1', 'https://files.example.test/#x', 'https://files.example.test?']) {
    assert.throws(() => externalOrigin(refused), TypeError, String(refused));
  }
});
