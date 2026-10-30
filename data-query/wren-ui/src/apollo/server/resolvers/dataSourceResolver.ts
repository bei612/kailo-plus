import { DataSource, DataSourceName, IContext } from '../types';
import { Project } from '../repositories';
import { getLogger } from '@server/utils';
import * as Errors from '../utils/error';
import { encryptConnectionInfo, sensitivePropsOf } from '../dataSource';
import {
  connectionCredentials,
  hasLocalCredentials,
  heldByKailo,
  KAILO_SECRET_FIELDS,
  splitCredentials,
} from '../services/connectionCredentials';
import { isKailoAdmin, kailoActor } from '../services/kailoUserService';
import { isGovernedQueryMode } from '../services/nativeQueryMode';
import { ProjectResolver } from './projectResolver';

// DD-169: data source management. One data source is one native project
// (one connection, its own models, threads and dashboards).
//
//   dataSources   — every member of the binding's directory scope: names,
//                   types, status and model counts only (DD-169(4)②).
//   everything else — administrators only (DD-169(4)①): the wrappers in
//                   resolvers.ts apply `manage` / the admin read gate before
//                   these methods run.
//
// Credential values never leave the server: details list which credential
// fields are set, never their values; test errors are scrubbed of every value
// the admin typed before they are returned.

const logger = getLogger('DataSourceResolver');
logger.level = 'info';

const PAGE_MAX = 50;

export enum DataSourceStatus {
  NO_MODELS = 'NO_MODELS',
  READY = 'READY',
}

export enum DataSourceCredentialStorage {
  KAILO = 'KAILO',
  LOCAL = 'LOCAL',
  NONE = 'NONE',
}

interface ListArgs {
  filter?: {
    keyword?: string | null;
    type?: DataSourceName | null;
    status?: DataSourceStatus | null;
  } | null;
  offset?: number | null;
  limit?: number | null;
}

function credentialStorage(project: Project): DataSourceCredentialStorage {
  if (heldByKailo(project.connectionInfo as any))
    return DataSourceCredentialStorage.KAILO;
  return hasLocalCredentials(project.type, project.connectionInfo as any)
    ? DataSourceCredentialStorage.LOCAL
    : DataSourceCredentialStorage.NONE;
}

/** Removes every typed credential value (and its URL-encoded form) from a message. */
export function scrubCredentials(message: string, values: string[]): string {
  let text = String(message || '');
  for (const value of values) {
    if (!value || value.length < 3) continue;
    for (const form of new Set([value, encodeURIComponent(value)]))
      text = text.split(form).join('••••••');
  }
  return text.slice(0, 600);
}

export class DataSourceResolver {
  constructor(private readonly projects: ProjectResolver) {
    this.listDataSources = this.listDataSources.bind(this);
    this.getDataSource = this.getDataSource.bind(this);
    this.testDataSourceConnection = this.testDataSourceConnection.bind(this);
    this.createDataSource = this.createDataSource.bind(this);
    this.updateDataSourceConnection =
      this.updateDataSourceConnection.bind(this);
    this.deleteDataSource = this.deleteDataSource.bind(this);
    this.migrateDataSourceCredentials =
      this.migrateDataSourceCredentials.bind(this);
  }

  private async allProjects(ctx: IContext): Promise<Project[]> {
    // DD-169(2)⑥: a GOVERNED instance has exactly the binding's project.
    if (isGovernedQueryMode()) {
      try {
        return [await ctx.projectRepository.getCurrentProject()];
      } catch {
        return [];
      }
    }
    return ctx.projectRepository.findAll({ order: 'id' });
  }

  private async modelCount(ctx: IContext, projectId: number) {
    return (await ctx.modelRepository.findAllBy({ projectId })).length;
  }

  private async project(ctx: IContext, id: number): Promise<Project> {
    const project = (await this.allProjects(ctx)).find(
      (item) => item.id === id,
    );
    if (!project)
      throw Errors.create(Errors.GeneralErrorCodes.DATA_SOURCE_NOT_FOUND);
    return project;
  }

