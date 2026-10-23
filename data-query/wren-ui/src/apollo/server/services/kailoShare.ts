import { KailoUserProfile, kailoUserLabel } from '@/utils/kailoUser';
import { create, GeneralErrorCodes } from '../utils/error';
import type { IKailoUserRepository } from '../repositories/kailoUserRepository';
import type { KailoMemberDirectoryStore } from './kailoMemberDirectory';
import type { KailoNotifications } from './kailoNotifications';

// DD-138(4), `.design/07` §4.8.3: "分享给成员 / Share with member". A Kailo
// user picks members of the applied Core member directory and each gets a
// SHARED notification in the Kailo inbox that opens the thread or the team
// dashboard in this component page.
//
// No ACL changes: this instance serves one Tenant with one project, and every
// project member can already read all threads and the single dashboard
// (`07` §4.7.4 Wren table; GOVERNED instances keep the per-request Core
// `discover` check). Sharing therefore only notifies; what the recipient can
// open is still decided by the component's own access rules.

export interface KailoShareTarget {
  threadId?: number | null;
  dashboard?: boolean | null;
}

export interface KailoShareCandidate {
  userKey: string;
  name: string | null;
  picture: string | null;
}

export interface KailoShareLookups {
  // Name of the thread in the current project, null when it does not exist.
  threadName(threadId: number): Promise<string | null>;
  dashboardExists(): Promise<boolean>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const USER_KEY = /^[a-f0-9]{64}$/;
export const KAILO_SHARE_MAX_RECIPIENTS = 50;

const invalid = () => create(GeneralErrorCodes.KAILO_SHARE_INVALID);
const unavailable = () => create(GeneralErrorCodes.KAILO_SHARE_UNAVAILABLE);

export class KailoShareService {
  constructor(
    private readonly notifications: Pick<
      KailoNotifications,
      'enabled' | 'shareThread' | 'shareDashboard'
    >,
    private readonly members: Pick<KailoMemberDirectoryStore, 'list'> | null,
    private readonly users: Pick<IKailoUserRepository, 'findIdentities'>,
  ) {}

  // Delivery is configured and the request carries a Kailo user. The
  // directory may still be undelivered; candidates are then empty.
  public available(user: KailoUserProfile | null | undefined): boolean {
    return this.notifications.enabled && !!this.members && !!user?.key;
  }

  // Current directory members other than the caller that can be addressed
  // (issuer+subject known), by display name.
  public async candidates(
    user: KailoUserProfile | null | undefined,
  ): Promise<KailoShareCandidate[]> {
    if (!this.available(user)) return [];
    const listed = (await this.members.list()) || [];
    const others = listed.filter((member) => member.userKey !== user.key);
    const addressable = await this.users.findIdentities(
      others.map((member) => member.userKey),
    );
    return (
      others
        .filter((member) => addressable.has(member.userKey))
        .map(({ userKey, name, picture }) => ({ userKey, name, picture }))
        // Members without a display name last.
        .sort((a, b) => (a.name || '\uffff').localeCompare(b.name || '\uffff'))
    );
  }

  // Validates everything before queuing anything; returns the number of
  // notifications queued. Delivery itself runs in the background.
  public async share(
    user: KailoUserProfile | null | undefined,
    input: {
      target: KailoShareTarget;
      recipients: string[];
      requestId: string;
    },
    lookups: KailoShareLookups,
  ): Promise<number> {
    if (!this.available(user)) throw unavailable();
    const listed = await this.members.list();
    if (!listed) throw unavailable();
    const { target, recipients, requestId } = input;
    const threadId = target?.threadId ?? null;
    const dashboard = target?.dashboard === true;
    if (
      typeof requestId !== 'string' ||
      !UUID.test(requestId) ||
      (threadId === null) === !dashboard ||
      (threadId !== null && (!Number.isSafeInteger(threadId) || threadId <= 0))
    )
      throw invalid();
    const current = new Set(listed.map((member) => member.userKey));
    if (
      !Array.isArray(recipients) ||
      recipients.length < 1 ||
      recipients.length > KAILO_SHARE_MAX_RECIPIENTS ||
      new Set(recipients).size !== recipients.length ||
      recipients.some(
        (key) =>
          typeof key !== 'string' ||
          !USER_KEY.test(key) ||
          key === user.key ||
          !current.has(key),
      )
    )
      throw invalid();
    const actorName = kailoUserLabel(user);
    if (threadId !== null) {
      const threadName = await lookups.threadName(threadId);
      if (threadName === null) throw invalid();
      return this.notifications.shareThread({
        requestId,
        actorKey: user.key,
        actorName,
        recipientKeys: recipients,
        threadId,
        threadName,
      });
    }
    if (!(await lookups.dashboardExists())) throw invalid();
    return this.notifications.shareDashboard({
      requestId,
      actorKey: user.key,
      actorName,
      recipientKeys: recipients,
    });
  }
}
