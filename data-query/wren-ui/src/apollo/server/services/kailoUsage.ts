import { createHash } from 'crypto';
import { GraphQLError } from 'graphql';
import { getLogger } from '@server/utils';
import type { KailoUserProfile } from '@/utils/kailoUser';
import {
  KailoDirectoryConfig,
  kailoServiceToken,
} from './kailoMemberDirectory';
import type { KailoIdentityRef } from './kailoNotifications';

// DD-165, `.design/07` §4.8.9: in Kailo mode a data query (one question asked
// in Data Q&A) is a Kailo quota item. Before a member's question starts an
// asking task the instance asks Core for admission; once the native asking
// task exists it reports one `data_query_count` usage keyed by the native
// query ID. Both calls use the member-directory client of `07` §4.7.4 (same
// client-credentials token as the directory read and the notifications), so
// they exist exactly when the directory configuration is complete.
//
//   POST {KAILO_DIRECTORY_CORE_URL}/service/v1/component-usage/bindings/{binding}/admission
//   POST {KAILO_DIRECTORY_CORE_URL}/service/v1/component-usage/bindings/{binding}/reports
//
// Admission is CHECK and fails closed: an exhausted Tenant quota, a reached
// per-member limit, an unavailable Core or a request without a verified
// identity all refuse the question before any native work. ALLOWED is cached
// for at most a minute per member. Reports never block the request: a bounded
// in-memory queue, the same key on every retry (429/5xx/no response), no
// retry on 400/403/409; a report lost with the process only under-counts —
// Core de-duplicates by binding + key, so nothing is ever counted twice. Logs
// carry the binding, meter and HTTP status only.

const logger = getLogger('KailoUsage');
logger.level = 'info';

export const DATA_QUERY_METER = 'data_query_count';

export type KailoUsageDecision =
  | 'ALLOWED'
  | 'TENANT_QUOTA_EXHAUSTED'
  | 'MEMBER_QUOTA_EXHAUSTED'
  // Core has not aligned this quota item yet (DD-165(5)), or an older Core
  // has no component usage contract at all (404).
  | 'QUOTA_NOT_CONFIGURED'
  | 'DEPENDENCY_UNAVAILABLE';

const DECISIONS: readonly string[] = [
  'ALLOWED',
  'TENANT_QUOTA_EXHAUSTED',
  'MEMBER_QUOTA_EXHAUSTED',
  'QUOTA_NOT_CONFIGURED',
];

// contracts/api/component_usage_report.schema.json
export interface KailoUsageReport {
  idempotencyKey: string;
  meterKey: string;
  quantity: number;
  occurredAt: string;
  member?: KailoIdentityRef;
}

type Fetch = typeof fetch;

export interface KailoUsageOptions {
  fetch?: Fetch;
  capacity?: number;
  retryDelaysMs?: number[];
  requestTimeoutMs?: number;
  allowedTtlMs?: number;
  now?: () => number;
}

const DEFAULT_RETRY_DELAYS_MS = [10_000, 30_000, 90_000, 170_000, 300_000];
const DEFAULT_CAPACITY = 2000;
const TOKEN_EARLY_REFRESH_MS = 30_000;

// Deterministic per native query: a replay of the same asking task is a
// duplicate for Core, never a second query.
export function dataQueryKey(queryId: string): string {
  const digest = createHash('sha256')
    .update(String(queryId))
    .digest('hex')
    .slice(0, 40);
  return `data-query.ask.${digest}`;
}

const identityValid = (value: KailoIdentityRef | null | undefined) =>
  !!value &&
  typeof value.issuer === 'string' &&
  !!value.issuer &&
  typeof value.subject === 'string' &&
  !!value.subject;

// The Kailo wording in place of a refused question (07 §4.8.9).
export function usageRefusalText(
  decision: KailoUsageDecision,
  locale: string | null | undefined,
): string {
  const english = (locale || '').toLowerCase().startsWith('en');
  switch (decision) {
    case 'TENANT_QUOTA_EXHAUSTED':
      return english
        ? "Your organization's Data Modeling quota for this month is used up. Contact an admin."
        : '组织本月的数据建模额度已用完，请联系管理员。';
    case 'MEMBER_QUOTA_EXHAUSTED':
      return english
        ? 'Your Data Modeling quota for this month is used up.'
        : '你本月的数据建模额度已用完。';
    case 'QUOTA_NOT_CONFIGURED':
      return english
        ? "Your organization's usage quota is not yet set up in Kailo, so questions cannot be asked yet. Contact an admin."
        : '本组织的用量额度尚未在 Kailo 中完成登记，暂不能提问，请联系管理员。';
    default:
      return english
        ? 'The usage service is unavailable right now. Please try again later.'
        : '用量服务暂不可用，请稍后再试。';
  }
}

