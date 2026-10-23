// DD-138(5), .design/07 §4.8.4 / §5.2: the read-only `search` operation of the
// REMOTE_ADAPTER release. Core already did the HUMAN's fresh `read` per
// Resource; this adapter searches only the one knowledge base of its binding,
// and only when resources[] names it. It uses the original native MCP tools
// (search_knowledge, read_document metadata_only, list_knowledge_bases) and
// returns titles, a short snippet and the native page route only: no content
// beyond the snippet, no ContentReference, no credential. No Core PEP call and
// no ActionExecution: the bound native endpoint verifies the same Search Token
// and request body itself (internal/mcpserver/platform_search.go).
import { Refused, object, searchArguments, verifySearchToken,
  searchResponse } from '../../../client-kit/adapter/protocol.mjs';

export const SEARCH_PATH = '/platform-adapter/v1/search';
export const SEARCH_OPERATION = 'search';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// The knowledge base Resource of this binding as Core names it (native type
// of the projected knowledge.base Resource; the resource type key is accepted
// as an alias). Entries of any other type or id are not this binding's.
const KNOWLEDGE_BASE_TYPES = new Set(['knowledge_base', 'knowledge.base']);
const SNIPPET_MAX = 200;

// Native page routes (frontend/src/router): the knowledge base page, opening
// one document through its knowledge_id query.
export function knowledgeBasePath(kbId) {
  return `/platform/knowledge-bases/${encodeURIComponent(kbId)}`;
}

export function documentPath(kbId, documentId) {
  return `${knowledgeBasePath(kbId)}?knowledge_id=${encodeURIComponent(documentId)}`;
}

// A short plain-text snippet: images and markup-only noise dropped, control
// characters and whitespace collapsed, at most 200 characters.
export function snippet(value) {
  if (typeof value !== 'string') return '';
  const text = value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/<[^>]{1,200}>/g, ' ')
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...text];
  return chars.length > SNIPPET_MAX ? `${chars.slice(0, SNIPPET_MAX - 1).join('').trimEnd()}…` : text;
}

function revision(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && !value.startsWith('0001-')
    ? value : undefined;
}

// raw is the exact request body; key the Idempotency-Key header; nativeTool
// the adapter's client of the original native MCP endpoint.
export async function nativeSearch(config, deadline, raw, key, token, nativeTool) {
  const args = searchArguments(raw, key);
  await verifySearchToken(token, config, args);
  const kbId = config.nativeKnowledgeBaseId;
  // Search only inside the native objects named by resources[] that belong
  // to this binding; anything else is ignored, not an error.
  if (!args.resources.some((item) => item.nativeId === kbId && KNOWLEDGE_BASE_TYPES.has(item.nativeType))) {
    return searchResponse([], args.limit);
  }
  const results = [];
  const listed = await nativeTool(config, deadline, 'list_knowledge_bases', {});
  if (!Array.isArray(listed.knowledge_bases)) throw new Refused(503);
  const kb = listed.knowledge_bases.find((item) => item?.id === kbId);
  if (!object(kb)) return searchResponse([], args.limit);
  const needle = args.query.toLocaleLowerCase();
  if (typeof kb.name === 'string' && kb.name.toLocaleLowerCase().includes(needle)) {
    results.push({ kind: 'KNOWLEDGE_BASE', title: kb.name, path: knowledgeBasePath(kbId),
      ...(snippet(kb.description) ? { summary: snippet(kb.description) } : {}),
      ...(revision(kb.native_revision) ? { updatedAt: kb.native_revision } : {}) });
  }
  const found = await nativeTool(config, deadline, 'search_knowledge', {
    query: args.query, knowledge_base_ids: [kbId],
  });
  if (!Array.isArray(found.results)) throw new Refused(503);
  // One result per document, in native rank order; the first hit's snippet.
  const documents = new Map();
  for (const hit of found.results) {
    if (!object(hit) || hit.knowledge_base_id !== kbId || !UUID.test(hit.knowledge_id ?? '')) continue;
    if (!documents.has(hit.knowledge_id)) {
      documents.set(hit.knowledge_id, snippet(snippet(hit.match_snippet) ? hit.match_snippet : hit.content));
    }
    if (documents.size >= args.limit) break;
  }
  for (const [documentId, summary] of documents) {
    if (results.length >= args.limit) break;
    // A document removed since the search is skipped, not a failed search.
    let metadata;
    try {
      metadata = await nativeTool(config, deadline, 'read_document', { knowledge_id: documentId, metadata_only: true });
    } catch {
      continue;
    }
    const document = metadata.document;
    if (!object(document) || document.id !== documentId || metadata.knowledge_base?.id !== kbId) continue;
    const title = [document.title, document.file_name]
      .map((value) => (typeof value === 'string' ? value.trim() : '')).find(Boolean);
    if (!title) continue;
    results.push({ kind: 'DOCUMENT', title, path: documentPath(kbId, documentId),
      ...(summary ? { summary } : {}),
      ...(revision(document.native_revision) ? { updatedAt: document.native_revision } : {}) });
  }
  return searchResponse(results, args.limit);
}
