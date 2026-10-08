import { ApiType, ApiHistory } from '@server/repositories/apiHistoryRepository';
import { IContext } from '@server/types';
import {
  loadQueryDelivery,
  NativeQueryRefusal,
} from '../services/nativeQueryAdmission';
import {
  NativeHumanQuery,
  authorizeNativeScope,
  nativePreviewScope,
} from '../services/nativeHumanQuery';
import { NativeQueryService } from '../services/nativeQueryService';
import { readNativeAskHistory } from '../services/nativeRestAsk';
import { ModelResolver } from './modelResolver';

export interface ApiHistoryFilter {
  id?: string;
  queryScope?: string;
  generation?: number;
  apiType?: ApiType;
  statusCode?: number;
  threadId?: string;
  projectId?: number;
  startDate?: string;
  endDate?: string;
}

const isNativeSqlPairWrite = (history: ApiHistory) =>
  [
    ApiType.CREATE_SQL_PAIR,
    ApiType.UPDATE_SQL_PAIR,
    ApiType.DELETE_SQL_PAIR,
  ].includes(history.apiType);

export interface ApiHistoryPagination {
  offset: number;
  limit: number;
}

/**
 * Sanitize response payload to remove large data fields
 * This prevents excessive data transfer when displaying API history
 * @param payload The response payload to sanitize
 * @param apiType The type of API that generated this response
 */
const sanitizeResponsePayload = (payload: any, apiType?: ApiType): any => {
  if (!payload) return payload;

  const sanitized = { ...payload };

  // Handle specifically RUN_SQL responses that contain large record sets
  if (apiType === ApiType.RUN_SQL) {
    // Remove records array but keep metadata about how many records were returned
    if (sanitized.records && Array.isArray(sanitized.records)) {
      const recordCount = sanitized.records.length;
      sanitized.records = [`${recordCount} records omitted`];
    }
  }

  // Handle specifically GENERATE_VEGA_CHART responses that contain large data values
  if (apiType === ApiType.GENERATE_VEGA_CHART) {
    // Remove vegaSpec.data.values array but keep the structure
    if (
      sanitized.vegaSpec?.data?.values &&
      Array.isArray(sanitized.vegaSpec.data.values)
    ) {
      const dataCount = sanitized.vegaSpec.data.values.length;
      sanitized.vegaSpec.data.values = [`${dataCount} data points omitted`];
    }
  }

  return sanitized;
};

export class ApiHistoryResolver {
  constructor() {
    this.getApiHistory = this.getApiHistory.bind(this);
  }

  private async nativeHistory(ctx: IContext) {
    if (
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE === undefined &&
      !ctx?.nativeIdentityScope &&
      !ctx?.nativeHumanToken
    )
      return undefined;
    const config = await loadQueryDelivery();
    const queryScope = nativePreviewScope(config, ctx.nativeIdentityScope);
    if (!ctx.nativeHumanToken)
      throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    const project = await ctx.projectService.getCurrentProject();
    if (config.projectId !== project.id)
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
    const permissionFact = await authorizeNativeScope(
      config,
      ctx.nativeHumanToken,
      'discover',
    );
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
    return {
      config,
      queryScope,
      generation: permissionFact.generation,
      reader: new NativeHumanQuery(
        config,
        queries,
        components.apiHistoryRepository,
      ),
    };
  }

  private async visibleHistory(
    ctx: IContext,
    native: Awaited<ReturnType<ApiHistoryResolver['nativeHistory']>>,
    apiHistory: ApiHistory,
  ) {
    if (apiHistory.apiType === ApiType.GET_MODELS)
      return new ModelResolver().readModelsHistory(apiHistory, ctx);
    if (isNativeSqlPairWrite(apiHistory))
      return ctx.sqlPairService.readNativeWrite(apiHistory, {
        config: native.config,
        identityScope: ctx.nativeIdentityScope,
        token: ctx.nativeHumanToken,
      });
    if (
      [
        ApiType.ASK,
        ApiType.STREAM_ASK,
        ApiType.GENERATE_SQL,
        ApiType.STREAM_GENERATE_SQL,
      ].includes(apiHistory.apiType)
    )
      return readNativeAskHistory(
        ctx,
        native.config,
        native.reader,
        apiHistory,
      );
    return native.reader.readHistory(ctx.nativeHumanToken, apiHistory);
  }

