// AWS SigV4 (UNSIGNED-PAYLOAD) uploads through the Cells S3 gateway (/io/...),
// shared by seed-cells.mjs and seed-knowledge.mjs.
//
// The seeds reach Cells on an internal address (cellsOrigin, e.g.
// http://cells:8080), but Cells' own proxy overwrites the Host of every routed
// request with the host of the site's external URL
// (common/config/routing/proxies.go ResolveProxy: HeaderMod "Host" =
// ReverseProxyURL host, i.e. CELLS_EXTERNAL), so the gateway verifies the
// signature against that external host. A request is therefore signed for the
// external host and sent to the internal address with the same path.

import { createHash, createHmac } from 'node:crypto';

// The native external origin (CELLS_EXTERNAL): http(s), a host, nothing else.
export function externalOrigin(value) {
  let url;
  try { url = new URL(value); } catch { url = undefined; }
  if (typeof value !== 'string' || !url || !['http:', 'https:'].includes(url.protocol) || !url.hostname
    || url.username || url.password || !['', '/'].includes(url.pathname) || url.search || url.hash
    || value.includes('?') || value.includes('#')) {
    throw new TypeError('cellsExternal must be the native external origin (http(s)://host[:port])');
  }
  return new URL(url.origin);
}

// Headers for one request to url (url.host is the signed host; it is not sent:
// fetch derives Host from the URL it connects to).
export function sigv4(method, url, headers, accessKey, secretKey, now = new Date()) {
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const all = { ...headers, host: url.host, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD', 'x-amz-date': amzDate };
  const names = Object.keys(all).map((name) => name.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonicalUri = url.pathname.split('/').map((part) => encodeURIComponent(decodeURIComponent(part))).join('/');
  const request = [method, canonicalUri, '', ...names.map((name) => `${name}:${lower[name]}`), '', names.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
  const scope = `${day}/us-east-1/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(request).digest('hex')].join('\n');
  let key = Buffer.from(`AWS4${secretKey}`);
  for (const part of [day, 'us-east-1', 's3', 'aws4_request']) key = createHmac('sha256', key).update(part).digest();
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  const { host, ...sent } = lower;
  return { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
}

// PUT body at path (absolute, e.g. /io/<slug>/<file>) through the gateway:
// connected to origin, signed for external. Returns the HTTP status; the
// response body is discarded.
export async function s3Put({ origin, external, path, body, headers, accessKey, secretKey, signal, now }) {
  const target = new URL(path, origin);
  const signed = new URL(path, external);
  if (target.pathname !== signed.pathname || target.search || signed.search) throw new TypeError('S3 path must be an absolute path without query');
  const sent = sigv4('PUT', signed, headers, accessKey, secretKey, now);
  const response = await fetch(target, { method: 'PUT', redirect: 'manual', signal, headers: sent, body });
  await response.body?.cancel();
  return response.status;
}
