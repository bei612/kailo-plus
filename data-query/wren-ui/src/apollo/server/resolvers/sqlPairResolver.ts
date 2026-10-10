import { IContext } from '@server/types/context';
import { SqlPair } from '@server/repositories';
import * as Errors from '@server/utils/error';
import { TelemetryEvent, TrackTelemetry } from '@server/telemetry/telemetry';
import { DialectSQL, WrenSQL } from '@server/models/adaptor';
import { safeFormatSQL } from '@server/utils/sqlFormat';
import {
  NativeHumanQuery,
  nativePreviewScope,
} from '../services/nativeHumanQuery';
import { NativeQueryService } from '../services/nativeQueryService';
import {
  loadQueryDelivery,
  NativeQueryRefusal,
} from '../services/nativeQueryAdmission';
import { queryReceiptState } from '@/utils/queryReceipt';
import { NativeSqlPairContext } from '../services/sqlPairService';

type SqlValidation = {
  idempotencyKey?: string;
  idempotencyScope?: string;
};

export type SqlPairContext = Pick<
  IContext,
  | 'nativeHumanToken'
  | 'nativeIdentityScope'
  | 'nativeProjectCheck'
  | 'telemetry'
  | 'projectService'
  | 'sqlPairService'
  | 'deployService'
  | 'projectRepository'
  | 'deployRepository'
  | 'queryService'
  | 'viewRepository'
  | 'modelRepository'
  | 'modelColumnRepository'
>;

export class SqlPairResolver {
  constructor() {
    this.getProjectSqlPairs = this.getProjectSqlPairs.bind(this);
    this.createSqlPair = this.createSqlPair.bind(this);
    this.updateSqlPair = this.updateSqlPair.bind(this);
    this.deleteSqlPair = this.deleteSqlPair.bind(this);
    this.generateQuestion = this.generateQuestion.bind(this);
    this.modelSubstitute = this.modelSubstitute.bind(this);
  }

  private async nativeContext(
    ctx: SqlPairContext,
    writing = false,
    projectId?: number,
  ): Promise<NativeSqlPairContext | undefined> {
    if (
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE === undefined &&
      ctx.nativeIdentityScope === undefined &&
      ctx.nativeHumanToken === undefined
    )
      return undefined;
    const config = await loadQueryDelivery();
    nativePreviewScope(config, ctx.nativeIdentityScope);
    if (!ctx.nativeHumanToken)
      throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    if (writing && typeof ctx.nativeProjectCheck !== 'function')
      throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
    if (writing) await ctx.nativeProjectCheck(projectId);
    return {
      config,
      identityScope: ctx.nativeIdentityScope,
      token: ctx.nativeHumanToken,
      ...(writing ? { beforeWrite: ctx.nativeProjectCheck } : {}),
    };
  }

  public async getProjectSqlPairs(
    _root: unknown,
    _arg: any,
    ctx: SqlPairContext,
  ): Promise<SqlPair[]> {
    const project = await ctx.projectService.getCurrentProject();
    return ctx.sqlPairService.getProjectSqlPairs(
      project.id,
      await this.nativeContext(ctx),
    );
  }

  @TrackTelemetry(TelemetryEvent.KNOWLEDGE_CREATE_SQL_PAIR)
  public async createSqlPair(
    _root: unknown,
    arg: {
      data: {
        sql: string;
        question: string;
      } & SqlValidation;
    },
    ctx: SqlPairContext,
  ): Promise<SqlPair> {
    const project = await ctx.projectService.getCurrentProject();
    await this.validateSql(arg.data.sql, ctx, arg.data);
    return await ctx.sqlPairService.createSqlPair(
      project.id,
      {
        sql: arg.data.sql,
        question: arg.data.question,
      },
      await this.nativeContext(ctx, true, project.id),
      arg.data.idempotencyKey,
    );
  }

