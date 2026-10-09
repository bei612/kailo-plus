import { ModelResolver } from './apollo/server/resolvers/modelResolver';
import originalResolvers from './apollo/server/resolvers';
import {
  bindingServiceCall,
  loadQueryDelivery,
  NativeQueryRefusal,
} from './apollo/server/services/nativeQueryAdmission';

jest.mock('./apollo/server/services/nativeQueryAdmission', () => ({
  ...jest.requireActual('./apollo/server/services/nativeQueryAdmission'),
  bindingServiceCall: jest.fn(),
  loadQueryDelivery: jest.fn(),
}));
jest.mock('./common', () => ({ components: { apiHistoryRepository: {} } }));

describe.each([
  'model',
  'columns',
  'nestedColumns',
  'calculatedFields',
  'relationships',
])('original Model metadata %s consumer', (kind) => {
  const projectId = 3;
  const modelId = 11;
  let previous: string | undefined;
  let delivery: any;
  let generation: number;
  let revoked: boolean;
  let context: any;
  let events: string[];
  let afterRead: (stage: string) => void;
  let afterWrite: (stage: string) => void;
  let model: any;
  let columns: any[];
  let nested: any[];
  let relationships: any[];
  const modelRepository = { findOneBy: jest.fn(), updateOne: jest.fn() };
  const modelColumnRepository = {
    findOneBy: jest.fn(),
    findColumnsByIds: jest.fn(),
    updateOne: jest.fn(),
  };
  const modelNestedColumnRepository = {
    findOneBy: jest.fn(),
    findNestedColumnsByIds: jest.fn(),
    updateOne: jest.fn(),
  };
  const relationRepository = {
    findOneBy: jest.fn(),
    findRelationsByIds: jest.fn(),
    updateOne: jest.fn(),
  };
  const writeMocks = () => [
    modelRepository.updateOne,
    modelColumnRepository.updateOne,
    modelNestedColumnRepository.updateOne,
    relationRepository.updateOne,
  ];
  const input = (): any => ({
    columns: [],
    nestedColumns: [],
    calculatedFields: [],
    relationships: [],
    ...(kind === 'model'
      ? { displayName: 'original edit', description: '' }
      : {
          [kind]: (kind === 'columns'
            ? [31, 32]
            : kind === 'nestedColumns'
              ? [41, 42]
              : kind === 'calculatedFields'
                ? [61, 62]
                : [51, 52]
          ).map((id) => ({
            id,
            displayName: 'original edit',
            description: '',
          })),
        }),
  });
  const invoke = (data = input()) =>
    originalResolvers.Mutation.updateModelMetadata(
      undefined,
      { where: { id: modelId }, data } as any,
      context,
    );
  const failure = async (operation = () => invoke()) => {
    try {
      await operation();
    } catch (error) {
      return error as any;
    }
    throw new Error('Original native metadata unexpectedly succeeded');
  };
  const read = (stage: string) => {
    events.push(`read-${stage}`);
    afterRead(stage);
  };
  const write = (stage: string) => {
    events.push(`write-${stage}`);
    afterWrite(stage);
  };
  const nativeWrites = () =>
    events.filter((event) => event.startsWith('write-'));
  beforeEach(() => {
    previous = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'controlled-test-delivery';
    delivery = {
      projectId,
      bindingId: '3c0c015a-373a-4af1-8cbe-4a7e437bdbe1',
      tenantId: 'fixture-tenant',
      workspaceId: 'fixture-workspace',
      nativeInstanceRef: 'fixture-instance',
      nativeScopeRef: String(projectId),
    };
    generation = 2;
    revoked = false;
    afterRead = () => {};
    afterWrite = () => {};
    events = [];
    model = {
      id: modelId,
      projectId,
      properties: JSON.stringify({ original: 'retained', description: 'old' }),
    };
    columns = [31, 32, 61, 62].map((id) => ({
      id,
      modelId,
      isCalculated: id > 60,
      properties: JSON.stringify({ original: 'retained', description: 'old' }),
    }));
    nested = [41, 42].map((id) => ({
      id,
      modelId,
      properties: { original: 'retained', description: 'old' },
    }));
    relationships = [51, 52].map((id) => ({
      id,
      projectId,
      properties: JSON.stringify({ original: 'retained', description: 'old' }),
    }));
    for (const repository of [
      modelRepository,
      modelColumnRepository,
      modelNestedColumnRepository,
      relationRepository,
    ])
      Object.values(repository).forEach((mock) => mock.mockReset());
    modelRepository.findOneBy.mockImplementation(async (where) => {
      const output =
        where.id === model.id && where.projectId === model.projectId
          ? structuredClone(model)
          : undefined;
      if (kind === 'model') read('model');
      return output;
    });
    modelColumnRepository.findOneBy.mockImplementation(async ({ id }) =>
      structuredClone(columns.find((column) => column.id === id)),
    );
    modelColumnRepository.findColumnsByIds.mockImplementation(async (ids) => {
      const output = structuredClone(
        columns.filter(({ id }) => ids.includes(id)),
      );
      read(ids[0] > 60 ? 'calculatedFields' : 'columns');
      return output;
    });
    modelNestedColumnRepository.findOneBy.mockImplementation(async (where) =>
      structuredClone(
        nested.find(
          (row) => row.id === where.id && row.modelId === where.modelId,
        ),
      ),
    );
    modelNestedColumnRepository.findNestedColumnsByIds.mockImplementation(
      async (ids) => {
        const output = structuredClone(
          nested.filter(({ id }) => ids.includes(id)),
        );
        read('nestedColumns');
        return output;
      },
    );
    relationRepository.findOneBy.mockImplementation(async (where) =>
      structuredClone(
        relationships.find(
          (row) => row.id === where.id && row.projectId === where.projectId,
        ),
      ),
    );
    relationRepository.findRelationsByIds.mockImplementation(async (ids) => {
      const output = structuredClone(
        relationships.filter(({ id }) => ids.includes(id)),
      );
      read('relationships');
      return output;
    });
    modelRepository.updateOne.mockImplementation(async () => write('model'));
    modelColumnRepository.updateOne.mockImplementation(async (id) =>
      write(id > 60 ? 'calculatedFields' : 'columns'),
    );
    modelNestedColumnRepository.updateOne.mockImplementation(async () =>
      write('nestedColumns'),
    );
    relationRepository.updateOne.mockImplementation(async () =>
      write('relationships'),
    );
    context = {
      nativeHumanToken: 'verified-test-person',
      nativeIdentityScope: 'a'.repeat(64),
      projectService: {
        getCurrentProject: jest.fn(async () => ({ id: projectId })),
      },
      modelRepository,
      modelColumnRepository,
      modelNestedColumnRepository,
      relationRepository,
      modelService: {
        createCalculatedField: jest.fn(),
        updateCalculatedField: jest.fn(),
      },
      queryService: { validate: jest.fn(), preview: jest.fn() },
      telemetry: { sendEvent: jest.fn() },
    };
    jest
      .mocked(loadQueryDelivery)
      .mockReset()
      .mockImplementation(async () => structuredClone(delivery));
    jest
      .mocked(bindingServiceCall)
      .mockReset()
      .mockImplementation(async (config, operation, request: any, bearer) => {
        expect(operation).toBe('human-action');
        expect(bearer).toBe('verified-test-person');
        expect(request).toEqual({
          bindingId: config.bindingId,
          authorizeScope: { permission: 'manage' },
        });
        events.push('fresh-manage');
        if (revoked) throw new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED');
        return {
          scope: {
            ...config,
            generation,
            permission: 'manage',
            checkedRevision: 'current-metadata-management',
          },
        };
      });
  });
  afterEach(() => {
    if (previous === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = previous;
  });

  it('retains original metadata removal, unrelated properties, true response and native write order', async () => {
    expect(await invoke()).toBe(true);
    expect(nativeWrites()).toEqual(
      Array(kind === 'model' ? 1 : 2).fill(`write-${kind}`),
    );
    events.forEach((event, index) => {
      if (event.startsWith('write-'))
        expect(events[index - 1]).toBe('fresh-manage');
    });
    const properties = JSON.stringify({
      original: 'retained',
      description: null,
    });
    if (kind === 'model')
      expect(modelRepository.updateOne).toHaveBeenCalledWith(modelId, {
        displayName: 'original edit',
        properties,
      });
    else if (kind === 'columns')
      expect(modelColumnRepository.updateOne).toHaveBeenCalledWith(31, {
        displayName: 'original edit',
        properties,
      });
    else if (kind === 'nestedColumns')
      expect(modelNestedColumnRepository.updateOne).toHaveBeenCalledWith(41, {
        displayName: 'original edit',
        properties: { original: 'retained', description: null },
      });
    else if (kind === 'calculatedFields')
      expect(modelColumnRepository.updateOne).toHaveBeenCalledWith(61, {
        properties,
      });
    else
      expect(relationRepository.updateOne).toHaveBeenCalledWith(51, {
        properties,
      });
    expect(context).not.toHaveProperty('nativeProjectCheck');
    expect(context.queryService.validate).not.toHaveBeenCalled();
    expect(context.queryService.preview).not.toHaveBeenCalled();
    expect(context.modelService.createCalculatedField).not.toHaveBeenCalled();
    expect(context.modelService.updateCalculatedField).not.toHaveBeenCalled();
  });

  it.each(['revoked', 'generation', 'delivery', 'identity', 'scope'])(
    'refuses %s after the helper final native read before any native metadata write',
    async (change) => {
      afterRead = (stage) => {
        if (stage !== kind) return;
        if (change === 'revoked') revoked = true;
        else if (change === 'generation') generation++;
        else if (change === 'delivery')
          delivery.workspaceId = 'other-fixture-workspace';
        else if (change === 'identity')
          context.nativeHumanToken = 'changed-test-person';
        else context.nativeIdentityScope = 'b'.repeat(64);
      };
      const error = await failure();
      expect(error.extensions.other.nativeWrite.outcome).toBe('NOT_STARTED');
      writeMocks().forEach((mock) => expect(mock).not.toHaveBeenCalled());
    },
  );

  it('refuses a raw bound original resolver missing the captured permission closure', async () => {
    await expect(
      new ModelResolver().updateModelMetadata(
        undefined,
        { where: { id: modelId }, data: input() } as any,
        context,
      ),
    ).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
    writeMocks().forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });

  it('retains the entirely unconfigured original independent native editor', async () => {
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    delete context.nativeHumanToken;
    delete context.nativeIdentityScope;
    expect(await invoke()).toBe(true);
    expect(nativeWrites()).toHaveLength(kind === 'model' ? 1 : 2);
    expect(bindingServiceCall).not.toHaveBeenCalled();
  });

  it.each(['delivery', 'identity', 'scope'])(
    'refuses %s arriving during the final independent native read',
    async (change) => {
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      delete context.nativeHumanToken;
      delete context.nativeIdentityScope;
      afterRead = (stage) => {
        if (stage !== kind) return;
        if (change === 'delivery')
          process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
            'controlled-test-delivery';
        else if (change === 'identity')
          context.nativeHumanToken = 'new-test-person';
        else context.nativeIdentityScope = 'b'.repeat(64);
      };
      await expect(invoke()).rejects.toThrow('QUERY_EVIDENCE_UNAVAILABLE');
      writeMocks().forEach((mock) => expect(mock).not.toHaveBeenCalled());
    },
  );

  it.each(['lost-response', 'forged-not-started'])(
    'does not treat %s after native dispatch as proof of no write or retry it',
    async (cause) => {
      const native =
        kind === 'model'
          ? modelRepository.updateOne
          : kind === 'nestedColumns'
            ? modelNestedColumnRepository.updateOne
            : kind === 'relationships'
              ? relationRepository.updateOne
              : modelColumnRepository.updateOne;
      native.mockImplementation(async () => {
        const error: any = new Error(
          'Original native metadata response unavailable',
        );
        if (cause === 'forged-not-started')
          error.extensions = {
            other: { nativeWrite: { outcome: 'NOT_STARTED' } },
          };
        throw error;
      });
      const error = await failure();
      expect(error.extensions.other.nativeWrite.outcome).toBe('UNKNOWN');
      expect(native).toHaveBeenCalledTimes(1);
    },
  );

  if (kind !== 'model') {
    it.each(['revoked', 'generation', 'identity', 'scope'])(
      'keeps %s between same-kind native writes UNKNOWN, not NOT_STARTED',
      async (change) => {
        afterWrite = () => {
          if (change === 'revoked') revoked = true;
          else if (change === 'generation') generation++;
          else if (change === 'identity')
            context.nativeHumanToken = 'changed-test-person';
          else context.nativeIdentityScope = 'b'.repeat(64);
        };
        const error = await failure();
        expect(error.extensions.other.nativeWrite.outcome).toBe('UNKNOWN');
        expect(nativeWrites()).toEqual([`write-${kind}`]);
      },
    );

    it('shares dispatch evidence from an earlier model write across the later helper await', async () => {
      afterRead = (stage) => {
        if (stage === kind) revoked = true;
      };
      const error = await failure(() =>
        invoke({ ...input(), displayName: 'first model write' }),
      );
      expect(error.extensions.other.nativeWrite.outcome).toBe('UNKNOWN');
      expect(nativeWrites()).toEqual(['write-model']);
    });

    it('does not relabel new configuration after the first independent write as never started', async () => {
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      delete context.nativeHumanToken;
      delete context.nativeIdentityScope;
      afterWrite = () => {
        process.env.WREN_PLATFORM_QUERY_CONFIG_FILE =
          'controlled-test-delivery';
      };
      const error = await failure();
      expect(error.extensions.other.nativeWrite.outcome).toBe('UNKNOWN');
      expect(nativeWrites()).toEqual([`write-${kind}`]);
    });
  } else {
    it('retains empty and null original metadata as a native no-op', async () => {
      expect(
        await invoke({
          columns: [],
          nestedColumns: [],
          calculatedFields: [],
          relationships: [],
          displayName: null,
          description: null,
        } as any),
      ).toBe(true);
      writeMocks().forEach((mock) => expect(mock).not.toHaveBeenCalled());
    });

    it('retains the full original five-helper metadata editor in original order without SQL', async () => {
      expect(
        await invoke({
          displayName: 'original edit',
          description: '',
          columns: [{ id: 31, description: '' }],
          nestedColumns: [{ id: 41, description: '' }],
          calculatedFields: [{ id: 61, description: '' }],
          relationships: [{ id: 51, description: '' }],
        }),
      ).toBe(true);
      expect(nativeWrites()).toEqual([
        'write-model',
        'write-columns',
        'write-nestedColumns',
        'write-calculatedFields',
        'write-relationships',
      ]);
      events.forEach((event, index) => {
        if (event.startsWith('write-'))
          expect(events[index - 1]).toBe('fresh-manage');
      });
      expect(context.queryService.validate).not.toHaveBeenCalled();
      expect(context.queryService.preview).not.toHaveBeenCalled();
    });
  }
});