  /**
   * Get API history with filtering and pagination
   */
  public async getApiHistory(
    _root: unknown,
    args: {
      filter?: ApiHistoryFilter;
      pagination: ApiHistoryPagination;
    },
    ctx: IContext,
  ) {
    const { filter, pagination } = args;
    const { offset, limit } = pagination;

    // Build filter criteria
    const filterCriteria: Partial<ApiHistory> = {};

    if (filter) {
      if (filter.id !== undefined) {
        if (typeof filter.id !== 'string' || !filter.id.trim())
          throw new NativeQueryRefusal(400, 'INVALID_QUERY_PARAMETERS');
        filterCriteria.id = filter.id;
      }
      if (filter.apiType) {
        filterCriteria.apiType = filter.apiType;
      }

      if (filter.statusCode) {
        filterCriteria.statusCode = filter.statusCode;
      }

      if (filter.threadId) {
        filterCriteria.threadId = filter.threadId;
      }

      if (filter.projectId) {
        filterCriteria.projectId = filter.projectId;
      }
    }

    const native = await this.nativeHistory(ctx);
    if (native) {
      if (
        filter?.queryScope !== native.queryScope ||
        filter?.generation !== native.generation
      )
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      if (
        filter?.projectId !== undefined &&
        filter.projectId !== native.config.projectId
      )
        throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
      // Keep the original filters/count/page, but never borrow the native
      // first project or expose another binding's history through a filter.
      filterCriteria.projectId = native.config.projectId;
      filterCriteria.governanceBindingId = native.config.bindingId;
    }

    // Handle date filtering
    const dateFilter: { startDate?: Date; endDate?: Date } = {};
    if (filter?.startDate) {
      dateFilter.startDate = new Date(filter.startDate);
    }
    if (filter?.endDate) {
      dateFilter.endDate = new Date(filter.endDate);
    }

    // Get total count for pagination info
    const total = await ctx.apiHistoryRepository.count(
      filterCriteria,
      dateFilter,
    );

    if (total === 0 || total <= offset) {
      return {
        items: [],
        total,
        hasMore: false,
      };
    }

    // Get paginated items
    const items = await ctx.apiHistoryRepository.findAllWithPagination(
      filterCriteria,
      dateFilter,
      {
        offset,
        limit,
        orderBy: { createdAt: 'desc' },
      },
    );

    // A user-selected original history ID is the bounded reconciliation entry.
    // Page listing and nested JSON fields must not poll every pending task (or
    // poll the same native event twice). Only the recorded event is observed;
    // neither this GET nor a lost native cache entry dispatches a replacement.
    if (native && filterCriteria.id && items.length) {
      if (items.length !== 1 || items[0].id !== filterCriteria.id)
        throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
      const item = items[0];
      if (isNativeSqlPairWrite(item)) {
        try {
          await this.visibleHistory(ctx, native, item);
        } catch (error) {
          if (error?.message !== 'NATIVE_EXECUTION_UNKNOWN') throw error;
        }
        const current = await ctx.apiHistoryRepository.findOneBy({
          id: item.id,
          projectId: native.config.projectId,
          governanceBindingId: native.config.bindingId,
        });
        if (!current)
          throw new NativeQueryRefusal(503, 'QUERY_EVIDENCE_UNAVAILABLE');
        items[0] = current;
      }
    }

    return {
      items,
      total,
      hasMore: offset + limit < total,
    };
  }

  /**
   * Resolver for ApiHistoryResponse fields
   */
  public getApiHistoryNestedResolver = () => ({
    createdAt: (apiHistory: ApiHistory) => {
      return apiHistory.createdAt
        ? new Date(apiHistory.createdAt).toISOString()
        : null;
    },
    updatedAt: (apiHistory: ApiHistory) => {
      return apiHistory.updatedAt
        ? new Date(apiHistory.updatedAt).toISOString()
        : null;
    },
    requestPayload: async (
      apiHistory: ApiHistory,
      _args: unknown,
      ctx: IContext,
    ) => {
      const native = await this.nativeHistory(ctx);
      if (!native) return apiHistory.requestPayload ?? null;
      if (isNativeSqlPairWrite(apiHistory) && apiHistory.statusCode === 202)
        return null;
      const visible = await this.visibleHistory(ctx, native, apiHistory);
      return visible.requestPayload;
    },
    responsePayload: async (
      apiHistory: ApiHistory,
      _args: unknown,
      ctx: IContext,
    ) => {
      const native = await this.nativeHistory(ctx);
      if (
        native &&
        isNativeSqlPairWrite(apiHistory) &&
        apiHistory.statusCode === 202
      )
        return null;
      const payload = native
        ? (await this.visibleHistory(ctx, native, apiHistory)).responsePayload
        : apiHistory.responsePayload;
      if (!payload) return null;

      // If the response payload is an array, return it as is
      if (Array.isArray(payload)) return payload;

      // Otherwise, sanitize the response payload
      return sanitizeResponsePayload(payload, apiHistory.apiType);
    },
  });
}
