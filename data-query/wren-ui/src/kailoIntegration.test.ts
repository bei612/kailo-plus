import knex, { Knex } from 'knex';
import originalResolvers from './apollo/server/resolvers';
import { KailoUserRepository } from './apollo/server/repositories/kailoUserRepository';
import { ApiHistoryRepository } from './apollo/server/repositories/apiHistoryRepository';
import {
  KailoUserDirectory,
  assertStandaloneAdmin,
  assertStandaloneOwnerOrAdmin,
  isKailoAdmin,
} from './apollo/server/services/kailoUserService';
import { GeneralErrorCodes } from './apollo/server/utils/error';
import {
  encodeKailoUser,
  KailoUserProfile,
  KAILO_USER_HEADER,
} from './utils/kailoUser';
import {
  applyTheme,
  hostOrigin,
  initialTheme,
  parseLocale,
  parseTheme,
  readHostMessage,
  renewNativeSession,
} from './utils/kailoEmbed';
import { kailoProductTitle, kailoText } from './utils/kailoI18n';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require('../migrations/20261021000000_kailo_user_ownership');

jest.mock('./common', () => ({ components: { apiHistoryRepository: {} } }));

const profile = (changes: Partial<KailoUserProfile> = {}): KailoUserProfile => ({
  key: 'a'.repeat(64),
  name: 'Member',
  username: 'member',
  email: null,
  picture: null,
  locale: null,
  admin: false,
  ...changes,
});

const standalone = () => {
  delete process.env.WREN_PLATFORM_QUERY_CONFIG_FILE;
  delete process.env.WREN_PLATFORM_BINDING_CONFIG_FILE;
};

describe('DD-133 role mapping on a STANDALONE instance', () => {
  beforeEach(standalone);

  test('a member is refused admin changes, an admin and the native service are not', () => {
    expect(() => assertStandaloneAdmin(profile())).toThrow(
      expect.objectContaining({
        extensions: expect.objectContaining({
          code: GeneralErrorCodes.KAILO_ADMIN_REQUIRED,
        }),
      }),
    );
    expect(() => assertStandaloneAdmin(null)).toThrow();
    expect(() => assertStandaloneAdmin(profile({ admin: true }))).not.toThrow();
    expect(() => assertStandaloneAdmin(null, true)).not.toThrow();
  });

  test('a thread is managed by its creator or an admin only', () => {
    const owner = profile();
    expect(() => assertStandaloneOwnerOrAdmin(owner, owner.key)).not.toThrow();
    expect(() =>
      assertStandaloneOwnerOrAdmin(owner, 'b'.repeat(64)),
    ).toThrow();
    expect(() => assertStandaloneOwnerOrAdmin(owner, null)).toThrow();
    expect(() =>
      assertStandaloneOwnerOrAdmin(profile({ admin: true }), null),
    ).not.toThrow();
  });

  test('the session role follows the signed entitlement', async () => {
    expect(await isKailoAdmin(profile(), undefined)).toBe(false);
    expect(await isKailoAdmin(profile({ admin: true }), undefined)).toBe(true);
    expect(await isKailoAdmin(null, undefined)).toBe(false);
  });

  test('original modeling/connection/reset mutations refuse a member before dispatch', async () => {
    const resetCurrentProject = jest.fn();
    const ctx: any = {
      kailoUser: profile(),
      projectService: { getCurrentProject: resetCurrentProject },
    };
    for (const field of [
      'resetCurrentProject',
      'updateDataSource',
      'saveDataSource',
      'deploy',
      'createModel',
      'createSqlPair',
      'createInstruction',
      'deleteDashboardItem',
    ])
      await expect(
        (originalResolvers.Mutation as any)[field](undefined, {}, ctx, {}),
      ).rejects.toMatchObject({
        extensions: { code: GeneralErrorCodes.KAILO_ADMIN_REQUIRED },
      });
    expect(resetCurrentProject).not.toHaveBeenCalled();
  });

  test('renaming a thread: its creator passes, another member is refused', async () => {
    const owner = profile();
    const askingService = {
      getThreadOwner: jest.fn(async () => owner.key),
      updateThread: jest.fn(async (id) => ({ id, summary: 'renamed' })),
    };
    const args = { where: { id: 5 }, data: { summary: 'renamed' } };
    const other: any = {
      kailoUser: profile({ key: 'c'.repeat(64) }),
      askingService,
    };
    await expect(
      originalResolvers.Mutation.updateThread(undefined, args, other, {}),
    ).rejects.toMatchObject({
      extensions: { code: GeneralErrorCodes.KAILO_ADMIN_REQUIRED },
    });
    expect(askingService.updateThread).not.toHaveBeenCalled();
    expect(askingService.getThreadOwner).toHaveBeenCalledWith({ threadId: 5 });
  });

  test('kailoSession reports the user, the role and the deployment name', async () => {
    const previous = process.env.PLATFORM_DISPLAY_NAME;
    const ancestors = process.env.KAILO_FRAME_ANCESTORS;
    process.env.PLATFORM_DISPLAY_NAME = 'Kailo';
    process.env.KAILO_FRAME_ANCESTORS =
      'http://192.168.0.193:58090 https://kailo.example.test bad*origin';
    try {
      const session = await originalResolvers.Query.kailoSession(
        undefined,
        {},
        { kailoUser: profile({ admin: true, name: null }) } as any,
        {} as any,
      );
      expect(session).toEqual({
        user: {
          name: 'member',
          username: 'member',
          email: null,
          picture: null,
          isCurrentUser: true,
        },
        isAdmin: true,
        productName: 'Kailo',
        hostOrigins: ['http://192.168.0.193:58090', 'https://kailo.example.test'],
      });
    } finally {
      if (previous === undefined) delete process.env.PLATFORM_DISPLAY_NAME;
      else process.env.PLATFORM_DISPLAY_NAME = previous;
      if (ancestors === undefined) delete process.env.KAILO_FRAME_ANCESTORS;
      else process.env.KAILO_FRAME_ANCESTORS = ancestors;
    }
  });
});

