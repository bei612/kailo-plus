// DD-138(5), .design/07 §4.8.4 / §5.2: the read-only `search` operation of the
// REMOTE_ADAPTER release. Core already did the HUMAN's fresh `read` per
// Resource; this adapter searches only inside the native nodes named by
// resources[] that lie beneath this binding's fixed native root, with the
// original Cells REST v2 Lookup (basename search). It returns names, the
// parent folder and the Cells page route only: no content, ContentReference,
// presigned URL or credential. No Core PEP call, no ActionExecution.
import { Refused, object, nonempty, fixedUrl, secret, searchArguments, verifySearchToken,
  searchResponse } from '../../../client-kit/adapter/protocol.mjs';
import { nativeJsonFetch } from './native-actor.mjs';

export const SEARCH_PATH = '/platform-adapter/v1/search';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Native workspace of a Kailo Workspace (common/auth NativeOIDCWorkspaceRoleID,
// 07 §4.7.4): slug kailo-ws-<id>, rooted on <binding root>/<id>.
const KAILO_WORKSPACE_SLUG = 'kailo-ws-';
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RECYCLE_BIN = 'recycle_bin';

function flagged(node) {
  for (const flag of ['IsRecycled', 'IsRecycleBin', 'IsDraft']) {
    if (node[flag] !== undefined && typeof node[flag] !== 'boolean') return true;
    if (node[flag] === true) return true;
  }
  return false;
}

function nodePath(node) {
  if (!object(node) || !UUID.test(node.Uuid ?? '') || !['COLLECTION', 'LEAF'].includes(node.Type)
    || !nonempty(node.Path) || /[\\\x00-\x1f]/.test(node.Path)) return undefined;
  const path = node.Path.replace(/\/$/, '');
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return undefined;
  return path;
}

function route(slug, segments) {
  return `/ws-${encodeURIComponent(slug)}${segments.map((segment) => `/${encodeURIComponent(segment)}`).join('')}`;
}

// The Cells web route (MainRouter.js / WorkspaceRouter.js: /ws-<slug>/<path>)
// a Kailo member opens for a node beneath the binding root. A first segment
// that is a Kailo Workspace id is that Workspace's own native workspace;
// anything else is addressed through the binding workspace itself.
export function nativePagePath(rootPath, bindingSlug, path) {
  if (!SLUG.test(bindingSlug ?? '')) return undefined;
  if (path === rootPath) return route(bindingSlug, []);
  if (!path.startsWith(`${rootPath}/`)) return undefined;
  const segments = path.slice(rootPath.length + 1).split('/');
  if (segments.some((segment) => !segment)) return undefined;
  if (UUID.test(segments[0])) return route(`${KAILO_WORKSPACE_SLUG}${segments[0].toLowerCase()}`, segments.slice(1));
  return route(bindingSlug, segments);
}

// Parent folder as the member sees it (a Kailo Workspace id segment is that
// Workspace's root, shown as "/").
function parentSummary(rootPath, path) {
  const segments = path.slice(rootPath.length + 1).split('/').slice(0, -1);
  if (segments.length && UUID.test(segments[0])) segments.shift();
  return `/${segments.join('/')}`;
}

function updatedAt(node) {
  const raw = node.Modified;
  const seconds = typeof raw === 'string' && /^[1-9][0-9]{0,11}$/.test(raw) ? Number(raw)
    : Number.isSafeInteger(raw) && raw > 0 ? raw : undefined;
  return seconds === undefined ? undefined : new Date(seconds * 1000).toISOString();
}

function result(node, rootPath, slug) {
  const path = nodePath(node);
  if (path === undefined || flagged(node) || path === rootPath) return undefined;
  if (path.split('/').includes(RECYCLE_BIN)) return undefined;
  // A Kailo Workspace's own root folder is named by its id, not a user name.
  const relative = path.slice(rootPath.length + 1);
  if (!relative.includes('/') && UUID.test(relative)) return undefined;
  const page = nativePagePath(rootPath, slug, path);
  if (page === undefined) return undefined;
  const value = { kind: node.Type === 'COLLECTION' ? 'FOLDER' : 'FILE', title: path.slice(path.lastIndexOf('/') + 1),
    summary: parentSummary(rootPath, path), path: page };
  const at = updatedAt(node);
  if (at !== undefined) value.updatedAt = at;
  return value;
}

export async function nativeSearch(config, deadline, raw, key, token) {
  const args = searchArguments(raw, key);
  await verifySearchToken(token, config, args);
  const base = fixedUrl(config.cellsRestBaseUrl);
  base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
  const headers = { authorization: `Bearer ${await secret(config.cellsBearerFile)}`, 'content-type': 'application/json' };
  // Explicit WithMetaDefaults: no presigned URL fallback (service-list.mjs).
  const getNode = (id) => nativeJsonFetch(config, deadline, new URL(`n/node/${id}?Flags=WithMetaDefaults`, base), { headers });
  const root = await getNode(config.nativeRootRef);
  const rootPath = nodePath(root);
  if (rootPath === undefined || root.Uuid !== config.nativeRootRef || root.Type !== 'COLLECTION' || flagged(root)
    || root.ContextWorkspace?.Uuid !== config.nativeWorkspaceId || !SLUG.test(root.ContextWorkspace?.Slug ?? '')) {
    throw new Refused(503);
  }
  const slug = root.ContextWorkspace.Slug;
  const needle = args.query.toLocaleLowerCase();
  // Only UUID native refs can name a node of this binding; anything else is
  // another component's or another binding's object and is ignored.
  const wanted = [...new Set(args.resources.map((item) => item.nativeId).filter((id) => UUID.test(id)))];
  let failures = 0;
  const found = await Promise.all(wanted.map(async (id) => {
    let node;
    try { node = await getNode(id); } catch { failures += 1; return []; }
    const path = nodePath(node);
    // Outside this binding's native root/workspace: not ours, ignored.
    if (path === undefined || node.Uuid.toLowerCase() !== id.toLowerCase() || flagged(node)
      || (node.ContextWorkspace !== undefined && node.ContextWorkspace?.Uuid !== config.nativeWorkspaceId)
      || (path !== rootPath && !path.startsWith(`${rootPath}/`))) return [];
    if (node.Type === 'LEAF') {
      const hit = result(node, rootPath, slug);
      return hit && hit.title.toLocaleLowerCase().includes(needle) ? [hit] : [];
    }
    let response;
    try {
      response = await nativeJsonFetch(config, deadline, new URL('n/nodes', base), {
        method: 'POST', headers, body: JSON.stringify({ Scope: { Root: { Uuid: node.Uuid }, Recursive: true },
          Filters: { Text: { Term: args.query } }, Offset: 0, Limit: args.limit, Flags: ['WithMetaDefaults'] }),
      });
    } catch { failures += 1; return []; }
    const nodes = object(response) && response.Nodes === undefined ? [] : response?.Nodes;
    if (!Array.isArray(nodes)) { failures += 1; return []; }
    return nodes.map((child) => {
      const childPath = nodePath(child);
      return childPath !== undefined && childPath.startsWith(`${path}/`) ? result(child, rootPath, slug) : undefined;
    }).filter(Boolean);
  }));
  // Every named native object unreadable is an unavailable source, not "no hit".
  if (wanted.length > 0 && failures === wanted.length) throw new Refused(503);
  const seen = new Set();
  const results = found.flat().filter((item) => !seen.has(item.path) && seen.add(item.path));
  return searchResponse(results, args.limit);
}
