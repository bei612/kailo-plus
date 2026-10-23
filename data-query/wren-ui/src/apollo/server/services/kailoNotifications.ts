import { createHash } from 'crypto';
import { getLogger } from '@server/utils';
import { componentPath } from '../../../../../../client-kit/adapter/protocol.mjs';
import {
  KailoDirectoryConfig,
  KailoMemberDirectoryStore,
  kailoServiceToken,
} from './kailoMemberDirectory';
import type { IKailoUserRepository } from '../repositories/kailoUserRepository';

// DD-138(4), `.design/07` §4.8.3: events that should reach a person are
// delivered to Kailo (Core `ComponentNotification`) and shown in the Kailo
// inbox; this instance keeps no bell, notification centre or e-mail of its own
// (upstream Wren has none, so nothing is removed here).
//
//   POST {KAILO_DIRECTORY_CORE_URL}/service/v1/component-notifications/
//        bindings/{KAILO_DIRECTORY_BINDING_ID}/notifications
//
// Authentication is the member-directory client of `07` §4.7.4 (same
// client-credentials token, `azp` = directoryClientId), so delivery exists
// exactly when the directory configuration is complete (all-or-none); without
// it every call is a no-op. Business requests never wait for or fail on
// delivery: events go to a bounded in-memory queue drained by one background
// worker. 201/200 = delivered (200 = duplicate); 400/401/403/409 are final;
// 429, 5xx and transport errors are retried with the same idempotency key
// (5 attempts over ~5 minutes). A full queue drops its oldest entry.
// Logs carry the binding, category and HTTP status only — never the title,
// summary, path, identities or the token. A failed delivery never falls back
// to an in-component reminder or e-mail.

const logger = getLogger('KailoNotifications');
logger.level = 'info';

export const KAILO_NOTIFICATION_CATEGORIES = [
  'SHARED',
  'MENTIONED',
  'COMMENTED',
  'ACCESS_REQUESTED',
  'TASK_COMPLETED',
  'CONTENT_UPDATED',
] as const;
export type KailoNotificationCategory =
  (typeof KAILO_NOTIFICATION_CATEGORIES)[number];

export interface KailoIdentityRef {
  issuer: string;
  subject: string;
}

export interface KailoLocalizedText {
  ZH_CN: string;
  EN: string;
}

// contracts/api/component_notification_delivery.schema.json
export interface KailoNotificationDelivery {
  idempotencyKey: string;
  recipient: KailoIdentityRef;
  actor?: KailoIdentityRef;
  category: KailoNotificationCategory;
  title: KailoLocalizedText;
  summary?: KailoLocalizedText;
  path: string;
  occurredAt?: string;
}

const TITLE_MAX = 120;
const SUMMARY_MAX = 280;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,128}$/;

// Control characters become spaces; the result is cut on code points.
export function notificationText(value: string, max: number): string {
  const clean = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(clean);
  return chars.length <= max ? clean : `${chars.slice(0, max - 1).join('')}…`;
}

function localized(
  value: KailoLocalizedText | undefined,
  max: number,
): KailoLocalizedText | null {
  if (!value) return null;
  const out = {
    ZH_CN: notificationText(value.ZH_CN, max),
    EN: notificationText(value.EN, max),
  };
  return out.ZH_CN && out.EN ? out : null;
}

// Deterministic per (event, recipient): a retry or a replay of the same event
// is a duplicate for Core, never a second inbox entry.
export function notificationKey(
  category: KailoNotificationCategory,
  event: string,
  recipient: KailoIdentityRef,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([event, recipient.issuer, recipient.subject]))
    .digest('hex')
    .slice(0, 40);
  return `data-query.${category.toLowerCase()}.${digest}`;
}

const identityValid = (value: KailoIdentityRef | undefined) =>
  !!value &&
  typeof value.issuer === 'string' &&
  !!value.issuer &&
  typeof value.subject === 'string' &&
  !!value.subject;