describe('Kailo users and ownership in the native database', () => {
  let db: Knex;
  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    for (const name of ['thread', 'sql_pair', 'instruction', 'api_history'])
      await db.schema.createTable(name, (table) => {
        table.increments('id');
        table.integer('project_id');
        table.text('headers');
        table.integer('status_code');
      });
    await migration.up(db);
  });
  afterEach(async () => {
    await db?.destroy();
  });

  test('display claims are upserted once per change and loaded in one batch', async () => {
    const repository = new KailoUserRepository(db);
    const upsert = jest.spyOn(repository, 'upsertProfile');
    const find = jest.spyOn(repository, 'findByKeys');
    const directory = new KailoUserDirectory(repository);
    await directory.remember(profile());
    await directory.remember(profile());
    await directory.remember(profile({ name: 'Renamed in Kailo' }));
    await directory.remember(profile({ key: 'b'.repeat(64), name: 'Other' }));
    expect(upsert).toHaveBeenCalledTimes(3);
    const loader = directory.loader();
    const [first, second, missing, invalid] = await Promise.all([
      loader.load('a'.repeat(64)),
      loader.load('b'.repeat(64)),
      loader.load('d'.repeat(64)),
      loader.load('not-a-key'),
    ]);
    expect(find).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ name: 'Renamed in Kailo' });
    expect(second).toMatchObject({ name: 'Other' });
    expect(missing).toBeNull();
    expect(invalid).toBeNull();
  });

  test('API history records the verified Kailo user, never the header itself', async () => {
    const repository = new ApiHistoryRepository(db);
    const user = profile({ key: 'e'.repeat(64) });
    await repository.createOne({
      projectId: 1,
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        [KAILO_USER_HEADER]: encodeKailoUser(user),
        authorization: 'Bearer secret',
      } as any,
    } as any);
    const [row] = await db('api_history');
    expect(row.owner_key).toBe(user.key);
    expect(JSON.parse(row.headers)).toEqual({
      'content-type': 'application/json',
    });
  });

  test('the migration is reversible', async () => {
    await migration.down(db);
    expect(await db.schema.hasTable('kailo_user')).toBe(false);
    expect(await db.schema.hasColumn('thread', 'owner_key')).toBe(false);
  });
});

