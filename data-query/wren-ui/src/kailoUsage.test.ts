import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GraphQLError } from 'graphql';
import {
  KailoUsage,
  admitKailoDataQuery,
  dataQueryKey,
  reportKailoDataQuery,
  usageRefusalText,
} from './apollo/server/services/kailoUsage';
import { KailoDirectoryConfig } from './apollo/server/services/kailoMemberDirectory';
import { KailoUserProfile } from './utils/kailoUser';

// DD-165, `.design/07` §4.8.9: Data Q&A questions are admitted by the Kailo
// quota before an asking task exists and reported once per native query.

const ISSUER = 'https://idp.example.test/realms/kailo';
const BINDING = randomUUID();

let dir: string;
let config: KailoDirectoryConfig;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'kailo-usage-'));
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

const url = (path: string) =>
  `http://core.test/service/v1/component-usage/bindings/${BINDING}/${path}`;

class Platform {
  decisions: (string | number)[] = ['ALLOWED'];
  reports: (number | 'network')[] = [201];
  admissions: any[] = [];
  posts: string[] = [];

  fetch = jest.fn(async (target: any, init: any): Promise<Response> => {
    const href = String(target);
    if (href === config.tokenUrl)
      return new Response(
        JSON.stringify({
          access_token: 'token',
          token_type: 'Bearer',
          expires_in: 300,
        }),
        { status: 200 },
      );
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer token');
    if (href === url('admission')) {
      this.admissions.push(JSON.parse(init.body));
      const next =
        this.decisions.length > 1 ? this.decisions.shift() : this.decisions[0];
      if (typeof next === 'number') return new Response('', { status: next });
      return new Response(JSON.stringify({ decision: next }), { status: 200 });
    }
    expect(href).toBe(url('reports'));
    this.posts.push(init.body);
    const next =
      this.reports.length > 1 ? this.reports.shift() : this.reports[0];
    if (next === 'network') throw new TypeError('fetch failed');
    return new Response('{}', { status: next });
  });
}

const member = { issuer: ISSUER, subject: 'user-1' };
const profile = (locale: string | null = 'zh-CN'): KailoUserProfile => ({
  key: 'k',
  name: null,
  username: null,
  email: null,
  picture: null,
  locale,
  admin: null,
  issuer: ISSUER,
  subject: 'user-1',
});

describe('KailoUsage admission', () => {
  it('is a no-op without the directory configuration', async () => {
    const usage = new KailoUsage(null);
    expect(usage.enabled).toBe(false);
    await expect(usage.admitDataQuery(member)).resolves.toBe('ALLOWED');
    expect(usage.reportDataQuery(member, 'q-1')).toBe(false);
  });

  it('returns the contract decisions and fails closed otherwise', async () => {
    const platform = new Platform();
    platform.decisions = [
      'MEMBER_QUOTA_EXHAUSTED',
      'TENANT_QUOTA_EXHAUSTED',
      503,
      'SOMETHING',
      'QUOTA_NOT_CONFIGURED',
      404,
      'ALLOWED',
    ];
    const usage = new KailoUsage(config, { fetch: platform.fetch as any });
    for (const want of [
      'MEMBER_QUOTA_EXHAUSTED',
      'TENANT_QUOTA_EXHAUSTED',
      'DEPENDENCY_UNAVAILABLE',
      'DEPENDENCY_UNAVAILABLE',
      'QUOTA_NOT_CONFIGURED',
      'QUOTA_NOT_CONFIGURED',
      'ALLOWED',
    ])
      await expect(usage.admitDataQuery(member)).resolves.toBe(want);
    expect(platform.admissions[0]).toEqual({
      meterKey: 'data_query_count',
      member,
    });
    // ALLOWED is cached for the member: no further admission call.
    await expect(usage.admitDataQuery(member)).resolves.toBe('ALLOWED');
    expect(platform.admissions).toHaveLength(7);
    // Without a verified identity nobody is metered: refused.
    await expect(usage.admitDataQuery(null)).resolves.toBe(
      'DEPENDENCY_UNAVAILABLE',
    );
  });

  it('a refused question raises the Kailo wording and reports nothing', async () => {
    const platform = new Platform();
    platform.decisions = ['TENANT_QUOTA_EXHAUSTED'];
    const usage = new KailoUsage(config, { fetch: platform.fetch as any });
    const ctx = { kailoUsage: usage, kailoUser: profile() };
    await expect(admitKailoDataQuery(ctx)).rejects.toThrow(
      '组织本月的问数额度已用完，请联系管理员。',
    );
    await admitKailoDataQuery(ctx).catch((error) => {
      expect(error).toBeInstanceOf(GraphQLError);
      expect(error.extensions.code).toBe('KAILO_USAGE_REFUSED');
    });
    expect(platform.posts).toHaveLength(0);
    expect(usageRefusalText('MEMBER_QUOTA_EXHAUSTED', 'en-US')).toBe(
      'Your data query quota for this month is used up.',
    );
    expect(usageRefusalText('QUOTA_NOT_CONFIGURED', 'zh-CN')).toBe(
      '本组织的用量额度尚未在 Kailo 中完成登记，暂不能提问，请联系管理员。',
    );
  });
});

describe('KailoUsage reports', () => {
  it('reports one query per native query ID with the same body on retry', async () => {
    const platform = new Platform();
    platform.reports = ['network', 503, 201];
    const usage = new KailoUsage(config, {
      fetch: platform.fetch as any,
      retryDelaysMs: [0, 0, 0],
    });
    const at = new Date('2026-10-30T08:00:00.250Z');
    expect(usage.reportDataQuery(member, 'query-1', at)).toBe(true);
    await usage.whenIdle();
    expect(platform.posts).toHaveLength(3);
    expect(new Set(platform.posts).size).toBe(1);
    expect(JSON.parse(platform.posts[0])).toEqual({
      idempotencyKey: dataQueryKey('query-1'),
      meterKey: 'data_query_count',
      quantity: 1,
      occurredAt: '2026-10-30T08:00:00Z',
      member,
    });
    expect(dataQueryKey('query-1')).toMatch(/^data-query\.ask\.[0-9a-f]{40}$/);
  });

  it('a refusal is final; the resolver hook skips missing identities and IDs', async () => {
    const platform = new Platform();
    platform.reports = [409];
    const usage = new KailoUsage(config, {
      fetch: platform.fetch as any,
      retryDelaysMs: [0, 0],
    });
    reportKailoDataQuery({ kailoUsage: usage, kailoUser: profile() }, 'q-2');
    await usage.whenIdle();
    expect(platform.posts).toHaveLength(1);
    reportKailoDataQuery({ kailoUsage: usage, kailoUser: null }, 'q-3');
    reportKailoDataQuery(
      { kailoUsage: usage, kailoUser: profile() },
      undefined,
    );
    await usage.whenIdle();
    expect(platform.posts).toHaveLength(1);
  });
});
