import { createHash, randomUUID, webcrypto } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import knex, { Knex } from 'knex';
import {
  KailoNotifier,
  KailoNotifications,
  KailoNotificationDelivery,
  notificationKey,
  validNotification,
} from './apollo/server/services/kailoNotifications';
import { KailoShareService } from './apollo/server/services/kailoShare';
import { KailoDirectoryConfig } from './apollo/server/services/kailoMemberDirectory';
import { KailoUserRepository } from './apollo/server/repositories/kailoUserRepository';
import { DashboardCacheBackgroundTracker } from './apollo/server/backgrounds/dashboardCacheBackgroundTracker';
import { GeneralErrorCodes } from './apollo/server/utils/error';
import { KailoUserProfile } from './utils/kailoUser';

/* eslint-disable @typescript-eslint/no-var-requires */
const ownership = require('../migrations/20261021000000_kailo_user_ownership');
const identityMigration = require('../migrations/20261024000000_kailo_user_identity');
/* eslint-enable @typescript-eslint/no-var-requires */

if (!(globalThis as any).crypto?.subtle) (globalThis as any).crypto = webcrypto;

// DD-138(4), `.design/07` §4.8.3: component -> Core notification delivery,
// the share mutation's validation and the dashboard notification events.

const ISSUER = 'https://idp.example.test/realms/kailo';
const BINDING = randomUUID();
const key = (subject: string) =>
  createHash('sha256')
    .update(JSON.stringify([ISSUER, subject]))
    .digest('hex');

let dir: string;
let config: KailoDirectoryConfig;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'kailo-notify-'));
  writeFileSync(join(dir, 'secret'), 'directory-secret\n');
  config = {
    bindingId: BINDING,
    clientId: 'kailo-wren-directory',
    clientSecretFile: join(dir, 'secret'),
    tokenUrl: 'http://idp.test/realms/kailo/protocol/openid-connect/token',
    coreUrl: 'http://core.test',
    intervalSeconds: 60,
    issuer: ISSUER,
  };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const NOTIFICATIONS_URL = () =>
  `http://core.test/service/v1/component-notifications/bindings/${BINDING}/notifications`;

// Fake IdP token endpoint + Core listener: `answers` are consumed in order
// for notification POSTs ('network' = transport failure).
class Platform {
  answers: (number | 'network')[] = [];
  tokens = 0;
  posts: { authorization: string; body: any; raw: string }[] = [];
  expiresIn = 300;

