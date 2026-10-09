import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { exportJWK, generateKeyPair, JWTPayload, SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { middleware, nativeFrameAncestors } from './middleware';
import configHandler from './pages/api/config';
import modelsHandler from './pages/api/v1/models';
import instructionsHandler from './pages/api/v1/knowledge/instructions';
import instructionByIdHandler from './pages/api/v1/knowledge/instructions/[id]';
import { components } from './common';
import {
  bindingServiceCall,
  loadQueryDelivery,
  NativeQueryDelivery,
} from './apollo/server/services/nativeQueryAdmission';
import { nativePreviewScope } from './apollo/server/services/nativeHumanQuery';

jest.mock('./apollo/server/services/nativeQueryAdmission', () => ({
  ...jest.requireActual('./apollo/server/services/nativeQueryAdmission'),
  loadQueryDelivery: jest.fn(),
  bindingServiceCall: jest.fn(),
}));
jest.mock('./common', () => ({ components: { apiHistoryRepository: {} } }));

describe('native instance identity boundary', () => {
  let server: Server;
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let settings: Record<string, string>;
  const originalConfig = process.env.WREN_NATIVE_IDENTITY_JSON;
  const originalAncestors = process.env.KAILO_FRAME_ANCESTORS;
  const originalQueryConfig = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;

  beforeAll(async () => {
    keys = await generateKeyPair('RS256');
    const jwk = await exportJWK(keys.publicKey);
    server = createServer((request, response) => {
      if (request.url === '/unavailable') {
        response.writeHead(503).end();
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ keys: [{ ...jwk, kid: 'native' }] }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    settings = {
      issuer: `${origin}/issuer`,
      audience: randomUUID(),
      jwksUrl: `${origin}/jwks`,
      accessClaim: 'native_instances',
      accessValue: randomUUID(),
      publicOrigin: origin,
    };
  });

  beforeEach(() => {
    process.env.WREN_NATIVE_IDENTITY_JSON = JSON.stringify(settings);
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = 'fixture-controlled-delivery';
    delete process.env.KAILO_FRAME_ANCESTORS;
  });

  afterAll(async () => {
    if (originalQueryConfig === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = originalQueryConfig;
    if (originalAncestors === undefined)
      delete process.env.KAILO_FRAME_ANCESTORS;
    else process.env.KAILO_FRAME_ANCESTORS = originalAncestors;
    if (originalConfig === undefined)
      delete process.env.WREN_NATIVE_IDENTITY_JSON;
    else process.env.WREN_NATIVE_IDENTITY_JSON = originalConfig;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  const token = async (changes: JWTPayload = {}, omit: string[] = []) => {
    const claims: JWTPayload = {
      iss: settings.issuer,
      sub: randomUUID(),
      aud: settings.audience,
      exp: Math.floor(Date.now() / 1000) + 60,
      [settings.accessClaim]: [settings.accessValue],
      ...changes,
    };
    for (const key of omit) delete claims[key];
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'native' })
      .sign(keys.privateKey);
  };

  const request = (
    path: string,
    authorization?: string,
    options: RequestInit = {},
  ) =>
    new NextRequest(`${settings.publicOrigin}${path}`, {
      ...options,
      headers: {
        ...(authorization ? { authorization } : {}),
        ...options.headers,
      },
    });

  it.each([
    '/',
    '/setup/connection',
    '/api/graphql',
    '/api/config',
    '/api/platform-query-reference',
    '/api/v1/run_sql',
    '/api/v1/generate_summary',
    '/api/v1/generate_vega_chart',
    '/api/v1/ask',
    '/api/v1/stream/ask',
    '/api/v1/models',
    '/api/v1/generate_sql',
    '/api/v1/stream/generate_sql',
    '/api/v1/knowledge/sql_pairs',
    '/api/v1/knowledge/sql_pairs/42',
    '/api/v1/knowledge/instructions',
    '/api/ask_task/streaming',
    '/api/ask_task/streaming_answer',
    '/_next/data/native/index.json',
    '/_next/static/native.js',
  ])('does not accept an anonymous native request to %s', async (path) => {
    const response = await middleware(request(path));
    expect(response.status).toBe(401);
    expect(response.headers.get('x-middleware-next')).toBeNull();
  });

  it.each([
    '/api/graphql',
    '/api/config',
    '/api/platform-query-reference',
    '/api/ask_task/streaming',
    '/api/ask_task/streaming_answer',
    '/api/v1/run_sql',
    '/api/v1/generate_summary',
    '/api/v1/generate_vega_chart',
    '/api/v1/ask',
    '/api/v1/stream/ask',
    '/api/v1/models',
    '/api/v1/generate_sql',
    '/api/v1/stream/generate_sql',
    '/api/v1/knowledge/sql_pairs',
    '/api/v1/knowledge/sql_pairs/42',
  ])(
    'verifies signed entitlement through a real JWKS endpoint and strips credentials for %s',
    async (path) => {
      const signed = await token();
      const response = await middleware(
        request(path, `Bearer ${signed}`, {
          method: 'POST',
          headers: {
            origin: settings.publicOrigin,
            cookie: 'native=synthetic',
            'x-kailo-native-human-token': 'forged',
          },
        }),
      );
      expect(response.headers.get('x-middleware-next')).toBe('1');
      expect(
        response.headers.get('x-middleware-request-authorization'),
      ).toBeNull();
      expect(response.headers.get('x-middleware-request-cookie')).toBeNull();
      expect(
        response.headers.get('x-middleware-request-x-kailo-native-human-token'),
      ).toBe(signed);
      expect(response.headers.get('cache-control')).toContain('no-store');
      if (
        [
          '/api/v1/run_sql',
          '/api/v1/generate_summary',
          '/api/v1/generate_vega_chart',
          '/api/v1/ask',
          '/api/v1/stream/ask',
          '/api/v1/models',
          '/api/v1/generate_sql',
          '/api/v1/stream/generate_sql',
          '/api/config',
          '/api/v1/knowledge/sql_pairs',
          '/api/v1/knowledge/sql_pairs/42',
          '/api/ask_task/streaming',
        ].includes(path)
      ) {
        expect(
          response.headers.get(
            'x-middleware-request-x-kailo-native-identity-scope',
          ),
        ).toMatch(/^[a-f0-9]{64}$/);
      }
    },
  );

  it('does not forward the HUMAN token to unrelated native routes', async () => {
    const response = await middleware(
      request('/', `Bearer ${await token()}`, {
        headers: { 'x-kailo-native-human-token': 'forged' },
      }),
    );
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(
      response.headers.get('x-middleware-request-x-kailo-native-human-token'),
    ).toBeNull();
  });

  it.each([
    '/api/v1/run_sql',
    '/api/v1/generate_summary',
    '/api/v1/generate_vega_chart',
    '/api/v1/ask',
    '/api/v1/stream/ask',
    '/api/v1/models',
    '/api/v1/generate_sql',
    '/api/v1/stream/generate_sql',
    '/api/v1/knowledge/sql_pairs',
    '/api/v1/knowledge/sql_pairs/42',
  ])(
    'does not forward private HUMAN credentials or caller-forged scope to independent %s',
    async (path) => {
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
      const response = await middleware(
        request(path, `Bearer ${await token()}`, {
          method: 'POST',
          headers: {
            origin: settings.publicOrigin,
            'x-kailo-native-human-token': 'forged',
            'x-kailo-native-identity-scope': 'f'.repeat(64),
          },
        }),
      );
      expect(response.headers.get('x-middleware-next')).toBe('1');
      for (const field of ['human-token', 'identity-scope'])
        expect(
          response.headers.get(`x-middleware-request-x-kailo-native-${field}`),
        ).toBeNull();
    },
  );

  it('partitions browser intent only from verified subject and instance, never a supplied scope', async () => {
    const read = async (subject: string) => {
      const response = await middleware(
        request('/api/config', `Bearer ${await token({ sub: subject })}`, {
          headers: { 'x-kailo-native-identity-scope': 'f'.repeat(64) },
        }),
      );
      expect(response.status).toBe(200);
      const scope = response.headers.get(
        'x-middleware-request-x-kailo-native-identity-scope',
      );
      expect(scope).toMatch(/^[a-f0-9]{64}$/);
      expect(scope).not.toBe('f'.repeat(64));
      return scope;
    };
    const first = await read('person-one');
    expect(await read('person-one')).toBe(first);
    expect(await read('person-two')).not.toBe(first);
    expect(
      (
        await middleware(
          request('/api/config', undefined, {
            headers: { 'x-kailo-native-identity-scope': first },
          }),
        )
      ).status,
    ).toBe(401);
    const unrelated = await middleware(
      request('/', `Bearer ${await token()}`, {
        headers: { 'x-kailo-native-identity-scope': first },
      }),
    );
    expect(
      unrelated.headers.get(
        'x-middleware-request-x-kailo-native-identity-scope',
      ),
    ).toBeNull();
  });

  it('the original config handler consumes both real signed middleware headers before current HUMAN discovery', async () => {
    const signed = await token();
    const admitted = await middleware(
      request('/api/config', `Bearer ${signed}`, {
        headers: {
          'x-kailo-native-human-token': 'forged',
          'x-kailo-native-identity-scope': 'f'.repeat(64),
        },
      }),
    );
    const headers = Object.fromEntries(
      ['human-token', 'identity-scope'].map((field) => [
        `x-kailo-native-${field}`,
        admitted.headers.get(`x-middleware-request-x-kailo-native-${field}`),
      ]),
    );
    const delivery = {
      bindingId: randomUUID(),
      tenantId: randomUUID(),
      workspaceId: randomUUID(),
      nativeInstanceRef: settings.accessValue,
      nativeScopeRef: 'original-project',
      humanAction: {
        resultExposurePolicyId: randomUUID(),
        resultExposurePolicyVersion: 1,
      },
    } as NativeQueryDelivery;
    jest.mocked(loadQueryDelivery).mockResolvedValue(delivery);
    jest
      .mocked(bindingServiceCall)
      .mockReset()
      .mockResolvedValue({
        scope: {
          ...delivery,
          permission: 'discover',
          generation: 2,
          checkedRevision: 'current-public-authority',
        },
      });
    const response: any = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    await configHandler({ headers } as any, response);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        nativeBindingConfigured: true,
        nativeBindingGeneration: 2,
        queryScope: nativePreviewScope(
          delivery,
          headers['x-kailo-native-identity-scope'],
        ),
      }),
    );
    expect(bindingServiceCall).toHaveBeenCalledWith(
      delivery,
      'human-action',
      {
        bindingId: delivery.bindingId,
        authorizeScope: { permission: 'discover' },
      },
      signed,
    );
    expect(headers['x-kailo-native-human-token']).not.toBe('forged');
  });

  it('the original models handler consumes the exact signed middleware identity for current captured MDL and Resource reads', async () => {
    const originalComponents = { ...components };
    const originalHistory = { ...components.apiHistoryRepository };
    const signed = await token();
    const admitted = await middleware(
      request('/api/v1/models', `Bearer ${signed}`, {
        headers: {
          'x-kailo-native-human-token': 'forged',
          'x-kailo-native-identity-scope': 'f'.repeat(64),
        },
      }),
    );
    const headers = Object.fromEntries(
      ['human-token', 'identity-scope'].map((field) => [
        `x-kailo-native-${field}`,
        admitted.headers.get(`x-middleware-request-x-kailo-native-${field}`),
      ]),
    );
    const delivery = {
      projectId: 3,
      bindingId: randomUUID(),
      tenantId: randomUUID(),
      workspaceId: randomUUID(),
      nativeInstanceRef: settings.accessValue,
      nativeScopeRef: 'original-project',
    } as NativeQueryDelivery;
    const deployment = {
      id: 5,
      projectId: delivery.projectId,
      hash: 'original-captured-deployment',
      manifest: { models: [{ name: 'original_model' }] },
      nativeObjectRefs: [
        { nativeType: 'model', nativeId: 7, nativeName: 'original_model' },
      ],
    };
    jest.mocked(loadQueryDelivery).mockResolvedValue(delivery);
    jest
      .mocked(bindingServiceCall)
      .mockReset()
      .mockImplementation(async (_config, _operation, input, bearer) => {
        expect(bearer).toBe(signed);
        if (input.authorizeScope)
          return {
            scope: {
              ...delivery,
              generation: 2,
              checkedRevision: 'fresh-native-resource-fact',
              permission: (input.authorizeScope as any).permission,
            },
          };
        const ref = input.resolveResource as any;
        return {
          resource: {
            resourceId: delivery.bindingId,
            resourceVersion: 1,
            nativeType: ref.nativeType,
            nativeRef: ref.nativeRef,
            nativeInstanceRef: delivery.nativeInstanceRef,
            nativeScopeRef: delivery.nativeScopeRef,
          },
        };
      });
    Object.assign(components, {
      projectService: {
        getCurrentProject: jest.fn(async () => ({ id: delivery.projectId })),
      },
      deployService: { getLastDeployment: jest.fn(async () => deployment) },
      deployLogRepository: {
        findOneBy: jest.fn(async () => structuredClone(deployment)),
      },
      apiHistoryRepository: Object.assign(components.apiHistoryRepository, {
        createOne: jest.fn(),
      }),
    });
    const response: any = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    try {
      await modelsHandler({ method: 'GET', headers } as any, response);
      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.json).toHaveBeenCalledWith({
        hash: deployment.hash,
        models: deployment.manifest.models,
        views: [],
        relationships: [],
      });
      expect(headers['x-kailo-native-human-token']).toBe(signed);
      expect(headers['x-kailo-native-identity-scope']).not.toBe('f'.repeat(64));
      expect(components.apiHistoryRepository.createOne).toHaveBeenCalledWith(
        expect.objectContaining({
          governanceBindingId: delivery.bindingId,
          requestPayload: {
            nativeModels: expect.objectContaining({
              identityScope: headers['x-kailo-native-identity-scope'],
              generation: 2,
            }),
          },
        }),
      );
      expect(bindingServiceCall).toHaveBeenCalledTimes(9);
    } finally {
      for (const key of Object.keys(components.apiHistoryRepository))
        delete components.apiHistoryRepository[key];
      Object.assign(components.apiHistoryRepository, originalHistory);
      for (const key of Object.keys(components)) delete components[key];
      Object.assign(components, originalComponents);
    }
  });

  it('the original instructions GET consumes only the signed middleware private hop and fresh project discovery', async () => {
    const originalComponents = { ...components };
    const originalHistory = { ...components.apiHistoryRepository };
    const signed = await token();
    const admitted = await middleware(
      request('/api/v1/knowledge/instructions', `Bearer ${signed}`, {
        headers: {
          'x-kailo-native-human-token': 'forged',
          'x-kailo-native-identity-scope': 'f'.repeat(64),
          cookie: 'native=synthetic',
        },
      }),
    );
    const headers = Object.fromEntries(
      ['human-token', 'identity-scope'].flatMap((field) => {
        const value = admitted.headers.get(
          `x-middleware-request-x-kailo-native-${field}`,
        );
        return value === null ? [] : [[`x-kailo-native-${field}`, value]];
      }),
    );
    const delivery = {
      projectId: 3,
      bindingId: randomUUID(),
      tenantId: randomUUID(),
      workspaceId: randomUUID(),
      nativeInstanceRef: settings.accessValue,
      nativeScopeRef: '3',
    } as NativeQueryDelivery;
    jest.mocked(loadQueryDelivery).mockResolvedValue(delivery);
    jest
      .mocked(bindingServiceCall)
      .mockReset()
      .mockImplementation(async (_config, operation, input, bearer) => {
        expect(operation).toBe('human-action');
        expect(bearer).toBe(signed);
        expect(input).toEqual({
          bindingId: delivery.bindingId,
          authorizeScope: { permission: 'discover' },
        });
        return {
          scope: {
            ...delivery,
            generation: 2,
            permission: 'discover',
            checkedRevision: 'fresh-project-authority',
          },
        };
      });
    Object.assign(components, {
      projectService: {
        getCurrentProject: jest.fn(async () => ({ id: delivery.projectId })),
      },
      instructionService: {
        getInstructions: jest.fn(async () => [
          {
            id: 7,
            instruction: 'Original instruction',
            questions: [],
            isDefault: true,
          },
        ]),
      },
      apiHistoryRepository: Object.assign(components.apiHistoryRepository, {
        createOne: jest.fn(),
      }),
    });
    const response: any = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    try {
      await instructionsHandler({ method: 'GET', headers } as any, response);
      expect(response.status).toHaveBeenCalledWith(200);
      expect(response.json).toHaveBeenCalledWith([
        {
          id: 7,
          instruction: 'Original instruction',
          questions: [],
          isGlobal: true,
        },
      ]);
      expect(headers['x-kailo-native-human-token']).toBe(signed);
      expect(headers['x-kailo-native-identity-scope']).toMatch(
        /^[a-f0-9]{64}$/,
      );
      expect(headers['x-kailo-native-identity-scope']).not.toBe('f'.repeat(64));
      expect(
        admitted.headers.get('x-middleware-request-authorization'),
      ).toBeNull();
      expect(admitted.headers.get('x-middleware-request-cookie')).toBeNull();
      expect(bindingServiceCall).toHaveBeenCalledTimes(5);
      expect(components.apiHistoryRepository.createOne).toHaveBeenCalledTimes(
        1,
      );
    } finally {
      for (const key of Object.keys(components.apiHistoryRepository))
        delete components.apiHistoryRepository[key];
      Object.assign(components.apiHistoryRepository, originalHistory);
      for (const key of Object.keys(components)) delete components[key];
      Object.assign(components, originalComponents);
    }
  });

  it('does not forward private instructions credentials for the original independent GET', async () => {
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    const response = await middleware(
      request('/api/v1/knowledge/instructions', `Bearer ${await token()}`, {
        headers: {
          'x-kailo-native-human-token': 'forged',
          'x-kailo-native-identity-scope': 'f'.repeat(64),
        },
      }),
    );
    expect(response.headers.get('x-middleware-next')).toBe('1');
    for (const field of ['human-token', 'identity-scope'])
      expect(
        response.headers.get(`x-middleware-request-x-kailo-native-${field}`),
      ).toBeNull();
  });

  it.each(['PUT', 'DELETE'])(
    'does not extend instructions GET credentials to a %s native write',
    async (method) => {
      const response = await middleware(
        request('/api/v1/knowledge/instructions', `Bearer ${await token()}`, {
          method,
          headers: {
            origin: settings.publicOrigin,
            'x-kailo-native-human-token': 'forged',
            'x-kailo-native-identity-scope': 'f'.repeat(64),
          },
        }),
      );
      expect(response.headers.get('x-middleware-next')).toBe('1');
      for (const field of ['human-token', 'identity-scope'])
        expect(
          response.headers.get(`x-middleware-request-x-kailo-native-${field}`),
        ).toBeNull();
    },
  );

  it.each(['POST', 'PUT', 'DELETE'])(
    'the exact original instructions %s consumes a signed private hop and current project management',
    async (method) => {
      const originalComponents = { ...components };
      const originalHistory = { ...components.apiHistoryRepository };
      const signed = await token();
      const path =
        '/api/v1/knowledge/instructions' + (method === 'POST' ? '' : '/7');
      const admitted = await middleware(
        request(path, `Bearer ${signed}`, {
          method,
          headers: {
            origin: settings.publicOrigin,
            'x-kailo-native-human-token': 'forged',
            'x-kailo-native-identity-scope': 'f'.repeat(64),
            cookie: 'native=synthetic',
          },
        }),
      );
      const headers = Object.fromEntries(
        ['human-token', 'identity-scope'].flatMap((field) => {
          const value = admitted.headers.get(
            `x-middleware-request-x-kailo-native-${field}`,
          );
          return value === null ? [] : [[`x-kailo-native-${field}`, value]];
        }),
      );
      const delivery = {
        projectId: 3,
        bindingId: randomUUID(),
        tenantId: randomUUID(),
        workspaceId: randomUUID(),
        nativeInstanceRef: settings.accessValue,
        nativeScopeRef: '3',
      } as NativeQueryDelivery;
      const row = {
        id: 7,
        projectId: delivery.projectId,
        instruction: 'Original instruction',
        questions: ['Original question'],
        isDefault: false,
      };
      jest.mocked(loadQueryDelivery).mockResolvedValue(delivery);
      jest
        .mocked(bindingServiceCall)
        .mockReset()
        .mockImplementation(async (_config, operation, input, bearer) => {
          expect(operation).toBe('human-action');
          expect(bearer).toBe(signed);
          expect(input).toEqual({
            bindingId: delivery.bindingId,
            authorizeScope: { permission: 'manage' },
          });
          return {
            scope: {
              ...delivery,
              generation: 2,
              permission: 'manage',
              checkedRevision: 'fresh-project-management',
            },
          };
        });
      Object.assign(components, {
        telemetry: { sendEvent: jest.fn() },
        projectService: {
          getCurrentProject: jest.fn(async () => ({ id: delivery.projectId })),
        },
        instructionRepository: { findOneBy: jest.fn(async () => row) },
        instructionService: {
          createInstruction: jest.fn(async (input) => ({
            id: row.id,
            ...input,
          })),
          updateInstruction: jest.fn(async (input) => ({ ...row, ...input })),
          deleteInstruction: jest.fn(async () => undefined),
        },
        apiHistoryRepository: Object.assign(components.apiHistoryRepository, {
          createOne: jest.fn(),
        }),
      });
      const response: any = {
        setHeader: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      try {
        const handler =
          method === 'POST' ? instructionsHandler : instructionByIdHandler;
        await handler(
          {
            method,
            headers,
            query: { id: '7' },
            body: {
              instruction: row.instruction,
              questions: row.questions,
              isGlobal: false,
            },
          } as any,
          response,
        );
        expect(response.status).toHaveBeenCalledWith(
          method === 'POST' ? 201 : method === 'PUT' ? 200 : 204,
        );
        expect(headers['x-kailo-native-human-token']).toBe(signed);
        expect(headers['x-kailo-native-identity-scope']).toMatch(
          /^[a-f0-9]{64}$/,
        );
        expect(headers['x-kailo-native-identity-scope']).not.toBe(
          'f'.repeat(64),
        );
        expect(
          admitted.headers.get('x-middleware-request-authorization'),
        ).toBeNull();
        expect(admitted.headers.get('x-middleware-request-cookie')).toBeNull();
        expect(bindingServiceCall).toHaveBeenCalledTimes(7);
        expect(
          components.instructionService[
            method === 'POST'
              ? 'createInstruction'
              : method === 'PUT'
                ? 'updateInstruction'
                : 'deleteInstruction'
          ],
        ).toHaveBeenCalledTimes(1);
        expect(components.apiHistoryRepository.createOne).toHaveBeenCalledTimes(
          1,
        );
      } finally {
        for (const key of Object.keys(components.apiHistoryRepository))
          delete components.apiHistoryRepository[key];
        Object.assign(components.apiHistoryRepository, originalHistory);
        for (const key of Object.keys(components)) delete components[key];
        Object.assign(components, originalComponents);
      }
    },
  );

  it.each([
    '/api/v1/models/extra',
    '/api/v1/models_extra',
    '/api/v1/model',
    '/api/v1/knowledge/sql_pairs/0',
    '/api/v1/knowledge/sql_pairs/-1',
    '/api/v1/knowledge/sql_pairs/42/other',
    '/api/v1/knowledge/sql_pairs/fake',
    '/api/v1/knowledge/instructions/0',
    '/api/v1/knowledge/instructions/-1',
    '/api/v1/knowledge/instructions/7/other',
    '/api/v1/knowledge/instructions/fake',
    '/api/v1/knowledge/sql_pairs_extra',
    '/api/v1/knowledge/instructions/42',
    '/api/v1/knowledge/instructions/extra',
    '/api/v1/knowledge/instructions_extra',
  ])(
    'does not spread private native business credentials to unrelated route %s',
    async (path) => {
      const response = await middleware(
        request(path, `Bearer ${await token()}`, {
          headers: {
            'x-kailo-native-human-token': 'forged',
            'x-kailo-native-identity-scope': 'f'.repeat(64),
          },
        }),
      );
      expect(response.headers.get('x-middleware-next')).toBe('1');
      for (const field of ['human-token', 'identity-scope'])
        expect(
          response.headers.get(`x-middleware-request-x-kailo-native-${field}`),
        ).toBeNull();
    },
  );

  it('keeps the native identity guard and private propagation on an English Next route', async () => {
    const signed = await token();
    const localized = new NextRequest(
      `${settings.publicOrigin}/en/api/graphql`,
      {
        nextConfig: {
          i18n: { locales: ['zh-CN', 'en'], defaultLocale: 'zh-CN' },
        },
        headers: { authorization: `Bearer ${signed}` },
      },
    );
    expect(localized.nextUrl.locale).toBe('en');
    const response = await middleware(localized);
    expect(response.status).toBe(200);
    expect(
      response.headers.get('x-middleware-request-x-kailo-native-human-token'),
    ).toBe(signed);
  });

  it.each([
    { iss: 'other-issuer' },
    { aud: 'platform-audience' },
    { sub: '' },
    { sub: ' ' },
    { exp: 1 },
    { nbf: Number.MAX_SAFE_INTEGER },
  ])('rejects invalid signed identity claims %p', async (changes) => {
    expect(
      (await middleware(request('/', `Bearer ${await token(changes)}`))).status,
    ).toBe(401);
  });

  it.each(['iss', 'sub', 'aud', 'exp'])('requires signed %s', async (claim) => {
    expect(
      (await middleware(request('/', `Bearer ${await token({}, [claim])}`)))
        .status,
    ).toBe(401);
  });

  it.each([
    null,
    false,
    'other-instance',
    ['other-instance'],
    [{ grant: true }],
  ])(
    'does not turn authentication into instance authorization: %p',
    async (access) => {
      const bearer = await token({ [settings.accessClaim]: access });
      expect((await middleware(request('/', `Bearer ${bearer}`))).status).toBe(
        403,
      );
    },
  );

  it('rejects a forged signature', async () => {
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT({
      [settings.accessClaim]: settings.accessValue,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'native' })
      .setIssuer(settings.issuer)
      .setSubject(randomUUID())
      .setAudience(settings.audience)
      .setExpirationTime('1m')
      .sign(other.privateKey);
    expect((await middleware(request('/', `Bearer ${forged}`))).status).toBe(
      401,
    );
  });

  it('allows only explicit embedding origins without changing native authentication or CSRF', async () => {
    expect(nativeFrameAncestors(undefined)).toBe("frame-ancestors 'self'");
    expect(nativeFrameAncestors('tauri://localhost')).toBe(
      "frame-ancestors 'self' tauri://localhost",
    );
    process.env.KAILO_FRAME_ANCESTORS = 'https://kailo.example.invalid';
    const bearer = `Bearer ${await token()}`;
    const admitted = await middleware(request('/', bearer));
    expect(admitted.headers.get('content-security-policy')).toBe(
      "frame-ancestors 'self' https://kailo.example.invalid",
    );
    expect((await middleware(request('/'))).status).toBe(401);
    expect(
      (
        await middleware(
          request('/api/graphql', bearer, {
            method: 'POST',
            headers: { origin: 'https://kailo.example.invalid' },
          }),
        )
      ).status,
    ).toBe(403);
    process.env.KAILO_FRAME_ANCESTORS = '*';
    expect((await middleware(request('/', bearer))).status).toBe(503);
  });

  it.each([
    '*',
    'https://*.invalid',
    'https://host.invalid/path',
    'https://user@host.invalid',
    'https://host.invalid?query',
    'https://host.invalid#fragment',
    'data:text/html,test',
    'https://host.invalid;default-src *',
    'https://host.invalid:0',
    'https://host.invalid:65536',
    'tauri://localhost:',
    'tauri://',
  ])('rejects unsafe frame ancestor %s', (origin) => {
    expect(() => nativeFrameAncestors(origin)).toThrow();
  });

  it.each([undefined, 'https://untrusted.invalid', 'null'])(
    'rejects a native write with untrusted origin %p',
    async (origin) => {
      const response = await middleware(
        request('/api/graphql', `Bearer ${await token()}`, {
          method: 'POST',
          headers: origin === undefined ? {} : { origin },
        }),
      );
      expect(response.status).toBe(403);
    },
  );

  it.each([undefined, '', '{invalid', '{}', 'null'])(
    'never uses the previously cached policy for invalid config %p',
    async (value) => {
      const bearer = await token();
      expect((await middleware(request('/', `Bearer ${bearer}`))).status).toBe(
        200,
      );
      if (value === undefined) delete process.env.WREN_NATIVE_IDENTITY_JSON;
      else process.env.WREN_NATIVE_IDENTITY_JSON = value;
      expect((await middleware(request('/', `Bearer ${bearer}`))).status).toBe(
        503,
      );
    },
  );

  it('does not use an identity claim as the access policy', async () => {
    process.env.WREN_NATIVE_IDENTITY_JSON = JSON.stringify({
      ...settings,
      accessClaim: 'aud',
    });
    expect(
      (await middleware(request('/', `Bearer ${await token()}`))).status,
    ).toBe(503);
  });

  it('fails closed when the configured key service is unavailable', async () => {
    process.env.WREN_NATIVE_IDENTITY_JSON = JSON.stringify({
      ...settings,
      jwksUrl: `${settings.publicOrigin}/unavailable`,
    });
    expect(
      (await middleware(request('/', `Bearer ${await token()}`))).status,
    ).toBe(503);
  });
});