// The shape Core accepts (contract above); anything else is never queued.
export function validNotification(value: KailoNotificationDelivery): boolean {
  return (
    !!value &&
    IDEMPOTENCY_KEY.test(value.idempotencyKey) &&
    identityValid(value.recipient) &&
    (value.actor === undefined ||
      (identityValid(value.actor) &&
        !(
          value.actor.issuer === value.recipient.issuer &&
          value.actor.subject === value.recipient.subject
        ))) &&
    KAILO_NOTIFICATION_CATEGORIES.includes(value.category) &&
    !!localized(value.title, TITLE_MAX) &&
    localized(value.title, TITLE_MAX).ZH_CN === value.title.ZH_CN &&
    localized(value.title, TITLE_MAX).EN === value.title.EN &&
    (value.summary === undefined ||
      (localized(value.summary, SUMMARY_MAX)?.ZH_CN === value.summary.ZH_CN &&
        localized(value.summary, SUMMARY_MAX)?.EN === value.summary.EN)) &&
    componentPath(value.path) &&
    (value.occurredAt === undefined ||
      Number.isFinite(Date.parse(value.occurredAt)))
  );
}

// ---- delivery queue -----------------------------------------------------------

type Fetch = typeof fetch;

export interface KailoNotifierOptions {
  fetch?: Fetch;
  capacity?: number;
  // Delay before attempt 2, 3, ...; attempts = length + 1.
  retryDelaysMs?: number[];
  requestTimeoutMs?: number;
  now?: () => number;
}

// 5 attempts within ~5 minutes (10 s, 30 s, 90 s, 170 s).
const DEFAULT_RETRY_DELAYS_MS = [10_000, 30_000, 90_000, 170_000];
const DEFAULT_CAPACITY = 500;
const TOKEN_EARLY_REFRESH_MS = 30_000;

interface Entry {
  body: string;
  category: KailoNotificationCategory;
  attempt: number;
  dueAt: number;
}

export type KailoNotificationOutcome =
  | 'DELIVERED'
  | 'REJECTED'
  | 'RETRY'
  | 'GAVE_UP';

export class KailoNotifier {
  private readonly doFetch: Fetch;
  private readonly capacity: number;
  private readonly retryDelaysMs: number[];
  private readonly requestTimeoutMs: number;
  private readonly now: () => number;
  private queue: Entry[] = [];
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private token: { value: string; expiresAt: number } | null = null;
  private idleWaiters: (() => void)[] = [];
  private droppedCount = 0;

  constructor(
    private readonly config: KailoDirectoryConfig | null,
    options: KailoNotifierOptions = {},
  ) {
    this.doFetch = options.fetch ?? fetch;
    this.capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY);
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  // Only with the complete directory configuration (Kailo mode).
  public get enabled(): boolean {
    return this.config !== null;
  }

  public get pending(): number {
    return this.queue.length;
  }

  public get dropped(): number {
    return this.droppedCount;
  }

  // Never throws and never waits for the network.
  public enqueue(delivery: KailoNotificationDelivery): boolean {
    if (!this.config) return false;
    if (!validNotification(delivery)) {
      logger.warn(
        `notification not queued: invalid delivery (binding ${this.config.bindingId}, ${String(delivery?.category)})`,
      );
      return false;
    }
    this.push({
      body: JSON.stringify(delivery),
      category: delivery.category,
      attempt: 0,
      dueAt: this.now(),
    });
    return true;
  }