  fetch = jest.fn(async (url: any, init: any): Promise<Response> => {
    const target = String(url);
    if (target === config.tokenUrl) {
      this.tokens += 1;
      return new Response(
        JSON.stringify({
          access_token: `token-${this.tokens}`,
          token_type: 'Bearer',
          expires_in: this.expiresIn,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    expect(target).toBe(NOTIFICATIONS_URL());
    expect(init.method).toBe('POST');
    this.posts.push({
      authorization: init.headers.authorization,
      body: JSON.parse(init.body),
      raw: init.body,
    });
    const answer = this.answers.length ? this.answers.shift() : 201;
    if (answer === 'network') throw new TypeError('fetch failed');
    return new Response(
      JSON.stringify({
        notificationId: randomUUID(),
        duplicate: answer === 200,
      }),
      { status: answer },
    );
  });
}

const delivery = (
  changes: Partial<KailoNotificationDelivery> = {},
): KailoNotificationDelivery => ({
  idempotencyKey: notificationKey('SHARED', 'event-1', {
    issuer: ISSUER,
    subject: 'bob',
  }),
  recipient: { issuer: ISSUER, subject: 'bob' },
  actor: { issuer: ISSUER, subject: 'alice' },
  category: 'SHARED',
  title: { ZH_CN: 'Alice 与你分享了问数对话', EN: 'Alice shared a thread' },
  path: '/home/7',
  ...changes,
});

const notifier = (platform: Platform, options = {}) =>
  new KailoNotifier(config, {
    fetch: platform.fetch as any,
    retryDelaysMs: [1, 1, 1, 1],
    ...options,
  });

describe('DD-138(4) notification delivery client', () => {
  test('without the directory configuration delivery is a no-op', async () => {
    const platform = new Platform();
    const off = new KailoNotifier(null, { fetch: platform.fetch as any });
    expect(off.enabled).toBe(false);
    expect(off.enqueue(delivery())).toBe(false);
    await off.whenIdle();
    expect(platform.fetch).not.toHaveBeenCalled();
    const events = new KailoNotifications(
      off,
      { findIdentities: jest.fn() },
      null,
    );
    expect(
      await events.notify({
        event: 'x',
        category: 'SHARED',
        recipientKeys: [key('bob')],
        title: { ZH_CN: 'a', EN: 'a' },
        path: '/home/1',
      }),
    ).toBe(0);
  });

  test('201 delivers once with the directory client token; the token is cached', async () => {
    const platform = new Platform();
    const queue = notifier(platform);
    expect(queue.enqueue(delivery())).toBe(true);
    await queue.whenIdle();
    expect(queue.enqueue(delivery({ path: '/home/8' }))).toBe(true);
    await queue.whenIdle();
    expect(platform.tokens).toBe(1);
    expect(platform.posts).toHaveLength(2);
    expect(platform.posts[0].authorization).toBe('Bearer token-1');
    expect(platform.posts[0].body).toEqual(delivery());
    expect(Object.keys(platform.posts[0].body).sort()).toEqual([
      'actor',
      'category',
      'idempotencyKey',
      'path',
      'recipient',
      'title',
    ]);
  });

  test('200 (duplicate) is delivered, 409 and 403 are final', async () => {
    for (const status of [200, 409, 403]) {
      const platform = new Platform();
      platform.answers = [status];
      const queue = notifier(platform);
      queue.enqueue(delivery());
      await queue.whenIdle();
      expect(platform.posts).toHaveLength(1);
      expect(platform.tokens).toBe(1);
    }
  });

  test('429, 503 and transport errors retry with the same idempotency key', async () => {
    const platform = new Platform();
    platform.answers = [429, 503, 'network', 201];
    const queue = notifier(platform);
    queue.enqueue(delivery());
    await queue.whenIdle();
    expect(platform.posts).toHaveLength(4);
    expect(new Set(platform.posts.map((post) => post.raw)).size).toBe(1);
    expect(queue.pending).toBe(0);
  });

  test('retries stop after five attempts', async () => {
    const platform = new Platform();
    platform.answers = [503, 503, 503, 503, 503, 503];
    const queue = notifier(platform);
    queue.enqueue(delivery());
    await queue.whenIdle();
    expect(platform.posts).toHaveLength(5);
  });

  test('a cached token refused with 401/403 is replaced once', async () => {
    for (const status of [401, 403]) {
      const platform = new Platform();
      const queue = notifier(platform);
      queue.enqueue(delivery());
      await queue.whenIdle();
      platform.answers = [status, 201];
      queue.enqueue(delivery({ path: '/home/9' }));
      await queue.whenIdle();
      expect(platform.tokens).toBe(2);
      expect(platform.posts.map((post) => post.authorization)).toEqual([
        'Bearer token-1',
        'Bearer token-1',
        'Bearer token-2',
      ]);
    }
  });

  test('a token about to expire is not reused', async () => {
    const platform = new Platform();
    platform.expiresIn = 20;
    const queue = notifier(platform);
    queue.enqueue(delivery());
    await queue.whenIdle();
    queue.enqueue(delivery({ path: '/home/9' }));
    await queue.whenIdle();
    expect(platform.tokens).toBe(2);
  });

  test('a full queue drops the oldest entry', async () => {
    const platform = new Platform();
    const queue = notifier(platform, { capacity: 2 });
    queue.enqueue(delivery({ path: '/home/1' }));
    queue.enqueue(delivery({ path: '/home/2' }));
    queue.enqueue(delivery({ path: '/home/3' }));
    expect(queue.dropped).toBe(1);
    await queue.whenIdle();
    expect(platform.posts.map((post) => post.body.path)).toEqual([
      '/home/2',
      '/home/3',
    ]);
  });

  test('only contract-shaped deliveries are queued', () => {
    expect(validNotification(delivery())).toBe(true);
    for (const path of [
      'home/1',
      '//evil.test/x',
      '/home/1?token=x',
      '/home/1?Access_Token=x',
      '/home 1',
      '/a\\b',
      '',
    ])
      expect(validNotification(delivery({ path }))).toBe(false);
    expect(
      validNotification(
        delivery({ actor: { issuer: ISSUER, subject: 'bob' } }),
      ),
    ).toBe(false);
    expect(
      validNotification(
        delivery({ title: { ZH_CN: 'x'.repeat(121), EN: 'x' } }),
      ),
    ).toBe(false);
    expect(
      validNotification(delivery({ idempotencyKey: 'bad key with spaces' })),
    ).toBe(false);
    expect(validNotification(delivery({ category: 'INVITED' as any }))).toBe(
      false,
    );
    expect(
      notificationKey('SHARED', 'event-1', { issuer: ISSUER, subject: 'bob' }),
    ).toMatch(/^data-query\.shared\.[a-f0-9]{40}$/);
  });
});

describe('DD-138(4) notification events', () => {
  let db: Knex;
  let platform: Platform;
  let queue: KailoNotifier;
  let events: KailoNotifications;
  let listed: {
    userKey: string;
    admin: boolean;
    name: string;
    picture: null;
  }[];

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    for (const name of ['thread', 'sql_pair', 'instruction', 'api_history'])
      await db.schema.createTable(name, (table) => table.increments('id'));
    await ownership.up(db);
    await identityMigration.up(db);
    for (const subject of ['alice', 'bob', 'carol'])
      await db('kailo_user').insert({
        user_key: key(subject),
        name: subject,
        issuer: ISSUER,
        subject,
      });
    // dave is a member whose identity is not known yet.
    await db('kailo_user').insert({ user_key: key('dave'), name: 'dave' });
    listed = ['alice', 'bob', 'dave'].map((subject) => ({
      userKey: key(subject),
      admin: subject === 'alice' || subject === 'bob',
      name: subject,
      picture: null,
    }));
    platform = new Platform();
    queue = notifier(platform);
    events = new KailoNotifications(queue, new KailoUserRepository(db), {
      list: async () => listed,
    });
  });
  afterEach(async () => {
    await db.destroy();
  });

  test('a thread share notifies current members only, never the actor', async () => {
    const requestId = randomUUID();
    const share = () =>
      events.shareThread({
        requestId,
        actorKey: key('alice'),
        actorName: 'Alice',
        // carol left the Tenant, dave has no known identity.
        recipientKeys: [key('bob'), key('alice'), key('carol'), key('dave')],
        threadId: 7,
        threadName: 'Revenue by region',
      });
    expect(await share()).toBe(1);
    await queue.whenIdle();
    expect(platform.posts).toHaveLength(1);
    const body = platform.posts[0].body;
    expect(body).toMatchObject({
      recipient: { issuer: ISSUER, subject: 'bob' },
      actor: { issuer: ISSUER, subject: 'alice' },
      category: 'SHARED',
      path: '/home/7',
      title: {
        ZH_CN: 'Alice 与你分享了问数对话「Revenue by region」',
        EN: 'Alice shared the Data Q&A thread “Revenue by region” with you',
      },
    });
    // A replay of the same share event keeps the same idempotency key.
    await share();
    await queue.whenIdle();
    expect(platform.posts[1].body.idempotencyKey).toBe(body.idempotencyKey);
  });

  test('a dashboard item from someone else’s thread tells its creator', async () => {
    expect(
      await events.dashboardItemAdded({
        actorKey: key('alice'),
        actorName: 'Alice',
        ownerKey: key('alice'),
        itemId: 3,
        threadName: 'own',
      }),
    ).toBe(0);
    expect(
      await events.dashboardItemAdded({
        actorKey: key('alice'),
        actorName: 'Alice',
        ownerKey: key('bob'),
        itemId: 3,
        threadName: 'Revenue',
      }),
    ).toBe(1);
    await queue.whenIdle();
    expect(platform.posts[0].body).toMatchObject({
      category: 'CONTENT_UPDATED',
      recipient: { subject: 'bob' },
      path: '/home/dashboard',
      title: { ZH_CN: '你的问题已加入团队看板' },
    });
  });

  test('a refresh run with failures notifies each admin once, without actor', async () => {
    const run = { dashboardId: 1, runId: randomUUID(), total: 4, failed: 2 };
    expect(await events.dashboardRefreshFinished({ ...run, failed: 0 })).toBe(
      0,
    );
    expect(await events.dashboardRefreshFinished(run)).toBe(2);
    await queue.whenIdle();
    expect(
      platform.posts.map((post) => post.body.recipient.subject).sort(),
    ).toEqual(['alice', 'bob']);
    for (const post of platform.posts) {
      expect(post.body.category).toBe('TASK_COMPLETED');
      expect(post.body.actor).toBeUndefined();
      expect(post.body.path).toBe('/home/dashboard');
    }
  });

  test('the scheduled refresh reports its run (aggregated, once)', async () => {
    jest.useFakeTimers();
    try {
      const reports: any[] = [];
      const tracker = new DashboardCacheBackgroundTracker({
        dashboardRepository: { updateOne: jest.fn() } as any,
        dashboardItemRepository: {
          findAllBy: jest.fn().mockResolvedValue([
            { id: 1, detail: { sql: 'select 1' } },
            { id: 2, detail: { sql: 'select 2' } },
            { id: 3, detail: { sql: 'select 3' } },
          ]),
        } as any,
        dashboardItemRefreshJobRepository: {
          createOne: jest.fn(async (row) => ({
            ...row,
            id: row.dashboardItemId,
          })),
          updateOne: jest.fn(),
        } as any,
        projectService: {
          getCurrentProject: jest.fn().mockResolvedValue({ id: 5 }),
        } as any,
        deployService: {
          getLastDeployment: jest.fn().mockResolvedValue({ manifest: {} }),
        } as any,
        queryService: {
          preview: jest.fn(async (sql: string) => {
            if (sql !== 'select 2') throw new Error('source down');
            return { data: [], columns: [] };
          }),
        } as any,
        onScheduledRefreshFinished: (run) => reports.push(run),
      });
      await (tracker as any).refreshDashboardCache({
        id: 9,
        scheduleCron: '* * * * *',
      });
      expect(reports).toEqual([
        { dashboardId: 9, runId: expect.any(String), total: 3, failed: 2 },
      ]);
    } finally {
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });
});

describe('DD-138(4) share with member', () => {
  const user = (subject: string): KailoUserProfile => ({
    key: key(subject),
    name: subject,
    username: subject,
    email: null,
    picture: null,
    locale: null,
    admin: false,
  });
  const members = ['alice', 'bob', 'carol'].map((subject) => ({
    userKey: key(subject),
    admin: false,
    name: subject,
    picture: null,
  }));
  const setup = (enabled = true, delivered = true) => {
    const notifications = {
      enabled,
      shareThread: jest.fn(async (input: any) => input.recipientKeys.length),
      shareDashboard: jest.fn(async (input: any) => input.recipientKeys.length),
    };
    const service = new KailoShareService(
      notifications as any,
      { list: async () => (delivered ? members : null) },
      {
        findIdentities: async (keys: string[]) =>
          new Map(
            keys
              .filter((k) => k !== key('carol'))
              .map((k) => [k, { userKey: k, issuer: ISSUER, subject: 'x' }]),
          ),
      },
    );
    return { notifications, service };
  };
  const lookups = {
    threadName: async (id: number) => (id === 7 ? 'Revenue' : null),
    dashboardExists: async () => true,
  };

  test('candidates are the other addressable members', async () => {
    const { service } = setup();
    expect(
      (await service.candidates(user('alice'))).map((m) => m.name),
    ).toEqual(['bob']);
    expect(await setup(false).service.candidates(user('alice'))).toEqual([]);
    expect(await setup().service.candidates(null)).toEqual([]);
  });

  test('a valid thread or dashboard share queues notifications', async () => {
    const { service, notifications } = setup();
    const requestId = randomUUID();
    expect(
      await service.share(
        user('alice'),
        { target: { threadId: 7 }, recipients: [key('bob')], requestId },
        lookups,
      ),
    ).toBe(1);
    expect(notifications.shareThread).toHaveBeenCalledWith({
      requestId,
      actorKey: key('alice'),
      actorName: 'alice',
      recipientKeys: [key('bob')],
      threadId: 7,
      threadName: 'Revenue',
    });
    expect(
      await service.share(
        user('alice'),
        {
          target: { dashboard: true },
          recipients: [key('bob'), key('carol')],
          requestId: randomUUID(),
        },
        lookups,
      ),
    ).toBe(2);
  });

  test('sharing is unavailable without delivery, directory or user', async () => {
    const input = {
      target: { threadId: 7 },
      recipients: [key('bob')],
      requestId: randomUUID(),
    };
    for (const [service, who] of [
      [setup(false).service, user('alice')],
      [setup(true, false).service, user('alice')],
      [setup().service, null],
    ] as const)
      await expect(service.share(who, input, lookups)).rejects.toMatchObject({
        extensions: { code: GeneralErrorCodes.KAILO_SHARE_UNAVAILABLE },
      });
  });

  test.each([
    ['no target', { target: {}, recipients: [key('bob')] }],
    [
      'both targets',
      { target: { threadId: 7, dashboard: true }, recipients: [key('bob')] },
    ],
    ['bad thread id', { target: { threadId: -1 }, recipients: [key('bob')] }],
    ['unknown thread', { target: { threadId: 8 }, recipients: [key('bob')] }],
    ['no recipients', { target: { threadId: 7 }, recipients: [] }],
    ['self', { target: { threadId: 7 }, recipients: [key('alice')] }],
    ['non-member', { target: { threadId: 7 }, recipients: [key('mallory')] }],
    [
      'duplicates',
      { target: { threadId: 7 }, recipients: [key('bob'), key('bob')] },
    ],
    ['not a key', { target: { threadId: 7 }, recipients: ['bob'] }],
    [
      'too many',
      {
        target: { dashboard: true },
        recipients: Array.from({ length: 51 }, (_, i) => key(`m${i}`)),
      },
    ],
  ])('refuses %s without notifying anyone', async (_name, input: any) => {
    const { service, notifications } = setup();
    await expect(
      service.share(
        user('alice'),
        { requestId: randomUUID(), ...input },
        lookups,
      ),
    ).rejects.toMatchObject({
      extensions: { code: GeneralErrorCodes.KAILO_SHARE_INVALID },
    });
    expect(notifications.shareThread).not.toHaveBeenCalled();
    expect(notifications.shareDashboard).not.toHaveBeenCalled();
  });

  test('refuses a malformed request id and a missing dashboard', async () => {
    const { service } = setup();
    await expect(
      service.share(
        user('alice'),
        { target: { threadId: 7 }, recipients: [key('bob')], requestId: 'x' },
        lookups,
      ),
    ).rejects.toMatchObject({
      extensions: { code: GeneralErrorCodes.KAILO_SHARE_INVALID },
    });
    await expect(
      service.share(
        user('alice'),
        {
          target: { dashboard: true },
          recipients: [key('bob')],
          requestId: randomUUID(),
        },
        { ...lookups, dashboardExists: async () => false },
      ),
    ).rejects.toMatchObject({
      extensions: { code: GeneralErrorCodes.KAILO_SHARE_INVALID },
    });
  });
});
