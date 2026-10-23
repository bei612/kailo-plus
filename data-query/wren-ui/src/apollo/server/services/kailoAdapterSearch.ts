import { Knex } from 'knex';
import { searchResponse } from '../../../../../../client-kit/adapter/protocol.mjs';
import type { NativeQueryDelivery } from './nativeQueryAdmission';

// DD-138(5), `.design/07` §4.8.4 / §5.2: the read-only `search` operation of
// this REMOTE_ADAPTER release (manifest `executionConnector.searchSource =
// SUPPORTED`). The route (pages/api/platform-adapter/[operation].ts) parses
// the body with the shared `searchArguments` and verifies Core's Search Token
// with the shared `verifySearchToken` (client-kit/adapter/protocol.mjs, the
// module this route already uses), so the checks are the exact shared code.
// Core has already done a fresh `read` per Resource; there is no PEP call and
// no ActionExecution here.
//
// Native scope: the binding's Resources are the deployed models and views of
// the one delivered project (`nativeType` model|view, `nativeId` = its id,
// `nativeScopeRef` = project id). Threads and the dashboard are not Resources;
// they belong to the whole project, which every member reads (`07` §4.7.4
// Wren table). So the project is the binding's native scope for search: a
// request is answered only when at least one `resources[]` entry is a model
// or view of the delivered project, and then searches the project's threads
// (summary or first question) and dashboard items (display name). Entries
// that do not belong to this binding are ignored; with none left the answer
// is empty. Only titles, a short snippet and native page paths are returned.

export interface KailoSearchArguments {
  idempotencyKey: string;
  query: string;
  limit: number;
  locale: 'ZH_CN' | 'EN';
  resources: { resourceId: string; nativeType: string; nativeId: string }[];
}

export interface KailoSearchResult {
  kind: 'QUESTION' | 'DASHBOARD';
  title: string;
  summary?: string;
  path: string;
  updatedAt?: string;
}

const NATIVE_ID = /^[1-9]\d{0,15}$/;
const SNIPPET_MAX = 200;

// LIKE pattern with `\` as the escape character: user text never acts as a
// wildcard. Lower-cased on both sides (portable across PostgreSQL/SQLite).
export function containsPattern(query: string): string {
  return `%${query.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// How many `resources[]` entries are models/views of the delivered project.
export async function bindingResourceCount(
  knex: Knex,
  delivery: Pick<NativeQueryDelivery, 'projectId'>,
  resources: KailoSearchArguments['resources'],
): Promise<number> {
  const ids = (type: string) => [
    ...new Set(
      resources
        .filter((r) => r.nativeType === type && NATIVE_ID.test(r.nativeId))
        .map((r) => Number(r.nativeId)),
    ),
  ];
  let count = 0;
  for (const [table, type] of [
    ['model', 'model'],
    ['view', 'view'],
  ]) {
    const wanted = ids(type);
    if (!wanted.length) continue;
    const rows = await knex(table)
      .whereIn('id', wanted)
      .andWhere('project_id', delivery.projectId)
      .select('id');
    count += rows.length;
  }
  return count;
}

const timestamp = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
};

const snippet = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  const chars = Array.from(text);
  return chars.length <= SNIPPET_MAX
    ? text
    : `${chars.slice(0, SNIPPET_MAX - 1).join('')}…`;
};

export async function kailoAdapterSearch(
  knex: Knex,
  delivery: Pick<NativeQueryDelivery, 'projectId'>,
  args: KailoSearchArguments,
): Promise<{ results: KailoSearchResult[] }> {
  if (!(await bindingResourceCount(knex, delivery, args.resources)))
    return searchResponse([], args.limit);
  const pattern = containsPattern(args.query);
  // The thread's first question (the one that started it).
  const firstQuestion =
    'select first_response.question from thread_response first_response' +
    ' where first_response.thread_id = thread.id' +
    ' order by first_response.id asc limit 1';
  const threads = await knex('thread')
    .where('thread.project_id', delivery.projectId)
    .andWhere((query) =>
      query
        .whereRaw("lower(thread.summary) like ? escape '\\'", [pattern])
        .orWhereRaw(
          `lower((${firstQuestion})) like ? escape '\\'`,
          [pattern],
        ),
    )
    .select(
      'thread.id as id',
      'thread.summary as summary',
      'thread.updated_at as updated_at',
      knex.raw(`(${firstQuestion}) as first_question`),
    )
    .orderBy('thread.updated_at', 'desc')
    .orderBy('thread.id', 'desc')
    .limit(args.limit);
  const items = await knex('dashboard_item')
    .join('dashboard', 'dashboard.id', 'dashboard_item.dashboard_id')
    .where('dashboard.project_id', delivery.projectId)
    .whereRaw("lower(dashboard_item.display_name) like ? escape '\\'", [
      pattern,
    ])
    .select(
      'dashboard_item.id as id',
      'dashboard_item.display_name as display_name',
      'dashboard_item.updated_at as updated_at',
      'dashboard.name as dashboard_name',
    )
    .orderBy('dashboard_item.updated_at', 'desc')
    .orderBy('dashboard_item.id', 'desc')
    .limit(args.limit);
  const results: KailoSearchResult[] = [
    ...threads.map((row) => {
      const title = snippet(row.summary) || snippet(row.first_question);
      const question = snippet(row.first_question);
      return {
        kind: 'QUESTION' as const,
        title,
        ...(question && question !== title ? { summary: question } : {}),
        path: `/home/${Number(row.id)}`,
        updatedAt: timestamp(row.updated_at),
      };
    }),
    ...items.map((row) => ({
      kind: 'DASHBOARD' as const,
      title: snippet(row.display_name),
      ...(snippet(row.dashboard_name)
        ? { summary: snippet(row.dashboard_name) }
        : {}),
      path: '/home/dashboard',
      updatedAt: timestamp(row.updated_at),
    })),
  ].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return searchResponse(results, args.limit);
}