  @TrackTelemetry(TelemetryEvent.KNOWLEDGE_UPDATE_SQL_PAIR)
  public async updateSqlPair(
    _root: unknown,
    arg: {
      data: {
        sql?: string;
        question?: string;
      } & SqlValidation;
      where: {
        id: number;
      };
    },
    ctx: SqlPairContext,
  ): Promise<SqlPair> {
    const project = await ctx.projectService.getCurrentProject();
    if (arg.data.sql !== undefined)
      await this.validateSql(arg.data.sql, ctx, arg.data);
    return ctx.sqlPairService.editSqlPair(
      project.id,
      arg.where.id,
      {
        sql: arg.data.sql,
        question: arg.data.question,
      },
      await this.nativeContext(ctx, true, project.id),
      arg.data.idempotencyKey,
    );
  }

  @TrackTelemetry(TelemetryEvent.KNOWLEDGE_DELETE_SQL_PAIR)
  public async deleteSqlPair(
    _root: unknown,
    arg: {
      where: {
        id: number;
        idempotencyKey?: string;
      };
    },
    ctx: SqlPairContext,
  ): Promise<boolean> {
    const project = await ctx.projectService.getCurrentProject();
    return ctx.sqlPairService.deleteSqlPair(
      project.id,
      arg.where.id,
      await this.nativeContext(ctx, true, project.id),
      arg.where.idempotencyKey,
    );
  }

  public async generateQuestion(
    _root: unknown,
    arg: {
      data: {
        sql: string;
      };
    },
    ctx: SqlPairContext,
  ) {
    const project = await ctx.projectService.getCurrentProject();
    const questions = await ctx.sqlPairService.generateQuestions(
      project,
      [arg.data.sql],
      await this.nativeContext(ctx),
    );
    return questions[0];
  }

  public async modelSubstitute(
    _root: unknown,
    arg: {
      data: {
        sql: DialectSQL;
      };
    },
    ctx: SqlPairContext,
  ): Promise<WrenSQL> {
    const project = await ctx.projectService.getCurrentProject();
    const lastDeployment = await ctx.deployService.getLastDeployment(
      project.id,
    );
    const manifest = lastDeployment.manifest;

    const wrenSQL = await ctx.sqlPairService.modelSubstitute(
      arg.data.sql as DialectSQL,
      {
        project,
        manifest,
      },
    );
    return safeFormatSQL(wrenSQL, { language: 'postgresql' }) as WrenSQL;
  }

  private async validateSql(
    sql: string,
    ctx: SqlPairContext,
    validation: SqlValidation,
  ) {
    const project = await ctx.projectService.getCurrentProject();
    if (
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined ||
      ctx.nativeIdentityScope !== undefined ||
      ctx.nativeHumanToken !== undefined
    ) {
      const config = await loadQueryDelivery();
      const scope = nativePreviewScope(config, ctx.nativeIdentityScope);
      if (
        config.projectId !== project.id ||
        validation.idempotencyScope !== scope
      )
        throw new NativeQueryRefusal(409, 'QUERY_IDENTITY_CHANGED');
      const { components } = await import('@/common');
      const queries = new NativeQueryService(
        config,
        ctx.projectRepository,
        ctx.deployRepository,
        components.apiHistoryRepository,
        ctx.queryService,
        ctx.viewRepository,
        ctx.modelRepository,
        ctx.modelColumnRepository,
      );
      const receipt = await new NativeHumanQuery(
        config,
        queries,
        components.apiHistoryRepository,
      ).previewSql(
        ctx.nativeHumanToken,
        validation.idempotencyKey,
        sql,
        1,
        scope,
        true,
        undefined,
        undefined,
        undefined,
        true,
      );
      if (!queryReceiptState(receipt).completed || receipt.data?.valid !== true)
        throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
      return;
    }
    const lastDeployment = await ctx.deployService.getLastDeployment(
      project.id,
    );
    const manifest = lastDeployment.manifest;
    try {
      await ctx.queryService.preview(sql, {
        manifest,
        project,
        dryRun: true,
      });
    } catch (err) {
      throw Errors.create(Errors.GeneralErrorCodes.INVALID_SQL_ERROR, {
        customMessage: err.message,
      });
    }
  }

  public getSqlPairNestedResolver = () => ({
    createdAt: (sqlPair: SqlPair, _args: any, _ctx: IContext) => {
      return new Date(sqlPair.createdAt).toISOString();
    },
    updatedAt: (sqlPair: SqlPair, _args: any, _ctx: IContext) => {
      return new Date(sqlPair.updatedAt).toISOString();
    },
  });
}