  // Resolves once nothing is queued or in flight (tests, shutdown).
  public whenIdle(): Promise<void> {
    if (!this.running && !this.queue.length) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private push(entry: Entry) {
    if (this.queue.length >= this.capacity) {
      this.queue.shift();
      this.droppedCount += 1;
      logger.warn(
        `notification queue full (binding ${this.config.bindingId}); dropped the oldest, ${this.droppedCount} dropped so far`,
      );
    }
    this.queue.push(entry);
    this.wake();
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
        const outcome = await this.attempt(entry);
        if (outcome === 'RETRY') {
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

  private async post(body: string, token: string): Promise<number> {
    const url = new URL(
      `/service/v1/component-notifications/bindings/${this.config.bindingId}/notifications`,
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
    // Only the status matters ({notificationId, duplicate} is not kept).
    await response.body?.cancel().catch(() => undefined);
    return response.status;
  }

  // One delivery attempt. A cached token refused with 401/403 is replaced
  // once; a freshly issued one being refused is final like any 403.
  private async attempt(entry: Entry): Promise<KailoNotificationOutcome> {
    let status: number | null = null;
    try {
      const token = await this.accessToken();
      status = await this.post(entry.body, token.value);
      if ((status === 401 || status === 403) && !token.fresh) {
        this.token = null;
        status = await this.post(entry.body, (await this.accessToken()).value);
      }
    } catch {
      status = null;
    }
    const label = `binding ${this.config.bindingId}, ${entry.category}, ${status === null ? 'no response' : `HTTP ${status}`}`;
    if (status === 200 || status === 201) {
      logger.debug(`notification delivered (${label})`);
      return 'DELIVERED';
    }
    if (status === null || status === 429 || status >= 500) {
      if (entry.attempt < this.retryDelaysMs.length) {
        logger.info(`notification delivery deferred (${label})`);
        return 'RETRY';
      }
      logger.warn(`notification delivery abandoned (${label})`);
      return 'GAVE_UP';
    }
    logger.warn(`notification refused (${label})`);
    return 'REJECTED';
  }
}

// ---- events -------------------------------------------------------------------

export interface KailoNotificationEvent {
  // Stable id of the business event; with the recipient it forms the key.
  event: string;
  category: KailoNotificationCategory;
  actorKey?: string | null;
  recipientKeys: string[];
  title: KailoLocalizedText;
  summary?: KailoLocalizedText;
  path: string;
}

const NAME_MAX = 40;
const OBJECT_MAX = 60;

const actorLabel = (name: string | null | undefined) => {
  const label = notificationText(name || '', NAME_MAX);
  return label
    ? { ZH_CN: label, EN: label }
    : { ZH_CN: '一位成员', EN: 'A member' };
};

// The native routes a Kailo user opens in the embedded page (`path` is
// relative to the native page origin, `07` §4.8.3).
export const kailoThreadPath = (threadId: number) => `/home/${threadId}`;
export const KAILO_DASHBOARD_PATH = '/home/dashboard';

// Category choice (`07` §4.8.3 semantics):
//   share a thread / the dashboard            -> SHARED          (分享给你)
//   someone adds your question to the board  -> CONTENT_UPDATED (你的对象有更新)
//   a scheduled refresh run ends with errors  -> TASK_COMPLETED  (任务完成)
export class KailoNotifications {
  constructor(
    private readonly notifier: KailoNotifier,
    private readonly users: Pick<IKailoUserRepository, 'findIdentities'>,
    private readonly members: Pick<KailoMemberDirectoryStore, 'list'> | null,
  ) {}

  public get enabled(): boolean {
    return this.notifier.enabled;
  }

  // Resolves identities and queues one delivery per recipient. Unknown
  // identities, people outside the applied directory and the actor
  // themselves are skipped. Never throws; returns the number queued.
  public async notify(event: KailoNotificationEvent): Promise<number> {
    if (!this.notifier.enabled) return 0;
    try {
      const listed = this.members ? await this.members.list() : null;
      const current = listed ? new Set(listed.map((m) => m.userKey)) : null;
      const recipients = [...new Set(event.recipientKeys)].filter(
        (key) =>
          /^[a-f0-9]{64}$/.test(key) &&
          key !== event.actorKey &&
          (!current || current.has(key)),
      );
      if (!recipients.length) return 0;
      const identities = await this.users.findIdentities(
        event.actorKey ? [...recipients, event.actorKey] : recipients,
      );
      const actor = event.actorKey ? identities.get(event.actorKey) : undefined;
      let queued = 0;
      for (const key of recipients) {
        const recipient = identities.get(key);
        if (!recipient) continue;
        const same =
          actor &&
          actor.issuer === recipient.issuer &&
          actor.subject === recipient.subject;
        if (same) continue;
        const delivery: KailoNotificationDelivery = {
          idempotencyKey: notificationKey(event.category, event.event, recipient),
          recipient: { issuer: recipient.issuer, subject: recipient.subject },
          ...(actor
            ? { actor: { issuer: actor.issuer, subject: actor.subject } }
            : {}),
          category: event.category,
          title: localized(event.title, TITLE_MAX),
          ...(localized(event.summary, SUMMARY_MAX)
            ? { summary: localized(event.summary, SUMMARY_MAX) }
            : {}),
          path: event.path,
        };
        if (this.notifier.enqueue(delivery)) queued += 1;
      }
      return queued;
    } catch (error) {
      logger.warn(
        `notification event not queued (${event.category}): ${error?.name || 'error'}`,
      );
      return 0;
    }
  }

  // Kailo Tenant admins of the applied directory (empty before delivery).
  public async adminKeys(): Promise<string[]> {
    const listed = this.members ? await this.members.list() : null;
    return (listed || []).filter((m) => m.admin).map((m) => m.userKey);
  }

  public shareThread(input: {
    requestId: string;
    actorKey: string;
    actorName: string | null;
    recipientKeys: string[];
    threadId: number;
    threadName: string;
  }): Promise<number> {
    const actor = actorLabel(input.actorName);
    const name = notificationText(input.threadName, OBJECT_MAX);
    return this.notify({
      event: `share.thread.${input.threadId}.${input.requestId}`,
      category: 'SHARED',
      actorKey: input.actorKey,
      recipientKeys: input.recipientKeys,
      title: name
        ? {
            ZH_CN: `${actor.ZH_CN} 与你分享了问数对话「${name}」`,
            EN: `${actor.EN} shared the Data Q&A thread “${name}” with you`,
          }
        : {
            ZH_CN: `${actor.ZH_CN} 与你分享了一个问数对话`,
            EN: `${actor.EN} shared a Data Q&A thread with you`,
          },
      path: kailoThreadPath(input.threadId),
    });
  }

  public shareDashboard(input: {
    requestId: string;
    actorKey: string;
    actorName: string | null;
    recipientKeys: string[];
  }): Promise<number> {
    const actor = actorLabel(input.actorName);
    return this.notify({
      event: `share.dashboard.${input.requestId}`,
      category: 'SHARED',
      actorKey: input.actorKey,
      recipientKeys: input.recipientKeys,
      title: {
        ZH_CN: `${actor.ZH_CN} 与你分享了团队看板`,
        EN: `${actor.EN} shared the team dashboard with you`,
      },
      path: KAILO_DASHBOARD_PATH,
    });
  }

  // (a) Someone else pinned a chart of your thread to the team dashboard.
  public dashboardItemAdded(input: {
    actorKey: string | null | undefined;
    actorName: string | null;
    ownerKey: string | null | undefined;
    itemId: number;
    threadName: string;
  }): Promise<number> {
    if (!input.ownerKey || !input.actorKey || input.ownerKey === input.actorKey)
      return Promise.resolve(0);
    const actor = actorLabel(input.actorName);
    const name = notificationText(input.threadName, OBJECT_MAX);
    return this.notify({
      event: `dashboard.item.${input.itemId}`,
      category: 'CONTENT_UPDATED',
      actorKey: input.actorKey,
      recipientKeys: [input.ownerKey],
      title: {
        ZH_CN: `你的问题已加入团队看板`,
        EN: `Your question was added to the team dashboard`,
      },
      summary: name
        ? {
            ZH_CN: `${actor.ZH_CN} 把「${name}」的图表加入了团队看板。`,
            EN: `${actor.EN} added the chart of “${name}” to the team dashboard.`,
          }
        : {
            ZH_CN: `${actor.ZH_CN} 把你的问题图表加入了团队看板。`,
            EN: `${actor.EN} added your question's chart to the team dashboard.`,
          },
      path: KAILO_DASHBOARD_PATH,
    });
  }

  // (b) A scheduled cache refresh run finished with failed items: one entry
  // per Kailo Tenant admin per run (the run hash makes it idempotent).
  public async dashboardRefreshFinished(run: {
    dashboardId: number;
    runId: string;
    total: number;
    failed: number;
  }): Promise<number> {
    if (!this.notifier.enabled || run.failed <= 0) return 0;
    return this.notify({
      event: `dashboard.refresh.${run.dashboardId}.${run.runId}`,
      category: 'TASK_COMPLETED',
      recipientKeys: await this.adminKeys().catch(() => []),
      title: {
        ZH_CN: `看板定时刷新已完成，${run.failed} 项失败`,
        EN: `Scheduled dashboard refresh finished with ${run.failed} failed ${run.failed === 1 ? 'item' : 'items'}`,
      },
      summary: {
        ZH_CN: `共 ${run.total} 项，其中 ${run.failed} 项未能刷新缓存，看板可能显示旧数据。`,
        EN: `${run.failed} of ${run.total} items could not refresh their cache; the dashboard may show older data.`,
      },
      path: KAILO_DASHBOARD_PATH,
    });
  }
}
