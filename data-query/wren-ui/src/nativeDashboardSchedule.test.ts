import { DashboardCacheBackgroundTracker } from './apollo/server/backgrounds/dashboardCacheBackgroundTracker';
import { DashboardCacheRefreshStatus } from './apollo/server/repositories/dashboardItemRefreshJobRepository';
import { getLogger } from './apollo/server/utils';

describe('original dashboard scheduled SQL admission boundary', () => {
  let previous: string | undefined;
  let dependencies: any;
  let info: jest.SpyInstance;
  const configured = () => {
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'delivered-binding';
  };
  const tracker = () => new DashboardCacheBackgroundTracker(dependencies);
  const check = (value: DashboardCacheBackgroundTracker) =>
    (value as any).checkAndRefreshCaches();

  beforeEach(() => {
    previous = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    jest.useFakeTimers();
    info = jest
      .spyOn(
        Object.getPrototypeOf(getLogger('DashboardCacheBackgroundTracker')),
        'info',
      )
      .mockImplementation(() => {});
    dependencies = {
      dashboardRepository: {
        findAllBy: jest
          .fn()
          .mockResolvedValue([
            { id: 3, scheduleCron: '* * * * *', nextScheduledAt: new Date(0) },
          ]),
        updateOne: jest.fn().mockResolvedValue(undefined),
      },
      dashboardItemRepository: {
        findAllBy: jest
          .fn()
          .mockResolvedValue([
            { id: 7, detail: { sql: 'select native_value from native_model' } },
          ]),
      },
      dashboardItemRefreshJobRepository: {
        createOne: jest.fn().mockImplementation(async (row) => ({
          ...row,
          id: row.dashboardItemId,
        })),
        updateOne: jest.fn().mockResolvedValue(undefined),
      },
      projectService: {
        getCurrentProject: jest.fn().mockResolvedValue({ id: 5 }),
      },
      deployService: {
        getLastDeployment: jest.fn().mockResolvedValue({ manifest: {} }),
      },
      queryService: {
        preview: jest.fn().mockResolvedValue({ data: [], columns: [] }),
      },
    };
  });
  afterEach(() => {
    info.mockRestore();
    jest.clearAllTimers();
    jest.useRealTimers();
    if (previous === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = previous;
  });

  it.each(['delivered-binding', '', 'missing-delivery'])(
    'does not start the native scheduler for configured delivery %p',
    async (value) => {
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = value;
      const valueTracker = tracker();
      expect(jest.getTimerCount()).toBe(0);
      await check(valueTracker);
      expect(dependencies.dashboardRepository.findAllBy).not.toHaveBeenCalled();
      expect(dependencies.queryService.preview).not.toHaveBeenCalled();
    },
  );

  it('retains the original independent scheduled query and native completion', async () => {
    const value = tracker();
    expect(jest.getTimerCount()).toBe(1);
    await check(value);
    expect(dependencies.queryService.preview).toHaveBeenCalledWith(
      'select native_value from native_model',
      { project: { id: 5 }, manifest: {}, cacheEnabled: true, refresh: true },
    );
    expect(
      dependencies.dashboardItemRefreshJobRepository.updateOne,
    ).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ status: DashboardCacheRefreshStatus.SUCCESS }),
    );
    expect(info).toHaveBeenCalledWith(
      'Finished Refreshing cache for dashboard 3',
    );
  });

  it('stops a timer created while independent once a binding is configured', async () => {
    const value = tracker();
    configured();
    await check(value);
    expect(dependencies.dashboardRepository.findAllBy).not.toHaveBeenCalled();
    expect(dependencies.queryService.preview).not.toHaveBeenCalled();
  });

  it.each(['items', 'project', 'deployment'])(
    'does not create query jobs after binding appears during the original %s read',
    async (boundary) => {
      const value = tracker();
      const selected =
        boundary === 'items'
          ? dependencies.dashboardItemRepository.findAllBy
          : boundary === 'project'
            ? dependencies.projectService.getCurrentProject
            : dependencies.deployService.getLastDeployment;
      const original = await selected();
      selected.mockImplementation(async () => {
        configured();
        return original;
      });
      await check(value);
      expect(
        dependencies.dashboardItemRefreshJobRepository.createOne,
      ).not.toHaveBeenCalled();
      expect(dependencies.queryService.preview).not.toHaveBeenCalled();
      expect(dependencies.dashboardRepository.updateOne).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalledWith(
        'Finished Refreshing cache for dashboard 3',
      );
    },
  );

  it('refuses the already-created native job if delivery changes while its insert awaits storage', async () => {
    const value = tracker();
    dependencies.dashboardItemRefreshJobRepository.createOne.mockImplementation(
      async (row) => {
        configured();
        return { ...row, id: row.dashboardItemId };
      },
    );
    await check(value);
    expect(dependencies.queryService.preview).not.toHaveBeenCalled();
    expect(
      dependencies.dashboardItemRefreshJobRepository.updateOne,
    ).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        status: DashboardCacheRefreshStatus.FAILED,
        errorMessage: 'QUERY_ADMISSION_UNAVAILABLE',
      }),
    );
    expect(dependencies.dashboardRepository.updateOne).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalledWith(
      'Finished Refreshing cache for dashboard 3',
    );
  });

  it('does not dispatch another pending item when a binding appears after one independent SQL has already started', async () => {
    const value = tracker();
    dependencies.dashboardItemRepository.findAllBy.mockResolvedValue([
      { id: 7, detail: { sql: 'select native_value from native_model' } },
      { id: 8, detail: { sql: 'select other_value from native_model' } },
    ]);
    dependencies.queryService.preview.mockImplementation(async () => {
      configured();
      return { data: [], columns: [] };
    });
    await check(value);
    expect(dependencies.queryService.preview).toHaveBeenCalledTimes(1);
    expect(
      dependencies.dashboardItemRefreshJobRepository.updateOne,
    ).toHaveBeenCalledWith(
      8,
      expect.objectContaining({
        status: DashboardCacheRefreshStatus.FAILED,
        errorMessage: 'QUERY_ADMISSION_UNAVAILABLE',
      }),
    );
    expect(
      dependencies.dashboardItemRefreshJobRepository.updateOne,
    ).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ status: DashboardCacheRefreshStatus.SUCCESS }),
    );
    expect(dependencies.dashboardRepository.updateOne).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalledWith(
      'Finished Refreshing cache for dashboard 3',
    );
  });
});
