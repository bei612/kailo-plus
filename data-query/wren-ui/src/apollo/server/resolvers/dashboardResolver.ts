import { IContext } from '@server/types';
import { ChartType } from '@server/models/adaptor';
import {
  UpdateDashboardItemLayouts,
  PreviewDataResponse,
  DEFAULT_PREVIEW_LIMIT,
} from '@server/services';
import {
  Dashboard,
  DashboardItem,
  DashboardItemType,
  Project,
} from '@server/repositories';
import { getLogger } from '@server/utils';
import {
  SetDashboardCacheData,
  DashboardSchedule,
  PreviewItemResponse,
} from '@server/models/dashboard';
import { NativeQueryService } from '../services/nativeQueryService';
import {
  NativeHumanQuery,
  nativePreviewScope,
  canReadNativeMetadata,
} from '../services/nativeHumanQuery';
import {
  loadQueryDelivery,
  NativeQueryRefusal,
  digest,
} from '../services/nativeQueryAdmission';
import { queryReceiptState } from '@/utils/queryReceipt';

const logger = getLogger('DashboardResolver');
logger.level = 'debug';

export class DashboardResolver {
  private async readableItems(
    ctx: IContext,
    dashboard: Dashboard,
    project: Project,
    items: DashboardItem[],
  ) {
    if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE === undefined) return items;
    const config = await loadQueryDelivery();
    nativePreviewScope(config, ctx.nativeIdentityScope);
    if (!ctx.nativeHumanToken)
      throw new NativeQueryRefusal(401, 'NATIVE_AUTHENTICATION_REQUIRED');
    if (config.projectId !== project.id || dashboard.projectId !== project.id)
      throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
    const { components } = await import('@/common');
    const native = new NativeQueryService(
      config,
      ctx.projectRepository,
      ctx.deployRepository,
      components.apiHistoryRepository,
      ctx.queryService,
      ctx.viewRepository,
      ctx.modelRepository,
      ctx.modelColumnRepository,
    );
    const permitted = async (
      objects: { nativeType: 'model' | 'view'; nativeId: number }[],
    ) => {
      for (const object of objects)
        if (
          !(await canReadNativeMetadata(
            config,
            ctx.nativeHumanToken,
            object.nativeType,
            object.nativeId,
          ))
        )
          return false;
      return true;
    };
    const visible: { item: DashboardItem; revision: string }[] = [];
    for (const item of items) {
      if (item.dashboardId !== dashboard.id)
        throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
      const sources = await native.metadataSources(item.detail.sql);
      if (await permitted(sources.objects))
        visible.push({ item, revision: sources.revision });
    }
    const disclosed: DashboardItem[] = [];
    // Recheck assembled native bodies and their current HUMAN read permission;
    // a previous allowed source cannot authorize changed SQL or another model.
    for (const { item, revision } of visible) {
      const after = await ctx.dashboardService.getDashboardItem(
        item.id,
        project,
      );
      if (digest(after) !== digest(item))
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      const sources = await native.metadataSources(after.detail.sql);
      if (sources.revision !== revision)
        throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
      if (await permitted(sources.objects)) disclosed.push(item);
    }
    return disclosed;
  }

  private async governedPreview(
    ctx: IContext,
    sql: string,
    limit: number,
    cacheEnabled: boolean,
    refresh: boolean,
    identity: { idempotencyKey?: string; idempotencyScope?: string },
  ) {
    const config = await loadQueryDelivery();
    const scope = nativePreviewScope(config, ctx.nativeIdentityScope);
    const project = await ctx.projectService.getCurrentProject();
    if (config.projectId !== project.id || identity.idempotencyScope !== scope)
      throw new NativeQueryRefusal(409, 'QUERY_IDENTITY_CHANGED');
    const { components } = await import('@/common');
    const native = new NativeQueryService(
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
      native,
      components.apiHistoryRepository,
    ).previewSql(
      ctx.nativeHumanToken,
      identity.idempotencyKey,
      sql,
      limit,
      scope,
      false,
      undefined,
      undefined,
      { cacheEnabled, refresh },
    );
    return { ...receipt, previewScope: scope };
  }

  constructor() {
    this.getDashboard = this.getDashboard.bind(this);
    this.getDashboardItems = this.getDashboardItems.bind(this);
    this.createDashboardItem = this.createDashboardItem.bind(this);
    this.updateDashboardItem = this.updateDashboardItem.bind(this);
    this.deleteDashboardItem = this.deleteDashboardItem.bind(this);
    this.updateDashboardItemLayouts =
      this.updateDashboardItemLayouts.bind(this);
    this.previewItemSQL = this.previewItemSQL.bind(this);
    this.setDashboardSchedule = this.setDashboardSchedule.bind(this);
  }

  public async getDashboard(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<
    Omit<Dashboard, 'nextScheduledAt'> & {
      schedule: DashboardSchedule;
      items: DashboardItem[];
      nextScheduledAt: string | null;
    }
  > {
    const project = await ctx.projectService.getCurrentProject();
    const dashboard = await ctx.dashboardService.getCurrentDashboard(project);
    if (!dashboard) {
      throw new Error('Dashboard not found.');
    }
    const schedule = ctx.dashboardService.parseCronExpression(dashboard);
    const items = await this.readableItems(
      ctx,
      dashboard,
      project,
      await ctx.dashboardService.getDashboardItems(dashboard.id),
    );
    return {
      ...dashboard,
      nextScheduledAt: dashboard.nextScheduledAt
        ? new Date(dashboard.nextScheduledAt).toISOString()
        : null,
      schedule,
      items,
    };
  }

  public async getDashboardItems(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<DashboardItem[]> {
    const project = await ctx.projectService.getCurrentProject();
    const dashboard = await ctx.dashboardService.getCurrentDashboard(project);
    if (!dashboard) {
      throw new Error('Dashboard not found.');
    }
    return await this.readableItems(
      ctx,
      dashboard,
      project,
      await ctx.dashboardService.getDashboardItems(dashboard.id),
    );
  }

  public async createDashboardItem(
    _root: any,
    args: { data: { itemType: DashboardItemType; responseId: number } },
    ctx: IContext,
  ): Promise<DashboardItem> {
    const { responseId, itemType } = args.data;
    const project = await ctx.projectService.getCurrentProject();
    const dashboard = await ctx.dashboardService.getCurrentDashboard(project);
    if (!dashboard || dashboard.projectId !== project.id) {
      throw new Error('Dashboard not found.');
    }
    const response = await ctx.askingService.getResponse(responseId, project);

    if (!response) {
      throw new Error(`Thread response not found. responseId: ${responseId}`);
    }
    if (!Object.keys(ChartType).includes(itemType)) {
      throw new Error(`Chart type not supported. responseId: ${responseId}`);
    }
    if (!response.chartDetail?.chartSchema) {
      throw new Error(
        `Chart schema not found in thread response. responseId: ${responseId}`,
      );
    }

    // query with cache enabled
    const deployment = await ctx.deployService.getLastDeployment(project.id);
    const mdl = deployment.manifest;
    await ctx.queryService.preview(response.sql, {
      project,
      manifest: mdl,
      limit: DEFAULT_PREVIEW_LIMIT,
      cacheEnabled: true,
      refresh: true,
    });

    return await ctx.dashboardService.createDashboardItem(
      {
        dashboardId: dashboard.id,
        type: itemType,
        sql: response.sql,
        chartSchema: response.chartDetail?.chartSchema,
      },
      project,
    );
  }

  public async updateDashboardItem(
    _root: any,
    args: { where: { id: number }; data: { displayName: string } },
    ctx: IContext,
  ): Promise<DashboardItem> {
    const { id } = args.where;
    const { displayName } = args.data;
    const item = await ctx.dashboardService.getDashboardItem(id);
    if (!item) {
      throw new Error(`Dashboard item not found. id: ${id}`);
    }
    return await ctx.dashboardService.updateDashboardItem(id, { displayName });
  }

  public async deleteDashboardItem(
    _root: any,
    args: { where: { id: number } },
    ctx: IContext,
  ): Promise<boolean> {
    const { id } = args.where;
    const item = await ctx.dashboardService.getDashboardItem(id);
    if (!item) {
      throw new Error(`Dashboard item not found. id: ${id}`);
    }
    return await ctx.dashboardService.deleteDashboardItem(id);
  }

  public async updateDashboardItemLayouts(
    _root: any,
    args: { data: { layouts: UpdateDashboardItemLayouts } },
    ctx: IContext,
  ): Promise<DashboardItem[]> {
    const { layouts } = args.data;
    if (layouts.length === 0) {
      throw new Error('Layouts are required.');
    }
    return await ctx.dashboardService.updateDashboardItemLayouts(layouts);
  }

  public async previewItemSQL(
    _root: any,
    args: {
      data: {
        itemId: number;
        limit?: number;
        refresh?: boolean;
        idempotencyKey?: string;
        idempotencyScope?: string;
      };
    },
    ctx: IContext,
  ): Promise<PreviewItemResponse> {
    const { itemId, limit, refresh } = args.data;
    try {
      const project = await ctx.projectService.getCurrentProject();
      const item = await ctx.dashboardService.getDashboardItem(itemId, project);
      const { cacheEnabled } =
        await ctx.dashboardService.getCurrentDashboard(project);
      let receipt: any;
      let data: PreviewDataResponse;
      if (process.env.WREN_PLATFORM_QUERY_CONFIG_FILE !== undefined) {
        receipt = await this.governedPreview(
          ctx,
          item.detail.sql,
          limit ?? DEFAULT_PREVIEW_LIMIT,
          !!cacheEnabled,
          !!refresh,
          args.data,
        );
        const after = await ctx.dashboardService.getDashboardItem(
          itemId,
          project,
        );
        if (digest(after) !== digest(item))
          throw new NativeQueryRefusal(412, 'QUERY_REFERENCE_CHANGED');
        if (!queryReceiptState(receipt).completed)
          return {
            queryReceipt: { ...receipt, data: undefined, itemId },
            data: [],
            cacheHit: false,
            cacheCreatedAt: null,
            cacheOverrodeAt: null,
            override: false,
          };
        data = receipt.data;
      } else {
        const deployment = await ctx.deployService.getLastDeployment(
          project.id,
        );
        data = (await ctx.queryService.preview(item.detail.sql, {
          project,
          manifest: deployment.manifest,
          limit: limit || DEFAULT_PREVIEW_LIMIT,
          cacheEnabled,
          refresh: refresh || false,
        })) as PreviewDataResponse;
      }

      // handle data to [{ column1: value1, column2: value2, ... }]
      const values = data.data.map((val) => {
        return data.columns.reduce((acc, col, index) => {
          acc[col.name] = val[index];
          return acc;
        }, {});
      });
      return {
        cacheHit: data.cacheHit || false,
        cacheCreatedAt: data.cacheCreatedAt || null,
        cacheOverrodeAt: data.cacheOverrodeAt || null,
        override: data.override || false,
        data: values,
        ...(receipt
          ? { queryReceipt: { ...receipt, data: undefined, itemId } }
          : {}),
      } as PreviewItemResponse;
    } catch (error) {
      logger.error(`Error previewing SQL item ${itemId}: ${error}`);
      throw error;
    }
  }

  public async setDashboardSchedule(
    _root: any,
    args: { data: SetDashboardCacheData },
    ctx: IContext,
  ): Promise<Dashboard> {
    try {
      const dashboard = await ctx.dashboardService.getCurrentDashboard();
      if (!dashboard) {
        throw new Error('Dashboard not found.');
      }

      return await ctx.dashboardService.setDashboardSchedule(
        dashboard.id,
        args.data,
      );
    } catch (error) {
      logger.error(`Failed to set dashboard schedule: ${error.message}`);
      throw error;
    }
  }
}