describe('Kailo presentation bridge', () => {
  test('theme and locale values follow the Kailo names only', () => {
    expect(parseTheme('buzz-dark')).toBe('dark');
    expect(parseTheme('LIGHT')).toBe('light');
    expect(parseTheme('solarized')).toBeNull();
    expect(parseLocale('en-US')).toBe('en');
    expect(parseLocale('zh_CN')).toBe('zh-CN');
    expect(parseLocale('fr')).toBeNull();
    expect(kailoProductTitle('zh-CN', 'Kailo')).toBe('Kailo 问数');
    expect(kailoProductTitle('en', 'Kailo')).toBe('Kailo Data Q&A');
    expect(kailoProductTitle('en', '')).toBe(kailoText('en', 'componentName'));
  });

  test('host messages are read only from the parent at an allowed Kailo origin', () => {
    const parent = {};
    const allowed = ['https://kailo.example.test'];
    const message = { source: 'kailo-host', type: 'theme', theme: 'dark' };
    expect(
      readHostMessage(
        { origin: allowed[0], source: parent as any, data: message },
        allowed,
        parent,
      ),
    ).toEqual({ type: 'theme', theme: 'dark' });
    expect(
      readHostMessage(
        { origin: 'https://evil.example', source: parent as any, data: message },
        allowed,
        parent,
      ),
    ).toBeNull();
    expect(
      readHostMessage(
        { origin: allowed[0], source: {} as any, data: message },
        allowed,
        parent,
      ),
    ).toBeNull();
    expect(
      readHostMessage(
        {
          origin: allowed[0],
          source: parent as any,
          data: { ...message, source: 'other' },
        },
        allowed,
        parent,
      ),
    ).toBeNull();
  });

  describe('in a browser frame', () => {
    const globals = global as any;
    let storage: Record<string, string>;
    let frames: any[];
    let path: string | Error;

    beforeEach(() => {
      storage = {};
      frames = [];
      path = '/kailo-embed/auth-ok';
      const top = {};
      globals.window = {
        self: {},
        top,
        parent: top,
        location: {
          search: '',
          ancestorOrigins: ['https://kailo.example.test'],
        },
        sessionStorage: {
          getItem: (key: string) => storage[key] ?? null,
          setItem: (key: string, value: string) => (storage[key] = value),
        },
        setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
        clearTimeout: (id: any) => clearTimeout(id),
      };
      const classes = new Set<string>();
      globals.document = {
        referrer: '',
        documentElement: {
          classList: {
            toggle: (name: string, on: boolean) =>
              on ? classes.add(name) : classes.delete(name),
            contains: (name: string) => classes.has(name),
          },
          setAttribute: jest.fn(),
          style: {},
        },
        createElement: () => {
          const listeners: Record<string, () => void> = {};
          const frame: any = {
            style: {},
            setAttribute: jest.fn(),
            addEventListener: (event: string, fn: () => void) =>
              (listeners[event] = fn),
            remove: jest.fn(),
            get contentWindow() {
              return {
                get location() {
                  if (path instanceof Error) throw path;
                  return { pathname: path };
                },
              };
            },
          };
          frame.fire = () => listeners.load?.();
          frames.push(frame);
          return frame;
        },
        body: {
          appendChild: (frame: any) => setTimeout(() => frame.fire(), 0),
        },
      };
    });

    afterEach(() => {
      delete globals.window;
      delete globals.document;
    });

    test('the URL theme wins and is kept for the tab; .dark follows it', () => {
      expect(initialTheme('?kailo_theme=dark')).toBe('dark');
      expect(storage['kailo.theme']).toBe('dark');
      expect(initialTheme('')).toBe('dark');
      applyTheme('light');
      expect(
        globals.document.documentElement.classList.contains('dark'),
      ).toBe(false);
      expect(
        globals.document.documentElement.classList.contains('light'),
      ).toBe(true);
    });

    test('the host origin must be an allowed Kailo origin', () => {
      expect(hostOrigin(['https://kailo.example.test'])).toBe(
        'https://kailo.example.test',
      );
      expect(hostOrigin(['https://other.example.test'])).toBeNull();
    });

    test('silent renewal succeeds only when the hidden frame lands on auth-ok', async () => {
      await expect(renewNativeSession(1000)).resolves.toBe(true);
      expect(frames[0].src).toBe(
        '/auth/login?returnTo=%2Fkailo-embed%2Fauth-ok',
      );
      expect(frames[0].remove).toHaveBeenCalled();
    });

    test('a missing IdP session (cross-origin login page) is reported, not shown', async () => {
      path = new Error('SecurityError: cross-origin frame');
      await expect(renewNativeSession(1000)).resolves.toBe(false);
      path = '/oauth/callback';
      await expect(renewNativeSession(1000)).resolves.toBe(false);
    });
  });
});
