import originalResolvers from './apollo/server/resolvers';
import { kailoAdminRead } from './apollo/server/services/kailoUserService';
import { GeneralErrorCodes } from './apollo/server/utils/error';
import {
  loadQueryDelivery,
  NativeQueryRefusal,
} from './apollo/server/services/nativeQueryAdmission';
import { authorizeNativeScope } from './apollo/server/services/nativeHumanQuery';

jest.mock('./apollo/server/services/nativeQueryAdmission', () => ({
  ...jest.requireActual('./apollo/server/services/nativeQueryAdmission'),
  loadQueryDelivery: jest.fn(),
}));
jest.mock('./apollo/server/services/nativeHumanQuery', () => ({
  ...jest.requireActual('./apollo/server/services/nativeHumanQuery'),
  authorizeNativeScope: jest.fn(),
}));
jest.mock('./common', () => ({ components: { apiHistoryRepository: {} } }));

// DD-138(7): the API call history is administration data — read only by the
// person who may manage the instance (GOVERNED: Core `manage` on the binding;
// STANDALONE: the directory Tenant admin).
const user = (admin: boolean) => ({
  key: 'a'.repeat(64),
  name: 'Person',
  username: 'person',
  email: null,
  picture: null,
  locale: null,
  admin,
});
const refused = {
  extensions: { code: GeneralErrorCodes.KAILO_ADMIN_REQUIRED },
};
const delivery = {
  projectId: 3,
  bindingId: 'binding',
  nativeInstanceRef: 'instance',
  nativeScopeRef: '3',
};

describe('API history is read by administrators only', () => {
  let previousQuery: string | undefined;
  let previousBinding: string | undefined;
  beforeEach(() => {
    previousQuery = process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    previousBinding = process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
    jest
      .mocked(loadQueryDelivery)
      .mockReset()
      .mockResolvedValue(delivery as any);
    jest.mocked(authorizeNativeScope).mockReset();
  });
  afterEach(() => {
    if (previousQuery === undefined)
      delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    else process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = previousQuery;
    if (previousBinding === undefined)
      delete process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
    else process.env.WREN_PLATFORM_BINDING_CONFIG_FILE = previousBinding;
  });

  const standalone = () => {
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    delete process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
  };
  const governed = () => {
    process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = '/fixture/query.json';
    process.env.WREN_PLATFORM_BINDING_CONFIG_FILE = '/fixture/binding.json';
  };

  test('STANDALONE: a member, an anonymous caller and the native service are refused before the read', async () => {
    standalone();
    const read = jest.fn(async () => ({ items: [], total: 0 }));
    const gated: any = kailoAdminRead(read);
    for (const ctx of [
      { kailoUser: user(false) },
      { kailoUser: null },
      { kailoUser: user(true), kailoNativeService: true },
    ])
      await expect(gated(undefined, {}, ctx)).rejects.toMatchObject(refused);
    expect(read).not.toHaveBeenCalled();
    await expect(
      gated(undefined, { pagination: {} }, { kailoUser: user(true) }),
    ).resolves.toEqual({ items: [], total: 0 });
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('GOVERNED: only a fresh Core manage on the binding admits the read', async () => {
    governed();
    const read = jest.fn(async () => ({ items: [], total: 0 }));
    const gated: any = kailoAdminRead(read);
    const ctx = { kailoUser: user(false), nativeHumanToken: 'human-token' };

    jest
      .mocked(authorizeNativeScope)
      .mockRejectedValueOnce(new NativeQueryRefusal(403, 'QUERY_SCOPE_DENIED'));
    await expect(gated(undefined, {}, ctx)).rejects.toMatchObject(refused);
    expect(read).not.toHaveBeenCalled();

    jest
      .mocked(authorizeNativeScope)
      .mockResolvedValueOnce({ generation: 1 } as any);
    await expect(gated(undefined, {}, ctx)).resolves.toEqual({
      items: [],
      total: 0,
    });
    expect(authorizeNativeScope).toHaveBeenLastCalledWith(
      delivery,
      'human-token',
      'manage',
    );
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('the GraphQL apiHistory query refuses a member without reading history', async () => {
    standalone();
    const apiHistoryRepository = {
      count: jest.fn(async () => 0),
      findAllWithPagination: jest.fn(async () => []),
    };
    await expect(
      (originalResolvers.Query as any).apiHistory(
        undefined,
        { pagination: { offset: 0, limit: 10 } },
        { kailoUser: user(false), apiHistoryRepository },
      ),
    ).rejects.toMatchObject(refused);
    expect(apiHistoryRepository.count).not.toHaveBeenCalled();
    await expect(
      (originalResolvers.Query as any).apiHistory(
        undefined,
        { pagination: { offset: 0, limit: 10 } },
        { kailoUser: user(true), apiHistoryRepository },
      ),
    ).resolves.toEqual({ items: [], total: 0, hasMore: false });
    expect(apiHistoryRepository.count).toHaveBeenCalledTimes(1);
  });
});