  public async listDataSources(_root: any, args: ListArgs, ctx: IContext) {
    const projects = await this.allProjects(ctx);
    const admin = await isKailoAdmin(ctx.kailoUser, ctx.nativeHumanToken);
    const rows = await Promise.all(
      projects.map(async (project) => {
        const modelCount = await this.modelCount(ctx, project.id);
        return {
          id: project.id,
          displayName: project.displayName,
          type: project.type,
          status: modelCount
            ? DataSourceStatus.READY
            : DataSourceStatus.NO_MODELS,
          modelCount,
          // Credential placement is administration data (DD-169(4)).
          credentialStorage: admin ? credentialStorage(project) : null,
        };
      }),
    );
    const keyword = args?.filter?.keyword?.trim().toLowerCase() || '';
    const filtered = rows.filter(
      (row) =>
        (!keyword || row.displayName.toLowerCase().includes(keyword)) &&
        (!args?.filter?.type || row.type === args.filter.type) &&
        (!args?.filter?.status || row.status === args.filter.status),
    );
    const offset = Math.max(0, Math.floor(args?.offset ?? 0));
    const limit = Math.min(
      PAGE_MAX,
      Math.max(1, Math.floor(args?.limit ?? 10)),
    );
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      // the data source a request without a selection uses
      defaultId: projects[0]?.id ?? null,
      governed: isGovernedQueryMode(),
      kailoCustody: connectionCredentials().custody,
    };
  }

  public async getDataSource(_root: any, args: { id: number }, ctx: IContext) {
    const project = await this.project(ctx, args.id);
    const deployment = await ctx.deployService.getLastDeployment(project.id);
    const set = new Set(
      heldByKailo(project.connectionInfo as any)
        ? (project.connectionInfo as any)[KAILO_SECRET_FIELDS] || []
        : sensitivePropsOf(project.type).filter(
            (prop) => !!project.connectionInfo?.[prop],
          ),
    );
    const modelCount = await this.modelCount(ctx, project.id);
    return {
      id: project.id,
      displayName: project.displayName,
      type: project.type,
      properties: ctx.projectService.getGeneralConnectionInfo(project),
      credentialFields: sensitivePropsOf(project.type).filter((prop) =>
        set.has(prop),
      ),
      credentialStorage: credentialStorage(project),
      status: modelCount ? DataSourceStatus.READY : DataSourceStatus.NO_MODELS,
      modelCount,
      lastDeployedAt: (deployment as any)?.updatedAt
        ? new Date((deployment as any).updatedAt).toISOString()
        : null,
    };
  }

  /**
   * Tests a connection without storing anything. With `id`, empty credential
   * fields mean the stored ones (edit). Returns a scrubbed error summary.
   */
  public async testDataSourceConnection(
    _root: any,
    args: { data: DataSource; id?: number | null },
    ctx: IContext,
  ) {
    const { type, properties } = args.data;
    if (!(type in DataSourceName))
      throw Errors.create(Errors.GeneralErrorCodes.DATA_SOURCE_INVALID);
    const { displayName: _name, ...input } = (properties || {}) as any;
    let typed: string[] = [];
    try {
      const { credentials } = splitCredentials(type, input);
      typed = Object.values(credentials);
      let connection: Record<string, any> = { ...input };
      if (args.id) {
        if (isGovernedQueryMode())
          throw Errors.create(Errors.GeneralErrorCodes.GOVERNED_SOURCE_FIXED);
        const project = await this.project(ctx, args.id);
        if (project.type !== type)
          throw Errors.create(Errors.GeneralErrorCodes.DATA_SOURCE_INVALID);
        const current = await connectionCredentials().plaintext(
          type,
          project.connectionInfo as any,
        );
        connection = { ...current, ...input, ...credentials };
        for (const [key, value] of Object.entries(input))
          if ((value === '' || value === null) && key in current)
            connection[key] = current[key];
      }
      if (type === DataSourceName.DUCKDB) {
        // DuckDB lives in the engine itself (one per instance); it is checked
        // when it is saved, which prepares that engine state.
        return { ok: false, deferred: true, tableCount: null, error: null };
      }
      const tables = await ctx.projectService.getProjectDataSourceTables({
        id: 0,
        type,
        displayName: '',
        connectionInfo: encryptConnectionInfo(type, connection as any),
      } as Project);
      return {
        ok: true,
        deferred: false,
        tableCount: tables.length,
        error: null,
      };
    } catch (error: any) {
      const code = error?.extensions?.code || error?.code;
      if (
        [
          Errors.GeneralErrorCodes.GOVERNED_SOURCE_FIXED,
          Errors.GeneralErrorCodes.DATA_SOURCE_NOT_FOUND,
          Errors.GeneralErrorCodes.DATA_SOURCE_INVALID,
          Errors.GeneralErrorCodes.DEPENDENCY_UNAVAILABLE,
        ].includes(code)
      )
        throw error;
      if (error?.code === 'DEPENDENCY_UNAVAILABLE')
        throw Errors.create(Errors.GeneralErrorCodes.DEPENDENCY_UNAVAILABLE);
      return {
        ok: false,
        deferred: false,
        tableCount: null,
        error: scrubCredentials(
          error?.extensions?.message || error?.message || 'Connection failed',
          typed,
        ),
      };
    }
  }

  public async createDataSource(
    root: any,
    args: { data: DataSource },
    ctx: IContext,
  ) {
    try {
      return await this.projects.saveDataSource(root, args, ctx);
    } catch (error: any) {
      throw this.credentialError(error);
    }
  }

  public async updateDataSourceConnection(
    _root: any,
    args: { id: number; data: DataSource },
    ctx: IContext,
  ) {
    const project = await this.project(ctx, args.id);
    if (args.data.type !== project.type)
      throw Errors.create(Errors.GeneralErrorCodes.DATA_SOURCE_INVALID);
    try {
      return await this.projects.updateDataSourceConnection(
        project,
        args.data.properties,
        ctx,
      );
    } catch (error: any) {
      throw this.credentialError(error);
    }
  }

  public async deleteDataSource(
    _root: any,
    args: { id: number },
    ctx: IContext,
  ) {
    if (isGovernedQueryMode())
      throw Errors.create(Errors.GeneralErrorCodes.GOVERNED_SOURCE_FIXED);
    const project = await this.project(ctx, args.id);
    await this.projects.deleteDataSourceProject(project, ctx);
    return true;
  }

  /**
   * DD-169(7)①: moves native ciphertext credentials into Kailo custody, one
   * project at a time, with the opening administrator as the actor. A failed
   * project keeps its ciphertext and is retried on the next opening.
   */
  public async migrateDataSourceCredentials(
    _root: any,
    _args: any,
    ctx: IContext,
  ) {
    const credentials = connectionCredentials();
    if (isGovernedQueryMode() || !credentials.custody)
      return { migrated: 0, pending: 0 };
    const actor = await kailoActor(ctx.kailoUser);
    let migrated = 0;
    let pending = 0;
    for (const project of await this.allProjects(ctx)) {
      const info = project.connectionInfo as any;
      if (heldByKailo(info) || !hasLocalCredentials(project.type, info))
        continue;
      try {
        const plain = await credentials.plaintext(project.type, info);
        const { stored } = await credentials.store(project.type, plain, actor);
        // Atomic per project: the row switches from ciphertext to reference
        // in one update; it is never without one of the two.
        const updated = await ctx.projectRepository.updateOne(project.id, {
          connectionInfo: stored as any,
        });
        if (!heldByKailo(updated.connectionInfo as any))
          throw new Error('reference not stored');
        migrated += 1;
      } catch (error: any) {
        pending += 1;
        logger.error(
          `Credential migration of data source ${project.id} deferred: ${error?.code || 'error'}`,
        );
      }
    }
    return { migrated, pending };
  }

  private credentialError(error: any) {
    if (error?.code === 'DEPENDENCY_UNAVAILABLE')
      return Errors.create(Errors.GeneralErrorCodes.DEPENDENCY_UNAVAILABLE);
    if (error?.code === 'COMPONENT_SECRET_REFUSED')
      return Errors.create(Errors.GeneralErrorCodes.KAILO_ADMIN_REQUIRED);
    if (
      error?.code === 'INVALID_CONNECTION_CREDENTIAL' ||
      error?.code === 'KAILO_ACTOR_REQUIRED'
    )
      return Errors.create(Errors.GeneralErrorCodes.DATA_SOURCE_INVALID);
    return error;
  }
}
