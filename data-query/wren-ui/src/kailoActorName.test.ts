import { randomUUID } from 'crypto';
import { KailoShareService } from './apollo/server/services/kailoShare';
import { DashboardResolver } from './apollo/server/resolvers/dashboardResolver';
import { kailoActorLabel, KailoUserProfile } from './utils/kailoUser';

jest.mock('./common', () => ({ components: {} }));

// Notification and share actors are named with the Kailo display name of the
// Core member directory, then the login name; never the token `name` claim.
describe('Kailo notification actor display name', () => {
  const actor: KailoUserProfile = {
    key: 'a'.repeat(64),
    name: '2 QA',
    username: 'kailo-qa-2',
    email: 'qa2@example.test',
    picture: null,
    locale: null,
    admin: false,
  };
  const ownerKey = 'b'.repeat(64);

  it('prefers the directory display name, then the login name, never the token name', () => {
    expect(kailoActorLabel(actor, 'Kailo QA Two')).toBe('Kailo QA Two');
    expect(kailoActorLabel(actor, null)).toBe('kailo-qa-2');
    expect(kailoActorLabel(actor, undefined)).toBe('kailo-qa-2');
    expect(kailoActorLabel({ ...actor, username: null }, null)).toBeNull();
  });

  it('a share names the actor with the directory display name, or the login name when unlisted', async () => {
    const notifications = {
      enabled: true,
      shareThread: jest.fn(async (input: any) => input.recipientKeys.length),
      shareDashboard: jest.fn(async (input: any) => input.recipientKeys.length),
    };
    let members = [
      { userKey: actor.key, admin: false, name: 'Kailo QA Two', picture: null },
      { userKey: ownerKey, admin: false, name: 'Owner', picture: null },
    ];
    const service = new KailoShareService(
      notifications as any,
      { list: async () => members },
      { findIdentities: async () => new Map() },
    );
    const lookups = {
      threadName: async () => 'Revenue',
      dashboardExists: async () => true,
    };
    await service.share(
      actor,
      {
        target: { threadId: 7 },
        recipients: [ownerKey],
        requestId: randomUUID(),
      },
      lookups,
    );
    expect(notifications.shareThread.mock.calls[0][0].actorName).toBe(
      'Kailo QA Two',
    );
    members = members.map((member) =>
      member.userKey === actor.key ? { ...member, name: null } : member,
    );
    await service.share(
      actor,
      {
        target: { dashboard: true },
        recipients: [ownerKey],
        requestId: randomUUID(),
      },
      lookups,
    );
    expect(notifications.shareDashboard.mock.calls[0][0].actorName).toBe(
      'kailo-qa-2',
    );
  });

  describe('dashboard item added', () => {
    const components = jest.requireMock('./common').components;
    const dashboardItemAdded = jest.fn(async () => 1);
    const profile = jest.fn();
    beforeEach(() => {
      dashboardItemAdded.mockClear();
      profile.mockReset();
      Object.assign(components, {
        kailoNotifications: { enabled: true, dashboardItemAdded },
        threadRepository: {
          findOneBy: async () => ({
            id: 2,
            projectId: 1,
            ownerKey,
            summary: 'Revenue',
          }),
        },
        kailoMemberDirectory: { profile },
      });
    });
    const notify = () =>
      (new DashboardResolver() as any).notifyItemAdded(
        { kailoUser: actor },
        1,
        2,
        9,
      );

    it('names the actor with the directory display name', async () => {
      profile.mockResolvedValue({ name: 'Kailo QA Two', picture: null });
      await notify();
      expect(profile).toHaveBeenCalledWith(actor.key);
      expect(dashboardItemAdded).toHaveBeenCalledWith(
        expect.objectContaining({
          actorKey: actor.key,
          actorName: 'Kailo QA Two',
          ownerKey,
        }),
      );
    });

    it('falls back to the login name when the directory is unlisted, unreadable or not configured', async () => {
      const arrangements: Array<() => void> = [
        () => profile.mockResolvedValue(null),
        () => profile.mockRejectedValue(new Error('down')),
        () => Object.assign(components, { kailoMemberDirectory: null }),
      ];
      for (const arrange of arrangements) {
        dashboardItemAdded.mockClear();
        arrange();
        await notify();
        expect(dashboardItemAdded).toHaveBeenCalledWith(
          expect.objectContaining({ actorName: 'kailo-qa-2' }),
        );
      }
    });
  });
});