interface Entry {
  body: string;
  attempt: number;
  dueAt: number;
}

export class KailoUsage {
  private readonly doFetch: Fetch;
  private readonly capacity: number;
  private readonly retryDelaysMs: number[];
  private readonly requestTimeoutMs: number;
  private readonly allowedTtlMs: number;
  private readonly now: () => number;
  private readonly allowed = new Map<string, number>();
  private queue: Entry[] = [];
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private token: { value: string; expiresAt: number } | null = null;
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly config: KailoDirectoryConfig | null,
    options: KailoUsageOptions = {},
  ) {
    this.doFetch = options.fetch ?? fetch;
    this.capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY);
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.allowedTtlMs = options.allowedTtlMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  public get enabled(): boolean {
    return this.config !== null;
  }

  // Never throws: anything but a contract answer is DEPENDENCY_UNAVAILABLE.
  public async admitDataQuery(
    member: KailoIdentityRef | null | undefined,
  ): Promise<KailoUsageDecision> {
    if (!this.config) return 'ALLOWED';
    if (!identityValid(member)) return 'DEPENDENCY_UNAVAILABLE';
    const cacheKey = JSON.stringify([member.issuer, member.subject]);
    const until = this.allowed.get(cacheKey);
    if (until !== undefined && this.now() < until) return 'ALLOWED';
    const body = JSON.stringify({
      meterKey: DATA_QUERY_METER,
      member: { issuer: member.issuer, subject: member.subject },
    });
    let decision: KailoUsageDecision = 'DEPENDENCY_UNAVAILABLE';
    try {
      const { status, text } = await this.call('admission', body);
      if (status === 200) {
        const parsed = JSON.parse(text);
        if (DECISIONS.includes(parsed?.decision)) decision = parsed.decision;
      } else if (status === 404) {
        decision = 'QUOTA_NOT_CONFIGURED';
      }
    } catch {
      decision = 'DEPENDENCY_UNAVAILABLE';
    }
    if (decision === 'ALLOWED')
      this.allowed.set(cacheKey, this.now() + this.allowedTtlMs);
    logger.info(
      `usage admission (binding ${this.config.bindingId}, ${DATA_QUERY_METER}, ${decision})`,
    );
    return decision;
  }

  // Queues one data query of the member; returns whether it was queued.
  public reportDataQuery(
    member: KailoIdentityRef | null | undefined,
    queryId: string,
    occurredAt: Date = new Date(this.now()),
  ): boolean {
    if (!this.config || !identityValid(member) || !queryId) return false;
    const report: KailoUsageReport = {
      idempotencyKey: dataQueryKey(queryId),
      meterKey: DATA_QUERY_METER,
      quantity: 1,
      occurredAt: new Date(Math.floor(occurredAt.getTime() / 1000) * 1000)
        .toISOString()
        .replace(/\.000Z$/, 'Z'),
      member: { issuer: member.issuer, subject: member.subject },
    };
    if (this.queue.length >= this.capacity) {
      this.queue.shift();
      logger.warn(
        `usage queue full (binding ${this.config.bindingId}); dropped the oldest report`,
      );
    }
    this.queue.push({
      body: JSON.stringify(report),
      attempt: 0,
      dueAt: this.now(),
    });
    this.wake();
    return true;
  }

  public get pending(): number {
    return this.queue.length;
  }

  // Resolves once nothing is queued or in flight (tests, shutdown).
  public whenIdle(): Promise<void> {
    if (!this.running && !this.queue.length) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private wake() {
    if (this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.queue.length) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      waiters.forEach((resolve) => resolve());
      return;
    }
    const next = Math.min(...this.queue.map((entry) => entry.dueAt));
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.run();
      },
      Math.max(0, next - this.now()),
    );
    this.timer.unref?.();
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const now = this.now();
        const index = this.queue.findIndex((entry) => entry.dueAt <= now);
        if (index < 0) break;
        const [entry] = this.queue.splice(index, 1);
        if ((await this.deliver(entry)) === 'RETRY') {
          entry.dueAt = this.now() + this.retryDelaysMs[entry.attempt];
          entry.attempt += 1;
          this.queue.push(entry);
        }
      }
    } finally {
      this.running = false;
      this.wake();
    }
  }

  private async accessToken(): Promise<{ value: string; fresh: boolean }> {
    if (this.token && this.now() < this.token.expiresAt)
      return { value: this.token.value, fresh: false };
    this.token = null;
    const granted = await kailoServiceToken(this.config, this.doFetch);
    const lifetime = (granted.expiresIn ?? 60) * 1000 - TOKEN_EARLY_REFRESH_MS;
    if (lifetime > 0)
      this.token = {
        value: granted.accessToken,
        expiresAt: this.now() + lifetime,
      };
    return { value: granted.accessToken, fresh: true };
  }

  private async post(
    path: 'admission' | 'reports',
    body: string,
    token: string,
  ): Promise<{ status: number; text: string }> {
    const url = new URL(
      `/service/v1/component-usage/bindings/${this.config.bindingId}/${path}`,
      this.config.coreUrl,
    );
    const response = await this.doFetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    const text = path === 'admission' ? await response.text() : '';
    if (path !== 'admission')
      await response.body?.cancel().catch(() => undefined);
    return { status: response.status, text };
  }

  // A cached token refused with 401/403 is replaced once.
  private async call(
    path: 'admission' | 'reports',
    body: string,
  ): Promise<{ status: number; text: string }> {
    const token = await this.accessToken();
    let answer = await this.post(path, body, token.value);
    if ((answer.status === 401 || answer.status === 403) && !token.fresh) {
      this.token = null;
      answer = await this.post(path, body, (await this.accessToken()).value);
    }
    return answer;
  }

  private async deliver(entry: Entry): Promise<'DONE' | 'RETRY'> {
    let status: number | null = null;
    try {
      status = (await this.call('reports', entry.body)).status;
    } catch {
      status = null;
    }
    const label = `binding ${this.config.bindingId}, ${DATA_QUERY_METER}, ${status === null ? 'no response' : `HTTP ${status}`}`;
    if (status === 200 || status === 201) {
      logger.debug(`usage reported (${label})`);
      return 'DONE';
    }
    if (status === null || status === 429 || status >= 500) {
      if (entry.attempt < this.retryDelaysMs.length) {
        logger.info(`usage report deferred (${label})`);
        return 'RETRY';
      }
      logger.warn(`usage report abandoned (${label})`);
      return 'DONE';
    }
    if (status === 404) {
      logger.warn(
        `usage report not accepted (${label}): Kailo Core has no component usage contract yet (deploy Core with DD-165 first)`,
      );
      return 'DONE';
    }
    logger.warn(`usage report refused (${label})`);
    return 'DONE';
  }
}

// ---- resolver hooks ------------------------------------------------------------

export interface KailoUsageContext {
  kailoUsage?: KailoUsage;
  kailoUser?: KailoUserProfile | null;
}

const memberOf = (user: KailoUserProfile | null | undefined) =>
  user?.issuer && user?.subject
    ? { issuer: user.issuer, subject: user.subject }
    : null;

// Before an asking task is created: a refused question raises the Kailo
// wording and creates nothing.
export async function admitKailoDataQuery(
  ctx: KailoUsageContext,
): Promise<void> {
  if (!ctx.kailoUsage?.enabled) return;
  const decision = await ctx.kailoUsage.admitDataQuery(memberOf(ctx.kailoUser));
  if (decision === 'ALLOWED') return;
  throw new GraphQLError(usageRefusalText(decision, ctx.kailoUser?.locale), {
    extensions: { code: 'KAILO_USAGE_REFUSED', decision },
  });
}

// After the native asking task exists: one data query of the member.
export function reportKailoDataQuery(
  ctx: KailoUsageContext,
  queryId: string | undefined,
): void {
  if (!ctx.kailoUsage?.enabled || !queryId) return;
  ctx.kailoUsage.reportDataQuery(memberOf(ctx.kailoUser), queryId);
}
