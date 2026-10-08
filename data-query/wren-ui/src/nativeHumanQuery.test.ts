import {
  NativeHumanQuery,
  nativePreviewScope,
} from './apollo/server/services/nativeHumanQuery';
import { NativeQueryService } from './apollo/server/services/nativeQueryService';
import {
  ApiHistoryRepository,
  ApiType,
} from './apollo/server/repositories/apiHistoryRepository';
import {
  bindingServiceCall,
  digest,
  loadQueryDelivery,
  NativeQueryDelivery,
  NativeQueryRefusal,
} from './apollo/server/services/nativeQueryAdmission';
import { ModelResolver } from './apollo/server/resolvers/modelResolver';
import { AskingResolver } from './apollo/server/resolvers/askingResolver';
import { getQueryPreviewText } from './utils/language';
import referenceHandler from './pages/api/platform-query-reference';
import { ApiHistoryResolver } from './apollo/server/resolvers/apiHistoryResolver';
import { ApolloServer } from 'apollo-server-micro';
import GraphQLJSON from 'graphql-type-json';
import { typeDefs } from './apollo/server/schema';
import { API_HISTORY } from './apollo/client/graphql/apiManagement';
import { components } from './common';

jest.mock('./apollo/server/services/nativeQueryAdmission', () => ({
  ...jest.requireActual('./apollo/server/services/nativeQueryAdmission'),
  bindingServiceCall: jest.fn(),
  loadQueryDelivery: jest.fn(),
}));
jest.mock('./common', () => ({ components: { apiHistoryRepository: {} } }));

