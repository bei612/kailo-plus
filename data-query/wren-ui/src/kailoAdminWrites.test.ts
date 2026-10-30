import resolvers from './apollo/server/resolvers';

// DD-164(3) item 6 (`07` §4.7.4 Wren table): on a STANDALONE instance every
// native modeling write is reserved to the Kailo Tenant admin from the member
// directory. The wrapper refuses a member before the original resolver runs,
// so no model, view, relation or deployment is touched.
jest.mock('./common', () => ({ components: { apiHistoryRepository: {} } }));

const member = {
  key: 'b'.repeat(64),
  name: 'Member',
  username: null,
  email: null,
  picture: null,
  locale: null,
  admin: false,
};

const ADMIN_WRITES = [
  'createModel',
  'updateModel',
  'deleteModel',
  'createView',
  'deleteView',
  'deploy',
  'saveDataSource',
  'saveTables',
  'saveRelations',
] as const;

describe('DD-164(3) STANDALONE native modeling writes', () => {
  let previous: Record<string, string | undefined>;
  beforeEach(() => {
    previous = {
      query: process.env.WREN_PLATFORM_QUERY_CONFIG_FILE,
      binding: process.env.WREN_PLATFORM_BINDING_CONFIG_FILE,
    };
    delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
    delete process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
  });
  afterEach(() => {
    if (previous.query !== undefined)
      process.env.WREN_PLATFORM_QUERY_CONFIG_FILE = previous.query;
    if (previous.binding !== undefined)
      process.env.WREN_PLATFORM_BINDING_CONFIG_FILE = previous.binding;
  });

  test.each(ADMIN_WRITES)(
    '%s refuses a member with KAILO_ADMIN_REQUIRED before the resolver runs',
    async (name) => {
      const ctx: any = { kailoUser: member, kailoNativeService: false };
      const mutation = (resolvers as any).Mutation[name];
      expect(typeof mutation).toBe('function');
      await expect(
        mutation(null, { data: {}, where: { id: 1 } }, ctx, {}),
      ).rejects.toMatchObject({
        extensions: { code: 'KAILO_ADMIN_REQUIRED' },
      });
    },
  );

  test.each(['createModel', 'createView'] as const)(
    '%s refuses a request without a verified Kailo user',
    async (name) => {
      const ctx: any = { kailoUser: null, kailoNativeService: false };
      await expect(
        (resolvers as any).Mutation[name](null, { data: {} }, ctx, {}),
      ).rejects.toMatchObject({
        extensions: { code: 'KAILO_ADMIN_REQUIRED' },
      });
    },
  );
});
