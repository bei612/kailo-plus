import { AsyncLocalStorage } from 'async_hooks';
import type { NextApiRequest, NextApiResponse } from 'next';

// DD-169(2)①: one Wren project per data source connection. Each request names
// its current data source explicitly — GraphQL and REST with the request header,
// EventSource streams (which cannot set headers) with the query parameter of the
// same name. The selection is navigation state only: it never grants anything,
// every resolver keeps its own authorization, and the repository checks that
// the project exists before it becomes the request's current project.
//
// AsyncLocalStorage carries the selection through the request's async chain to
// `ProjectRepository.getCurrentProject`, so the many existing call sites keep
// their original shape. Background trackers must not rely on it: they take the
// project from the row they work on (askingTaskTracker, adjustment, dashboard
// cache, text answer).

export const DATA_SOURCE_HEADER = 'x-kailo-data-source';
export const DATA_SOURCE_PARAM = 'kailo_data_source';

export class DataSourceSelectionError extends Error {
  readonly code = 'DATA_SOURCE_NOT_FOUND';
  constructor() {
    super('DATA_SOURCE_NOT_FOUND');
  }
}

interface Selection {
  projectId: number | null;
}

const storage = new AsyncLocalStorage<Selection>();

const ID = /^[1-9][0-9]{0,14}$/;

/**
 * The project id a request asked for: null when it names none; a
 * `DataSourceSelectionError` when the value is present but malformed or
 * repeated (never silently the first project).
 */
export function parseDataSourceId(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !ID.test(value))
    throw new DataSourceSelectionError();
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new DataSourceSelectionError();
  return id;
}

export function requestDataSourceId(req: {
  headers: { [name: string]: string | string[] | undefined };
  query?: { [name: string]: string | string[] | undefined };
}): number | null {
  const header = parseDataSourceId(req.headers[DATA_SOURCE_HEADER]);
  const param = parseDataSourceId(req.query?.[DATA_SOURCE_PARAM]);
  if (header !== null && param !== null && header !== param)
    throw new DataSourceSelectionError();
  return header ?? param;
}

export function runInDataSource<T>(projectId: number | null, fn: () => T): T {
  return storage.run({ projectId }, fn);
}

/** The data source the current request selected, or null for the default. */
export function selectedDataSourceId(): number | null {
  return storage.getStore()?.projectId ?? null;
}

/** Wraps a Next API route so the whole handler runs in the request's selection. */
export function withDataSource<
  H extends (req: NextApiRequest, res: NextApiResponse) => any,
>(handler: H) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    let projectId: number | null;
    try {
      projectId = requestDataSourceId(req);
    } catch {
      res.status(404).json({ code: 'DATA_SOURCE_NOT_FOUND' });
      return;
    }
    return runInDataSource(projectId, () => handler(req, res));
  };
}