describe('native saved-view HUMAN query consumer', () => {
  const key = 'eb9081b2-1e2b-44e9-85c5-15b09e43c4a1';
  const binding = '8b066261-f827-462e-95c1-1d596fce1849';
  const resource = 'f0d7d739-666c-4cdb-927b-4bad718c94e2';
  const selection = {
    viewId: 7,
    deploymentId: 12,
    deploymentHash: 'b'.repeat(40),
    limit: 10,
  };
  const statement = 'SELECT customer FROM native_model';
  const nativeProject = {
    id: 3,
    type: 'DUCKDB',
    connectionInfo: {},
    catalog: 'wrenai',
    schema: 'public',
  };
  const connection = digest({
    type: nativeProject.type,
    connectionInfo: nativeProject.connectionInfo,
    catalog: nativeProject.catalog,
    schema: nativeProject.schema,
  });
  const capturedSources = [
    { nativeType: 'model' as const, nativeId: 8, nativeName: 'native_model' },
    { nativeType: 'view' as const, nativeId: 7, nativeName: 'native_view' },
  ];
  const reference = {
    resourceId: resource,
    nativeObjectRef: JSON.stringify(selection),
    nativeRevision: digest({
      bindingId: binding,
      projectId: 3,
      connection,
      selection,
      sql: statement,
    }),
    displayName: 'saved view',
    mediaType: 'application/json',
  };
  const submission = {
    actionExecutionId: '1c52c02c-0136-4652-a8d5-2af3921edbfc',
    operationId: '5f4ccbf4-a794-48f2-8bd1-39b453e623f7',
    actionKey: 'data_query.query@v1',
    gateState: 'ALLOWED',
    dispatchState: 'DISPATCHED',
  };
  const receipt = { submission, inputReference: reference };
  const config = {
    bindingId: binding,
    projectId: 3,
    projectConnectionDigest: connection,
    nativeInstanceRef: 'native-fixture',
    nativeScopeRef: '3',
    workspaceId: '02c405cd-786f-49fe-a460-0b94f98e014d',
    humanAction: {
      resultExposurePolicyId: 'f50e30ee-a9c6-4406-8620-7e45262f3145',
      resultExposurePolicyVersion: 1,
    },
  } as NativeQueryDelivery;
  const resolution = {
    resource: {
      resourceId: resource,
      resourceVersion: 4,
      nativeType: 'view',
      nativeRef: '7',
      nativeInstanceRef: config.nativeInstanceRef,
      nativeScopeRef: config.nativeScopeRef,
    },
  };
  const calls = jest.mocked(bindingServiceCall);
  const nativeRecord = (
    frozen = reference,
    sql = statement,
    columns: { name: string; type: string }[] = [],
    data: unknown[][] = [],
  ) => {
    const captured = JSON.parse(frozen.nativeObjectRef);
    return {
      projectId: config.projectId,
      governanceBindingId: binding,
      governanceState: 'SUCCEEDED' as const,
      apiType: ApiType.RUN_SQL,
      governanceKey: key,
      governanceParameterHash: digest({
        target: { resourceId: frozen.resourceId },
        input: frozen,
      }),
      governanceDeploymentId: captured.deploymentId,
      governanceDeploymentHash: captured.deploymentHash,
      requestPayload: {
        action: 'data_query.query@v1',
        sql,
        deploymentId: captured.deploymentId,
        deploymentHash: captured.deploymentHash,
        limit: captured.limit,
        nativeSources: capturedSources,
      },
      responsePayload: {
        columns,
        data,
        deploymentId: captured.deploymentId,
        deploymentHash: captured.deploymentHash,
      },
    };
  };
  let freeze: jest.Mock, history: jest.Mock, sources: jest.Mock;
  let service: NativeHumanQuery;
  beforeEach(() => {
    calls.mockReset();
    freeze = jest.fn().mockResolvedValue(reference);
    history = jest.fn();
    sources = jest.fn().mockResolvedValue(capturedSources);
    service = new NativeHumanQuery(
      config,
      {
        reference: freeze,
        modelReference: freeze,
        completedQuerySources: sources,
      } as unknown as NativeQueryService,
      { findOneBy: history } as unknown as ApiHistoryRepository,
    );
  });

  const originalHistory = (dryRun = false) => {
    const id = '60c94d6b-9dc1-4b7c-8b55-eb17c5b0de67';
    const action = dryRun ? 'data_query.dry_run@v1' : 'data_query.query@v1';
    const record = {
      ...nativeRecord(),
      id,
      governanceActionExecutionId: submission.actionExecutionId,
      governanceOperationId: submission.operationId,
      createdAt: '2026-10-08T00:00:00.000Z',
      updatedAt: '2026-10-08T00:00:00.000Z',
    };
    record.requestPayload.action = action;
    if (dryRun)
      record.responsePayload = {
        valid: true,
        deploymentId: selection.deploymentId,
        deploymentHash: selection.deploymentHash,
      } as any;
    const completed = {
      ...receipt,
      submission: { ...submission, actionKey: action },
      terminalStatus: 'COMPLETED',
      nativeType: 'wren.api_history',
      nativeId: id,
    };
    history.mockResolvedValue(record);
    calls.mockImplementation(async (_config, _operation, input) => {
      const query = input.resolveResource as any;
      if (query)
        return {
          resource: {
            ...resolution.resource,
            nativeType: query.nativeType,
            nativeRef: query.nativeRef,
          },
        };
      return completed;
    });
    return { record, completed };
  };

  it.each([false, true])(
    'reads the original API History query/dry-run body through the same AE and never admits a command (%s)',
    async (dryRun) => {
      const { record } = originalHistory(dryRun);
      expect(
        await service.readHistory('verified-native-token', record),
      ).toEqual({
        requestPayload: record.requestPayload,
        responsePayload: record.responsePayload,
      });
      expect(calls.mock.calls[0][2]).toEqual({
        bindingId: binding,
        idempotencyKey: key,
      });
      expect(calls.mock.calls.at(-1)[2].sourceResources).toEqual([
        { nativeType: 'model', nativeRef: '8' },
        { nativeType: 'view', nativeRef: '7' },
      ]);
      expect(calls.mock.calls.every((call) => !('command' in call[2]))).toBe(
        true,
      );
      expect(freeze).not.toHaveBeenCalled();
      expect(sources).toHaveBeenCalledTimes(2);
      expect(history).toHaveBeenLastCalledWith({
        id: record.id,
        projectId: config.projectId,
        governanceBindingId: binding,
        governanceKey: key,
        governanceActionExecutionId: submission.actionExecutionId,
        governanceOperationId: submission.operationId,
        governanceParameterHash: record.governanceParameterHash,
        governanceState: 'SUCCEEDED',
      });
    },
  );

  it.each(['absent', 'another AE', 'another native row', 'UNKNOWN'])(
    'refuses %s history receipt without a new command or native query',
    async (changed) => {
      const { record, completed } = originalHistory();
      calls.mockResolvedValue(
        changed === 'absent'
          ? null
          : changed === 'another AE'
            ? {
                ...completed,
                submission: { ...submission, actionExecutionId: binding },
              }
            : changed === 'another native row'
              ? { ...completed, nativeId: binding }
              : { ...completed, terminalStatus: 'UNKNOWN' },
      );
      await expect(
        service.readHistory('verified-native-token', record),
      ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
      expect(calls).toHaveBeenCalledTimes(1);
      expect(history).not.toHaveBeenCalled();
      expect(sources).not.toHaveBeenCalled();
      expect(freeze).not.toHaveBeenCalled();
    },
  );

  it('refuses native history mutation after source authorization instead of returning an earlier unauthorized payload', async () => {
    const { record } = originalHistory();
    history.mockResolvedValueOnce(record).mockResolvedValueOnce({
      ...record,
      requestPayload: { ...record.requestPayload, sql: 'SELECT changed' },
    });
    await expect(
      service.readHistory('verified-native-token', record),
    ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
    expect(calls.mock.calls.at(-1)[2].sourceResources).toHaveLength(2);
    expect(freeze).not.toHaveBeenCalled();
  });

  it('refuses the original API History body when completed native reader privileges drift', async () => {
    const { record } = originalHistory();
    sources.mockRejectedValue(
      new NativeQueryRefusal(403, 'BINDING_SCOPE_DENIED'),
    );
    await expect(
      service.readHistory('verified-native-token', record),
    ).rejects.toThrow('BINDING_SCOPE_DENIED');
    expect(calls).toHaveBeenCalledTimes(1);
    expect(freeze).not.toHaveBeenCalled();
  });

  it('rechecks native reader privileges changed during final same-AE history authorization', async () => {
    const { record, completed } = originalHistory();
    const authorize = calls.getMockImplementation();
    calls.mockImplementation(async (...args) => {
      if (args[2].sourceResources) {
        sources.mockRejectedValue(
          new NativeQueryRefusal(403, 'BINDING_SCOPE_DENIED'),
        );
        return completed;
      }
      return authorize(...args);
    });
    await expect(
      service.readHistory('verified-native-token', record),
    ).rejects.toThrow('BINDING_SCOPE_DENIED');
    expect(sources).toHaveBeenCalledTimes(2);
    expect(freeze).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'consumes the original API History GraphQL document and gates both SQL request and result fields (revoked %s)',
    async (revoked) => {
      const { record } = originalHistory();
      const oldConfig = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
        'fixture-controlled-delivery';
      jest.mocked(loadQueryDelivery).mockResolvedValue(config);
      const sourceReader = jest
        .spyOn(NativeQueryService.prototype, 'completedQuerySources')
        .mockImplementation(sources);
      const nativeHistory =
        components.apiHistoryRepository as ApiHistoryRepository;
      const oldReader = nativeHistory.findOneBy;
      nativeHistory.findOneBy = history;
      const ctx = {
        nativeHumanToken: 'verified-native-token',
        nativeIdentityScope: 'c'.repeat(64),
        projectService: {
          getCurrentProject: jest.fn().mockResolvedValue(nativeProject),
        },
        apiHistoryRepository: {
          count: jest.fn().mockResolvedValue(1),
          findAllWithPagination: jest.fn().mockResolvedValue([record]),
        },
      };
      if (revoked)
        sources.mockRejectedValue(
          new NativeQueryRefusal(403, 'BINDING_SCOPE_DENIED'),
        );
      const resolver = new ApiHistoryResolver();
      const server = new ApolloServer({
        typeDefs,
        resolvers: {
          JSON: GraphQLJSON,
          Query: { apiHistory: resolver.getApiHistory },
          ApiHistoryResponse: resolver.getApiHistoryNestedResolver(),
        },
        context: () => ctx,
      });
      try {
        await server.start();
        const result = await server.executeOperation({
          query: API_HISTORY,
          variables: { pagination: { offset: 0, limit: 10 } },
        });
        expect(ctx.apiHistoryRepository.count).toHaveBeenCalledWith(
          { projectId: config.projectId, governanceBindingId: binding },
          {},
        );
        expect(result.data.apiHistory.total).toBe(1);
        const visible = result.data.apiHistory.items[0];
        if (revoked) {
          expect(visible.requestPayload).toBeNull();
          expect(visible.responsePayload).toBeNull();
          expect(result.errors).toHaveLength(2);
          expect(
            result.errors.every(
              (error) => error.message === 'BINDING_SCOPE_DENIED',
            ),
          ).toBe(true);
        } else {
          expect(result.errors).toBeUndefined();
          expect(visible.requestPayload).toEqual(record.requestPayload);
          expect(visible.responsePayload).toEqual(record.responsePayload);
        }
        expect(calls.mock.calls.every((call) => !('command' in call[2]))).toBe(
          true,
        );
        expect(freeze).not.toHaveBeenCalled();
      } finally {
        await server.stop();
        sourceReader.mockRestore();
        nativeHistory.findOneBy = oldReader;
        if (oldConfig === undefined)
          delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
        else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = oldConfig;
      }
    },
  );

  it('rejects a foreign API History project filter before original count or row reads', async () => {
    const oldConfig = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'fixture-controlled-delivery';
    jest.mocked(loadQueryDelivery).mockResolvedValue(config);
    const ctx = {
      nativeHumanToken: 'verified-native-token',
      nativeIdentityScope: 'c'.repeat(64),
      projectService: {
        getCurrentProject: jest.fn().mockResolvedValue(nativeProject),
      },
      apiHistoryRepository: {
        count: jest.fn(),
        findAllWithPagination: jest.fn(),
      },
    };
    try {
      await expect(
        new ApiHistoryResolver().getApiHistory(
          null,
          {
            filter: { projectId: config.projectId + 1 },
            pagination: { offset: 0, limit: 10 },
          },
          ctx as any,
        ),
      ).rejects.toThrow('QUERY_SCOPE_DENIED');
      expect(ctx.apiHistoryRepository.count).not.toHaveBeenCalled();
      expect(
        ctx.apiHistoryRepository.findAllWithPagination,
      ).not.toHaveBeenCalled();
    } finally {
      if (oldConfig === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = oldConfig;
    }
  });
  it.each([false, true])(
    'submits the original SQL editor with its exact query/dry-run action and policy (%s)',
    async (dryRun) => {
      const scope = 'c'.repeat(64),
        historyId = '872bff6e-4a5b-4301-a3df-3fb92fd78321';
      const action = dryRun ? 'data_query.dry_run@v1' : 'data_query.query@v1';
      const frozenSelection = {
        modelId: 8,
        deploymentId: selection.deploymentId,
        deploymentHash: selection.deploymentHash,
        limit: 10,
        historyId,
      };
      const frozen = {
        ...reference,
        resourceId: binding,
        nativeObjectRef: JSON.stringify(frozenSelection),
      };
      const output = {
        ...receipt,
        submission: { ...submission, actionKey: action },
        inputReference: frozen,
      };
      const draft = { objects: capturedSources };
      const native = {
        sqlSelection: jest.fn().mockResolvedValue(draft),
        sqlReference: jest.fn().mockResolvedValue(frozen),
        sqlIntent: jest.fn().mockResolvedValue(frozenSelection),
      };
      const dryRunAction = {
        resultExposurePolicyId: 'a4f32fcf-374c-4565-a8b8-14b0f0d21c0c',
        resultExposurePolicyVersion: 2,
      };
      const human = new NativeHumanQuery(
        { ...config, dryRunAction },
        native as any,
        { findOneBy: history } as any,
      );
      calls.mockImplementation(async (_config, _operation, request) => {
        const resolved = request.resolveResource as any;
        if (resolved)
          return {
            resource: {
              ...resolution.resource,
              resourceId: resolved.nativeType === 'model' ? binding : resource,
              nativeType: resolved.nativeType,
              nativeRef: resolved.nativeRef,
            },
          };
        if (request.command)
          return {
            ...output,
            inputReference: { ...frozen, resourceId: binding },
          };
        return null;
      });
      expect(
        await human.previewSql(
          'verified-native-token',
          key,
          statement,
          10,
          scope,
          dryRun,
        ),
      ).toMatchObject({ submission: { actionKey: action } });
      expect(native.sqlSelection).toHaveBeenCalledWith(
        key,
        statement,
        10,
        scope,
        action,
      );
      expect(native.sqlReference).toHaveBeenCalledWith(binding, draft);
      const command = calls.mock.calls.find((call) => call[2].command)?.[2]
        .command as any;
      expect(command.componentAction).toEqual({
        actionVersion: 1,
        inputReference: frozen,
        ...(dryRun ? dryRunAction : config.humanAction),
      });
      expect(JSON.stringify(command)).not.toContain(statement);
      expect(
        calls.mock.calls.filter((call) => call[2].resolveResource),
      ).toHaveLength(4);
      expect(history).not.toHaveBeenCalled();
    },
  );

  it('never freezes or submits SQL when any current source is denied', async () => {
    const native = {
      sqlSelection: jest.fn().mockResolvedValue({ objects: capturedSources }),
      sqlReference: jest.fn(),
    };
    const human = new NativeHumanQuery(
      config,
      native as any,
      { findOneBy: history } as any,
    );
    calls
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'));
    await expect(
      human.previewSql(
        'verified-native-token',
        key,
        statement,
        10,
        'c'.repeat(64),
        false,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(native.sqlReference).not.toHaveBeenCalled();
    expect(calls.mock.calls.some((call) => call[2].command)).toBe(false);
  });

  it('does not use the query output policy for an unconfigured dry run', async () => {
    await expect(
      service.previewSql(
        'verified-native-token',
        key,
        statement,
        10,
        'c'.repeat(64),
        true,
      ),
    ).rejects.toThrow('NATIVE_HUMAN_ADMISSION_UNAVAILABLE');
    expect(calls).not.toHaveBeenCalled();
  });

  it('observes the original SQL-editor UNKNOWN without another selection or command', async () => {
    const frozenSelection = { ...selection, historyId: key };
    const output = {
      ...receipt,
      inputReference: {
        ...reference,
        nativeObjectRef: JSON.stringify(frozenSelection),
      },
    };
    const native = {
      sqlSelection: jest.fn(),
      sqlReference: jest.fn(),
      sqlIntent: jest.fn().mockResolvedValue(frozenSelection),
    };
    const human = new NativeHumanQuery(
      config,
      native as any,
      { findOneBy: history } as any,
    );
    calls.mockResolvedValue(output);
    expect(
      await human.previewSql(
        'verified-native-token',
        key,
        statement,
        10,
        'c'.repeat(64),
        false,
      ),
    ).toEqual(output);
    expect(native.sqlSelection).not.toHaveBeenCalled();
    expect(native.sqlReference).not.toHaveBeenCalled();
    expect(native.sqlIntent).toHaveBeenCalledWith(
      output.inputReference,
      key,
      statement,
      10,
      'c'.repeat(64),
      'data_query.query@v1',
    );
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('routes the actual SQL resolver through current HUMAN scope and never direct QueryService.preview', async () => {
    const original = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'fixture-controlled-delivery';
    const scope = nativePreviewScope(config, 'a'.repeat(64));
    const delegated = jest
      .spyOn(NativeHumanQuery.prototype, 'previewSql')
      .mockResolvedValue(receipt);
    jest.mocked(loadQueryDelivery).mockResolvedValue(config);
    const ctx: any = {
      nativeIdentityScope: 'a'.repeat(64),
      nativeHumanToken: 'verified-native-token',
      projectService: {
        getCurrentProject: jest
          .fn()
          .mockResolvedValue({ id: config.projectId }),
      },
      queryService: { preview: jest.fn() },
    };
    try {
      expect(
        await new ModelResolver().previewSql(
          null,
          {
            data: {
              sql: statement,
              limit: 10,
              dryRun: true,
              idempotencyKey: key,
              idempotencyScope: scope,
            },
          },
          ctx,
        ),
      ).toEqual({ ...receipt, previewScope: scope });
      expect(delegated).toHaveBeenCalledWith(
        'verified-native-token',
        key,
        statement,
        10,
        scope,
        true,
      );
      await expect(
        new ModelResolver().previewSql(
          null,
          {
            data: {
              sql: statement,
              limit: 10,
              idempotencyKey: key,
              idempotencyScope: 'b'.repeat(64),
            },
          },
          ctx,
        ),
      ).rejects.toThrow('QUERY_IDENTITY_CHANGED');
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
    } finally {
      delegated.mockRestore();
      if (original === undefined)
        delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = original;
    }
  });
  it('submits only a saved reference through the original action and never treats dispatch as data', async () => {
    calls
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(resolution)
      .mockResolvedValueOnce(receipt);
    expect(await service.preview('verified-native-token', 7, 10, key)).toEqual(
      receipt,
    );
    expect(freeze).toHaveBeenCalledWith(resource, 7, 10, undefined);
    expect(calls.mock.calls[1][2]).toEqual({
      bindingId: binding,
      resolveResource: {
        workspaceId: config.workspaceId,
        actionKey: 'data_query.query@v1',
        actionVersion: 1,
        nativeType: 'view',
        nativeRef: '7',
      },
    });
    const command = calls.mock.calls[2][2].command as any;
    expect(command.resourceId).toBe(resource);
    expect(command.resourceVersion).toBe(4);
    expect(command.componentAction.inputReference).toEqual(reference);
    expect(command.idempotencyKey).toBe(key);
    expect(command.actionKey).toBe('data_query.query@v1');
    expect(history).not.toHaveBeenCalled();
  });
  it('observes the same key without re-freezing a mutable view or repeating a query', async () => {
    calls.mockResolvedValue(receipt);
    expect(await service.preview('verified-native-token', 7, 10, key)).toEqual(
      receipt,
    );
    expect(calls).toHaveBeenCalledTimes(1);
    expect(freeze).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
  });

  it('selects different registered native objects without a configured global Resource and never reselects UNKNOWN', async () => {
    const cases = [
      { kind: 'view' as const, id: 7, resourceId: resource },
      { kind: 'model' as const, id: 8, resourceId: binding },
    ];
    for (const item of cases) {
      const frozen = {
        ...reference,
        resourceId: item.resourceId,
        nativeObjectRef: JSON.stringify({
          [item.kind === 'view' ? 'viewId' : 'modelId']: item.id,
          limit: 10,
        }),
      };
      const output = { ...receipt, inputReference: frozen };
      freeze.mockResolvedValueOnce(frozen);
      calls.mockReset();
      calls
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          resource: {
            ...resolution.resource,
            resourceId: item.resourceId,
            nativeType: item.kind,
            nativeRef: String(item.id),
          },
        })
        .mockResolvedValue(output);
      expect(
        await service.preview(
          'verified-native-token',
          item.id,
          10,
          item.resourceId,
          item.kind,
        ),
      ).toEqual(output);
      expect((calls.mock.calls[2][2].command as any).resourceId).toBe(
        item.resourceId,
      );
      calls.mockClear();
      expect(
        await service.preview(
          'verified-native-token',
          item.id,
          10,
          item.resourceId,
          item.kind,
        ),
      ).toEqual(output);
      expect(calls).toHaveBeenCalledTimes(1);
      expect(calls.mock.calls[0][2]).toEqual({
        bindingId: binding,
        idempotencyKey: item.resourceId,
      });
    }
    expect(freeze).toHaveBeenCalledTimes(2);
  });

  it.each([
    'missing',
    'resourceId',
    'resourceVersion',
    'nativeType',
    'nativeRef',
    'nativeInstanceRef',
    'nativeScopeRef',
  ])(
    'does not freeze or submit with %s invalid registered-resource facts',
    async (field) => {
      const changed =
        field === 'missing'
          ? null
          : {
              resource: {
                ...resolution.resource,
                [field]: field === 'resourceVersion' ? 0 : 'foreign-object',
              },
            };
      calls.mockResolvedValueOnce(null).mockResolvedValueOnce(changed);
      await expect(
        service.preview('verified-native-token', 7, 10, key),
      ).rejects.toThrow('QUERY_SCOPE_DENIED');
      expect(calls).toHaveBeenCalledTimes(2);
      expect(freeze).not.toHaveBeenCalled();
    },
  );

  it('refuses forbidden resource resolution and a submission receipt for another resolved Resource', async () => {
    calls
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'));
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('QUERY_SCOPE_DENIED');
    expect(freeze).not.toHaveBeenCalled();
    calls.mockReset();
    calls
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(resolution)
      .mockResolvedValueOnce({
        ...receipt,
        inputReference: { ...reference, resourceId: binding },
      });
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
  });
  it('does not submit after an unavailable or denied observation', async () => {
    calls.mockRejectedValue(new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'));
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('QUERY_SCOPE_DENIED');
    expect(calls).toHaveBeenCalledTimes(1);
    expect(freeze).not.toHaveBeenCalled();
  });
  it('returns original history only for the same AE, operation, binding and a second current admission', async () => {
    const completed = {
      ...receipt,
      terminalStatus: 'COMPLETED',
      nativeType: 'wren.api_history',
      nativeId: 'native-result',
    };
    calls.mockImplementation(async (_config, _operation, input) => {
      const query = input.resolveResource as any;
      if (query)
        return {
          resource: {
            ...resolution.resource,
            nativeType: query.nativeType,
            nativeRef: query.nativeRef,
          },
        };
      return completed;
    });
    history.mockResolvedValue(nativeRecord());
    expect(
      (await service.preview('verified-native-token', 7, 10, key)).data,
    ).toEqual(nativeRecord().responsePayload);
    expect(history).toHaveBeenCalledWith({
      id: 'native-result',
      projectId: 3,
      governanceBindingId: binding,
      governanceActionExecutionId: submission.actionExecutionId,
      governanceOperationId: submission.operationId,
      governanceKey: key,
      governanceState: 'SUCCEEDED',
    });
    expect(calls).toHaveBeenCalledTimes(4);
    expect(sources).toHaveBeenCalledTimes(2);
    expect(calls.mock.calls[1][2]).toMatchObject({
      resolveResource: {
        actionKey: 'data_query.query@v1',
        nativeType: 'model',
        nativeRef: '8',
      },
    });
    expect(calls.mock.calls[2][2]).toMatchObject({
      resolveResource: {
        actionKey: 'data_query.query@v1',
        nativeType: 'view',
        nativeRef: '7',
      },
    });
    expect(calls.mock.calls[3][2]).toEqual({
      bindingId: binding,
      idempotencyKey: key,
      sourceResources: [
        { nativeType: 'model', nativeRef: '8' },
        { nativeType: 'view', nativeRef: '7' },
      ],
    });
    calls.mockReset();
    calls
      .mockResolvedValueOnce(completed)
      .mockRejectedValueOnce(new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'));
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('QUERY_SCOPE_DENIED');
  });

  it.each([
    'another native source',
    'denied source permission',
    'changed sources during authorization',
  ])('does not disclose the original result with %s', async (failure) => {
    const completed = {
      ...receipt,
      terminalStatus: 'COMPLETED',
      nativeType: 'wren.api_history',
      nativeId: 'native-result',
    };
    history.mockResolvedValue(nativeRecord());
    if (failure === 'changed sources during authorization')
      sources
        .mockResolvedValueOnce(capturedSources)
        .mockResolvedValueOnce(capturedSources.slice(1));
    calls.mockImplementation(async (_config, _operation, input) => {
      const query = input.resolveResource as any;
      if (!query) return completed;
      if (failure === 'denied source permission')
        throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
      return {
        resource: {
          ...resolution.resource,
          nativeType: query.nativeType,
          nativeRef:
            failure === 'another native source' ? '99' : query.nativeRef,
        },
      };
    });
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow(
      failure === 'changed sources during authorization'
        ? 'QUERY_REFERENCE_CHANGED'
        : 'QUERY_SCOPE_DENIED',
    );
    expect(
      calls.mock.calls.filter((call) => !call[2].resolveResource),
    ).toHaveLength(failure === 'changed sources during authorization' ? 2 : 1);
    expect(freeze).not.toHaveBeenCalled();
  });

  it('does not disclose completed native data when the same AE source read/export policy intersection is denied', async () => {
    const completed = {
      ...receipt,
      terminalStatus: 'COMPLETED',
      nativeType: 'wren.api_history',
      nativeId: 'native-result',
    };
    history.mockResolvedValue(nativeRecord());
    calls.mockImplementation(async (_config, _operation, input) => {
      if (input.sourceResources)
        throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
      const query = input.resolveResource as any;
      if (query)
        return {
          resource: {
            ...resolution.resource,
            nativeType: query.nativeType,
            nativeRef: query.nativeRef,
          },
        };
      return completed;
    });
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('QUERY_SCOPE_DENIED');
    expect(calls.mock.calls.at(-1)[2].sourceResources).toEqual([
      { nativeType: 'model', nativeRef: '8' },
      { nativeType: 'view', nativeRef: '7' },
    ]);
    expect(freeze).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'discloses the original SQL-editor history only after current same-AE source policy checks (dry run %s)',
    async (dryRun) => {
      const id = 'e70f46be-16d8-40ae-8bfb-38bdc28615bc';
      const selected = { ...selection, historyId: id };
      const frozen = {
        ...reference,
        nativeObjectRef: JSON.stringify(selected),
        nativeRevision: digest({
          bindingId: binding,
          projectId: config.projectId,
          connection,
          selection: selected,
          sql: statement,
        }),
      };
      const action = dryRun ? 'data_query.dry_run@v1' : 'data_query.query@v1';
      const completed = {
        ...receipt,
        inputReference: frozen,
        submission: { ...submission, actionKey: action },
        terminalStatus: 'COMPLETED',
        nativeType: 'wren.api_history',
        nativeId: id,
      };
      const record = nativeRecord(frozen);
      record.requestPayload.action = action;
      if (dryRun)
        record.responsePayload = {
          valid: true,
          deploymentId: selection.deploymentId,
          deploymentHash: selection.deploymentHash,
        } as any;
      history.mockResolvedValue(record);
      const native = {
        sqlIntent: jest.fn().mockResolvedValue(selected),
        sqlSelection: jest.fn(),
        sqlReference: jest.fn(),
        completedQuerySources: sources,
      };
      const human = new NativeHumanQuery(
        { ...config, dryRunAction: config.humanAction },
        native as any,
        { findOneBy: history } as any,
      );
      calls.mockImplementation(async (_config, _operation, input) => {
        const query = input.resolveResource as any;
        if (query)
          return {
            resource: {
              ...resolution.resource,
              nativeType: query.nativeType,
              nativeRef: query.nativeRef,
            },
          };
        return completed;
      });
      const result = await human.previewSql(
        'verified-native-token',
        key,
        statement,
        10,
        'c'.repeat(64),
        dryRun,
      );
      expect(result.data).toEqual(record.responsePayload);
      expect(calls.mock.calls.at(-1)[2].sourceResources).toEqual([
        { nativeType: 'model', nativeRef: '8' },
        { nativeType: 'view', nativeRef: '7' },
      ]);
      expect(
        calls.mock.calls
          .filter((call) => call[2].resolveResource)
          .every(
            (call) => (call[2].resolveResource as any).actionKey === action,
          ),
      ).toBe(true);
      expect(native.sqlSelection).not.toHaveBeenCalled();
      expect(native.sqlReference).not.toHaveBeenCalled();
    },
  );

  it.each([
    'missing history',
    'wrong API type',
    'another intent key',
    'another parameter hash',
    'another deployment ID',
    'another deployment hash',
    'missing SQL',
    'changed SQL',
    'another action',
    'request deployment ID',
    'request deployment hash',
    'request limit',
    'result deployment ID',
    'result deployment hash',
    'missing column type',
    'invalid row width',
    'unknown selection field',
    'missing selection deployment',
  ])(
    'refuses %s in the actual HUMAN history result consumer',
    async (changed) => {
      const completed = {
        ...receipt,
        inputReference: { ...reference },
        terminalStatus: 'COMPLETED',
        nativeType: 'wren.api_history',
        nativeId: 'native-result',
      };
      const record: any = nativeRecord();
      if (changed === 'wrong API type') record.apiType = ApiType.GET_MODELS;
      if (changed === 'another intent key') record.governanceKey = binding;
      if (changed === 'another parameter hash')
        record.governanceParameterHash = 'd'.repeat(64);
      if (changed === 'another deployment ID') record.governanceDeploymentId++;
      if (changed === 'another deployment hash')
        record.governanceDeploymentHash = 'd'.repeat(40);
      if (changed === 'missing SQL') delete record.requestPayload.sql;
      if (changed === 'changed SQL')
        record.requestPayload.sql = 'SELECT private';
      if (changed === 'another action')
        record.requestPayload.action = 'data_query.dry_run@v1';
      if (changed === 'request deployment ID')
        record.requestPayload.deploymentId++;
      if (changed === 'request deployment hash')
        record.requestPayload.deploymentHash = 'd'.repeat(40);
      if (changed === 'request limit') record.requestPayload.limit++;
      if (changed === 'result deployment ID')
        record.responsePayload.deploymentId++;
      if (changed === 'result deployment hash')
        record.responsePayload.deploymentHash = 'd'.repeat(40);
      if (changed === 'missing column type')
        record.responsePayload.columns = [{ name: 'customer' }];
      if (changed === 'invalid row width') record.responsePayload.data = [[1]];
      if (changed === 'unknown selection field')
        completed.inputReference.nativeObjectRef = JSON.stringify({
          ...selection,
          source: 'untrusted',
        });
      if (changed === 'missing selection deployment')
        completed.inputReference.nativeObjectRef = JSON.stringify({
          viewId: selection.viewId,
          limit: selection.limit,
        });
      calls.mockResolvedValue(completed);
      history.mockResolvedValue(changed === 'missing history' ? null : record);
      await expect(
        service.preview('verified-native-token', 7, 10, key),
      ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
      expect(calls).toHaveBeenCalledTimes(1);
      expect(freeze).not.toHaveBeenCalled();
    },
  );
  it.each(['RUNNING', 'FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT'])(
    'consumes the original %s task receipt without inventing native result rows',
    async (terminalStatus) => {
      const observed = { ...receipt, terminalStatus };
      calls.mockResolvedValue(observed);
      expect(
        await service.preview('verified-native-token', 7, 10, key),
      ).toEqual(observed);
      expect(calls).toHaveBeenCalledTimes(1);
      expect(freeze).not.toHaveBeenCalled();
      expect(history).not.toHaveBeenCalled();
    },
  );
  it.each([
    { terminalStatus: 'UNKNOWN' },
    { terminalStatus: 'SUCCESS' },
    { terminalStatus: '' },
    { terminalStatus: null },
    { terminalStatus: 7 },
    { submission: { ...submission, gateState: 'NEW_GATE' } },
    { submission: { ...submission, gateState: null } },
    { submission: { ...submission, dispatchState: 'NEW_DISPATCH' } },
    { submission: { ...submission, dispatchState: null } },
    ...['FAILED', 'CANCELED', 'TERMINATED', 'TIMED_OUT'].map(
      (terminalStatus) => ({
        terminalStatus,
        submission: { ...submission, dispatchState: 'UNKNOWN' },
      }),
    ),
    {
      terminalStatus: 'COMPLETED',
      submission: { ...submission, dispatchState: 'UNKNOWN' },
    },
    {
      terminalStatus: 'COMPLETED',
      submission: { ...submission, gateState: 'REVOKED' },
    },
  ])(
    'refuses unknown or contradictory task receipt evidence %j',
    async (changed) => {
      calls.mockResolvedValue({ ...receipt, ...changed });
      await expect(
        service.preview('verified-native-token', 7, 10, key),
      ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
      expect(calls).toHaveBeenCalledTimes(1);
      expect(freeze).not.toHaveBeenCalled();
      expect(history).not.toHaveBeenCalled();
    },
  );
  it('rejects another saved view or resource instead of exposing the result', async () => {
    calls.mockResolvedValue({
      ...receipt,
      inputReference: { ...reference, resourceId: 'invalid-reference' },
    });
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
    calls.mockResolvedValue(receipt);
    await expect(
      service.preview('verified-native-token', 8, 10, key),
    ).rejects.toThrow('QUERY_INTENT_CONFLICT');
    expect(history).not.toHaveBeenCalled();
  });
  it('requires an actual HUMAN token and delivered resource selection', async () => {
    await expect(service.preview(undefined, 7, 10, key)).rejects.toThrow(
      'NATIVE_HUMAN_ADMISSION_UNAVAILABLE',
    );
    const disabled = new NativeHumanQuery(
      { ...config, humanAction: undefined },
      {} as NativeQueryService,
      {} as ApiHistoryRepository,
    );
    await expect(
      disabled.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('NATIVE_HUMAN_ADMISSION_UNAVAILABLE');
    expect(calls).not.toHaveBeenCalled();
  });

  it('admits the original model preview and reconciles its frozen model reference without issuing SQL', async () => {
    const modelReference = {
      ...reference,
      nativeObjectRef: JSON.stringify({ modelId: 7, limit: 10 }),
    };
    const modelReceipt = { ...receipt, inputReference: modelReference };
    freeze.mockResolvedValue(modelReference);
    calls
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        resource: { ...resolution.resource, nativeType: 'model' },
      })
      .mockResolvedValue(modelReceipt);
    expect(
      await service.preview('verified-native-token', 7, 10, key, 'model'),
    ).toEqual(modelReceipt);
    expect(freeze).toHaveBeenCalledTimes(1);
    expect(
      (calls.mock.calls[2][2].command as any).componentAction.inputReference,
    ).toEqual(modelReference);
    expect(
      await service.preview('verified-native-token', 7, 10, key, 'model'),
    ).toEqual(modelReceipt);
    expect(freeze).toHaveBeenCalledTimes(1);
    await expect(
      service.preview('verified-native-token', 7, 10, key),
    ).rejects.toThrow('QUERY_INTENT_CONFLICT');
    await expect(
      service.preview('verified-native-token', 8, 10, key, 'model'),
    ).rejects.toThrow('QUERY_INTENT_CONFLICT');
    expect(history).not.toHaveBeenCalled();
  });

  it('routes the actual model resolver through HUMAN admission rather than direct engine preview', async () => {
    jest.mocked(loadQueryDelivery).mockResolvedValue(config);
    const ctx: any = {
      nativeIdentityScope: 'a'.repeat(64),
      nativeHumanToken: 'verified-native-token',
      projectService: {
        getCurrentProject: jest.fn().mockResolvedValue({ id: 3 }),
      },
      modelRepository: {
        findOneBy: jest.fn().mockResolvedValue({ id: 7, projectId: 3 }),
      },
      queryService: { preview: jest.fn() },
    };
    const modelReceipt = {
      ...receipt,
      inputReference: {
        ...reference,
        nativeObjectRef: JSON.stringify({ modelId: 7, limit: 10 }),
      },
    };
    calls.mockResolvedValue(modelReceipt);
    const scope = nativePreviewScope(config, ctx.nativeIdentityScope);
    expect(
      await new ModelResolver().previewModelData(
        null,
        {
          where: {
            id: 7,
            limit: 10,
            idempotencyKey: key,
            idempotencyScope: scope,
          },
        },
        ctx,
      ),
    ).toEqual({ ...modelReceipt, previewScope: scope });
    expect(ctx.modelRepository.findOneBy).toHaveBeenCalledWith({
      id: 7,
      projectId: 3,
    });
    expect(ctx.queryService.preview).not.toHaveBeenCalled();
    expect(calls).toHaveBeenCalledTimes(1);
    await expect(
      new ModelResolver().previewModelData(
        null,
        {
          where: {
            id: 7,
            limit: 10,
            idempotencyKey: key,
            idempotencyScope: 'forged',
          },
        },
        ctx,
      ),
    ).rejects.toThrow('QUERY_IDENTITY_CHANGED');
    expect(calls).toHaveBeenCalledTimes(1);
  });

  describe('original Asking saved-view preview consumer', () => {
    const view = {
      id: 7,
      projectId: 3,
      name: 'native_view',
      statement: 'SELECT customer FROM native_model',
    };
    let ctx: any, where: any, observed: any, command: any;
    let completed: boolean;
    beforeEach(() => {
      jest.mocked(loadQueryDelivery).mockResolvedValue(config);
      completed = false;
      observed = null;
      command = null;
      const response = { id: 21, threadId: 11, viewId: 7, sql: view.statement };
      ctx = {
        nativeIdentityScope: 'a'.repeat(64),
        nativeHumanToken: 'verified-native-token',
        projectService: {
          getCurrentProject: jest.fn(async () => ({ id: 3 })),
        },
        projectRepository: { findOneBy: jest.fn(async () => nativeProject) },
        askingService: {
          getResponse: jest.fn(async () => ({ ...response })),
        },
        viewRepository: {
          findOneBy: jest.fn(async () => ({ ...view })),
        },
        deployRepository: {
          findLastProjectDeployLog: jest.fn(async () => ({
            id: 12,
            projectId: 3,
            hash: 'b'.repeat(40),
            status: 'SUCCESS',
          })),
          findOneBy: jest.fn(async () => ({
            id: 12,
            projectId: 3,
            hash: 'b'.repeat(40),
            status: 'SUCCESS',
            manifest: {
              catalog: nativeProject.catalog,
              schema: nativeProject.schema,
              models: [{ name: 'native_model', columns: [] }],
              views: [
                {
                  name: view.name,
                  statement: view.statement,
                  properties: { viewId: String(view.id) },
                },
              ],
            },
            nativeObjectRefs: capturedSources,
          })),
        },
        modelRepository: {
          findOneBy: jest.fn(async () => ({
            id: 8,
            projectId: 3,
            referenceName: 'native_model',
          })),
        },
        queryService: {
          preview: jest.fn(),
          sourceObjects: jest.fn(async () => [
            {
              catalog: nativeProject.catalog,
              schema: nativeProject.schema,
              table: 'native_model',
            },
          ]),
        },
      };
      where = {
        responseId: 21,
        limit: 10,
        idempotencyKey: key,
        idempotencyScope: nativePreviewScope(config, ctx.nativeIdentityScope),
      };
      require('./common').components.apiHistoryRepository.findOneBy = history;
      history.mockImplementation(async () =>
        nativeRecord(
          command.componentAction.inputReference,
          view.statement,
          [{ name: 'customer', type: 'VARCHAR' }],
          [['native']],
        ),
      );
      calls.mockImplementation(async (_config, _operation, input, token) => {
        expect(token).toBe('verified-native-token');
        const payload = input as any;
        if (payload.resolveResource)
          return {
            resource: {
              ...resolution.resource,
              nativeType: payload.resolveResource.nativeType,
              nativeRef: payload.resolveResource.nativeRef,
            },
          };
        if (payload.command) {
          command = payload.command;
          observed = {
            submission,
            inputReference: command.componentAction.inputReference,
            ...(completed
              ? {
                  terminalStatus: 'COMPLETED',
                  nativeType: 'wren.api_history',
                  nativeId: 'native-result',
                }
              : {}),
          };
        }
        return observed;
      });
    });
    it.each([false, true])(
      'uses real original view reference/admission/result consumers without direct SQL (completed=%s)',
      async (isCompleted) => {
        completed = isCompleted;
        const result = await new AskingResolver().previewData(
          null,
          { where },
          ctx,
        );
        expect(result).toMatchObject({
          responseId: 21,
          viewId: 7,
          previewScope: where.idempotencyScope,
          inputReference: {
            resourceId: resource,
            nativeObjectRef: expect.any(String),
            nativeRevision: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        });
        expect(JSON.parse(result.inputReference.nativeObjectRef)).toEqual({
          viewId: 7,
          deploymentId: 12,
          deploymentHash: 'b'.repeat(40),
          limit: 10,
        });
        expect(command).toMatchObject({
          actionKey: 'data_query.query@v1',
          idempotencyKey: key,
          resourceId: resource,
          resourceVersion: 4,
        });
        expect(JSON.stringify(command)).not.toContain(view.statement);
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
        if (completed) {
          expect(result.data).toEqual({
            columns: [{ name: 'customer', type: 'VARCHAR' }],
            data: [['native']],
            deploymentId: 12,
            deploymentHash: 'b'.repeat(40),
          });
          expect(history).toHaveBeenCalledWith({
            id: 'native-result',
            projectId: 3,
            governanceBindingId: binding,
            governanceActionExecutionId: submission.actionExecutionId,
            governanceOperationId: submission.operationId,
            governanceKey: key,
            governanceState: 'SUCCEEDED',
          });
        } else {
          expect(result).not.toHaveProperty('data');
          expect(result).not.toHaveProperty('terminalStatus');
          expect(history).not.toHaveBeenCalled();
        }
        const replay = await new AskingResolver().previewData(
          null,
          { where },
          ctx,
        );
        expect(replay).toEqual(result);
        expect(
          ctx.deployRepository.findLastProjectDeployLog,
        ).toHaveBeenCalledTimes(1);
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it.each(['scope', 'missing', 'generated', 'changed-sql', 'denied'])(
      'refuses %s before submitting a view query',
      async (failure) => {
        if (failure === 'scope') where.idempotencyScope = 'forged';
        if (failure === 'missing')
          ctx.askingService.getResponse.mockResolvedValue(null);
        if (failure === 'generated')
          ctx.askingService.getResponse.mockResolvedValue({
            id: 21,
            threadId: 11,
            viewId: null,
            sql: 'SELECT private FROM forbidden_model',
          });
        if (failure === 'changed-sql')
          ctx.askingService.getResponse.mockResolvedValue({
            id: 21,
            threadId: 11,
            viewId: 7,
            sql: 'SELECT private FROM forbidden_model',
          });
        if (failure === 'denied')
          calls.mockRejectedValue(
            new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'),
          );
        await expect(
          new AskingResolver().previewData(null, { where }, ctx),
        ).rejects.toThrow();
        expect(command).toBeNull();
        expect(history).not.toHaveBeenCalled();
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it.each(['response', 'view', 'revoked'])(
      'refuses %s changes after a completed query without returning its native rows',
      async (changed) => {
        completed = true;
        const original = ctx.askingService.getResponse.getMockImplementation();
        ctx.askingService.getResponse.mockImplementation(async () => {
          const value = await original();
          if (command && changed === 'response') value.sql = 'SELECT changed';
          return value;
        });
        const originalView =
          ctx.viewRepository.findOneBy.getMockImplementation();
        ctx.viewRepository.findOneBy.mockImplementation(async () => {
          const value = await originalView();
          if (command && changed === 'view') value.statement = 'SELECT changed';
          return value;
        });
        const originalCall = calls.getMockImplementation();
        calls.mockImplementation(async (...args) => {
          if (
            command &&
            changed === 'revoked' &&
            (args[2] as any).resolveResource
          )
            throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
          return originalCall(...args);
        });
        await expect(
          new AskingResolver().previewData(null, { where }, ctx),
        ).rejects.toThrow();
        expect(command.actionKey).toBe('data_query.query@v1');
        expect(history).toHaveBeenCalledTimes(1);
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it.each([false, true])(
      'refuses a changed view before command submission even if it changes back (ABA=%s)',
      async (changesBack) => {
        completed = true;
        let reads = 0;
        ctx.viewRepository.findOneBy.mockImplementation(async () => {
          reads++;
          // The initial authorized snapshot is S1. The actual reference read
          // sees S2; an eventual re-read alone would miss S1 -> S2 -> S1.
          return {
            ...view,
            statement:
              reads >= 3 && (!changesBack || reads === 3)
                ? 'SELECT private FROM another_model'
                : view.statement,
          };
        });
        await expect(
          new AskingResolver().previewData(null, { where }, ctx),
        ).rejects.toThrow('QUERY_REFERENCE_CHANGED');
        expect(reads).toBe(3);
        expect(command).toBeNull();
        expect(history).not.toHaveBeenCalled();
        expect(ctx.queryService.preview).not.toHaveBeenCalled();
      },
    );
    it('does not reuse a previously frozen view statement for a changed Asking intent under the same key', async () => {
      let statement = 'SELECT previous FROM native_model';
      ctx.askingService.getResponse.mockImplementation(async () => ({
        id: 21,
        threadId: 11,
        viewId: 7,
        sql: statement,
      }));
      ctx.viewRepository.findOneBy.mockImplementation(async () => ({
        ...view,
        statement,
      }));
      const first = await new AskingResolver().previewData(
        null,
        { where },
        ctx,
      );
      expect(first).not.toHaveProperty('data');
      const frozen = first.inputReference.nativeRevision;
      statement = view.statement;
      await expect(
        new AskingResolver().previewData(null, { where }, ctx),
      ).rejects.toThrow('QUERY_REFERENCE_CHANGED');
      expect(command.componentAction.inputReference.nativeRevision).toBe(
        frozen,
      );
      expect(
        ctx.deployRepository.findLastProjectDeployLog,
      ).toHaveBeenCalledTimes(1);
      expect(history).not.toHaveBeenCalled();
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
    });
    it('does not substitute a saved-view reference for a partial CTE', async () => {
      ctx.askingService.getResponse.mockResolvedValue({
        id: 21,
        threadId: 11,
        viewId: 7,
        sql: view.statement,
        breakdownDetail: {
          steps: [
            {
              cteName: 'partial',
              summary: 'First step',
              sql: 'SELECT private FROM forbidden_model',
            },
          ],
        },
      });
      await expect(
        new AskingResolver().previewBreakdownData(
          null,
          {
            where: { ...where, stepIndex: 0 },
          },
          ctx,
        ),
      ).rejects.toThrow('QUERY_REFERENCE_CHANGED');
      expect(command).toBeNull();
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
    });
    it('does not abandon the original preview when an unrelated answer finishes streaming', async () => {
      completed = true;
      const original = ctx.askingService.getResponse.getMockImplementation();
      ctx.askingService.getResponse.mockImplementation(async () => ({
        ...(await original()),
        answerDetail: {
          content: command
            ? 'Original answer finished'
            : 'Original answer streaming',
        },
      }));
      const result = await new AskingResolver().previewData(
        null,
        { where },
        ctx,
      );
      expect(result.data).toEqual({
        columns: [{ name: 'customer', type: 'VARCHAR' }],
        data: [['native']],
        deploymentId: 12,
        deploymentHash: 'b'.repeat(40),
      });
      expect(ctx.queryService.preview).not.toHaveBeenCalled();
      expect(JSON.stringify(command)).not.toContain('Original answer');
    });
  });

  it('retains one person across credential rotation and separates another person or native binding', () => {
    const first = nativePreviewScope(config, 'a'.repeat(64));
    expect(
      nativePreviewScope(
        { ...config, serviceClientSecretFile: '/rotated-credential' },
        'a'.repeat(64),
      ),
    ).toBe(first);
    expect(nativePreviewScope(config, 'b'.repeat(64))).not.toBe(first);
    expect(
      nativePreviewScope({ ...config, bindingId: resource }, 'a'.repeat(64)),
    ).not.toBe(first);
    expect(() => nativePreviewScope(config, undefined)).toThrow(
      'NATIVE_AUTHENTICATION_REQUIRED',
    );
  });

  it('refuses forged or previous-person scope at the actual preview resolver before any Core or native call', async () => {
    jest.mocked(loadQueryDelivery).mockResolvedValue(config);
    const ctx: any = {
      nativeIdentityScope: 'b'.repeat(64),
      nativeHumanToken: 'verified-native-token',
    };
    for (const idempotencyScope of [
      undefined,
      'forged',
      nativePreviewScope(config, 'a'.repeat(64)),
    ]) {
      await expect(
        new ModelResolver().previewViewData(
          null,
          {
            where: { id: 7, limit: 10, idempotencyKey: key, idempotencyScope },
          },
          ctx,
        ),
      ).rejects.toThrow('QUERY_IDENTITY_CHANGED');
    }
    expect(calls).not.toHaveBeenCalled();
    calls.mockResolvedValue(receipt);
    const idempotencyScope = nativePreviewScope(
      config,
      ctx.nativeIdentityScope,
    );
    expect(
      await new ModelResolver().previewViewData(
        null,
        {
          where: { id: 7, limit: 10, idempotencyKey: key, idempotencyScope },
        },
        ctx,
      ),
    ).toEqual({ ...receipt, previewScope: idempotencyScope });
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('exports only the resolved native view resource through the actual reference handler', async () => {
    jest.mocked(loadQueryDelivery).mockResolvedValue(config);
    calls.mockResolvedValue(resolution);
    const nativeReference = jest
      .spyOn(NativeQueryService.prototype, 'reference')
      .mockResolvedValue(reference);
    const response: any = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      end: jest.fn(),
    };
    try {
      await referenceHandler(
        {
          method: 'GET',
          headers: { 'x-kailo-native-human-token': 'verified-native-token' },
          query: { viewId: '7', limit: '10' },
        } as any,
        response,
      );
      expect(response.status).toHaveBeenLastCalledWith(200);
      expect(response.json).toHaveBeenCalledWith(reference);
      expect(nativeReference).toHaveBeenCalledWith(resource, 7, 10);
      expect(calls).toHaveBeenCalledTimes(2);
      for (const call of calls.mock.calls) {
        expect(call[2]).toEqual({
          bindingId: binding,
          resolveResource: {
            workspaceId: config.workspaceId,
            actionKey: 'data_query.query@v1',
            actionVersion: 1,
            nativeType: 'view',
            nativeRef: '7',
          },
        });
        expect(call[3]).toBe('verified-native-token');
      }
    } finally {
      nativeReference.mockRestore();
    }
  });

  it.each([
    'missing-token',
    'forged-resource',
    'denied',
    'revoked',
    'changed-resource',
    'changed-version',
  ])('does not disclose an exported reference for %s', async (failure) => {
    jest.mocked(loadQueryDelivery).mockResolvedValue(config);
    calls.mockResolvedValue(resolution);
    if (failure === 'denied')
      calls.mockRejectedValue(
        new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'),
      );
    if (failure === 'revoked')
      calls
        .mockResolvedValueOnce(resolution)
        .mockRejectedValueOnce(
          new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'),
        );
    if (failure === 'changed-resource' || failure === 'changed-version')
      calls.mockResolvedValueOnce(resolution).mockResolvedValueOnce({
        resource: {
          ...resolution.resource,
          ...(failure === 'changed-resource'
            ? { resourceId: binding }
            : { resourceVersion: 5 }),
        },
      });
    const nativeReference = jest
      .spyOn(NativeQueryService.prototype, 'reference')
      .mockResolvedValue(reference);
    const response: any = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      end: jest.fn(),
    };
    try {
      await referenceHandler(
        {
          method: 'GET',
          headers:
            failure === 'missing-token'
              ? {}
              : { 'x-kailo-native-human-token': 'verified-native-token' },
          query: {
            viewId: '7',
            limit: '10',
            ...(failure === 'forged-resource' ? { resourceId: resource } : {}),
          },
        } as any,
        response,
      );
      expect(response.status).toHaveBeenLastCalledWith(
        failure === 'missing-token'
          ? 401
          : failure === 'forged-resource'
            ? 400
            : failure.startsWith('changed-')
              ? 409
              : 403,
      );
      expect(response.json).not.toHaveBeenCalledWith(reference);
      if (['missing-token', 'forged-resource', 'denied'].includes(failure))
        expect(nativeReference).not.toHaveBeenCalled();
    } finally {
      nativeReference.mockRestore();
    }
  });

  it('uses Chinese by default and a single English locale for necessary preview guidance', () => {
    expect(getQueryPreviewText().check).toBe('检查原查询');
    expect(getQueryPreviewText('en').check).toBe('Check query');
    expect(Object.values(getQueryPreviewText('en')).join(' ')).not.toMatch(
      /[\u4e00-\u9fff]/,
    );
    expect(getQueryPreviewText('zh-CN').pending).not.toContain(' / ');
  });
});
