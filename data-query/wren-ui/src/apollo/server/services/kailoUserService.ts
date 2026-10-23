import {
  decodeKailoUser,
  KailoUserProfile,
  KAILO_SERVICE_HEADER,
  KAILO_USER_HEADER,
} from '@/utils/kailoUser';
import {
  IKailoUserRepository,
  KailoUser,
} from '../repositories/kailoUserRepository';
import { isGovernedQueryMode } from './nativeQueryMode';
import type { KailoMemberDirectoryStore } from './kailoMemberDirectory';
import { create, GeneralErrorCodes } from '../utils/error';

// DD-133 §3/(4) role mapping of this dedicated instance (`07` §4.7.4):
//   Kailo Tenant admin  -> Wren admin  (modeling, connection, project settings,
//                                       knowledge and dashboard changes)
//   Kailo Tenant member -> Wren member (asking, own threads, reading)
// Roles come only from Core. GOVERNED: the binding permission (`manage` =
// admin, `discover` = member) checked by the existing resolver wrappers.
// STANDALONE: the platform member directory's Tenant role once delivered
// (the middleware sets `admin` from the applied snapshot, kailoMemberDirectory);
// until then every user is a member (`admin` is false) and no admin is
// granted inside the component, never from IdP groups, e-mail or names.
// With the directory delivered, a person absent from it is refused at the
// entry in both modes.

type RequestHeaders = { [name: string]: string | string[] | undefined };

export function requestKailoUser(
  headers: RequestHeaders,
): KailoUserProfile | null {
  return decodeKailoUser(headers[KAILO_USER_HEADER]);
}

export function requestIsNativeService(headers: RequestHeaders): boolean {
  return headers[KAILO_SERVICE_HEADER] === '1';
}

export interface KailoUserLoader {
  load(key: string | null | undefined): Promise<KailoUser | null>;
}

export class KailoUserDirectory {
  private readonly seen = new Map<string, string>();

  constructor(
    private readonly repository: IKailoUserRepository,
    private readonly members: Pick<
      KailoMemberDirectoryStore,
      'profile'
    > | null = null,
  ) {}

  // Refresh the stored display claims whenever a login presents new values.
  // Once the member directory is applied, a member's name and picture are the
  // Kailo display name and avatar it states (DD-133(4)); the token still
  // supplies login name, verified e-mail and locale.
  public async remember(profile: KailoUserProfile | null): Promise<void> {
    if (!profile) return;
    const listed = this.members
      ? await this.members.profile(profile.key)
      : null;
    const user: KailoUser = {
      userKey: profile.key,
      name: listed ? listed.name : profile.name,
      username: profile.username,
      email: profile.email,
      picture: listed ? listed.picture : profile.picture,
      locale: profile.locale,
    };
    const fingerprint = JSON.stringify(user);
    if (this.seen.get(profile.key) === fingerprint) return;
    await this.repository.upsertProfile(user);
    this.seen.set(profile.key, fingerprint);
  }

  // Per-request batching: one query for all owners shown in a response.
  public loader(): KailoUserLoader {
    const pending = new Map<string, Promise<KailoUser | null>>();
    let batch: string[] = [];
    let flush: Promise<Map<string, KailoUser>> | null = null;
    const run = () => {
      if (!flush)
        flush = new Promise((resolve, reject) =>
          setImmediate(() => {
            const keys = batch;
            batch = [];
            flush = null;
            this.repository
              .findByKeys(keys)
              .then((users) =>
                resolve(new Map(users.map((user) => [user.userKey, user]))),
              )
              .catch(reject);
          }),
        );
      return flush;
    };
    return {
      load: (key) => {
        if (!key || !/^[a-f0-9]{64}$/.test(key)) return Promise.resolve(null);
        if (!pending.has(key)) {
          batch.push(key);
          pending.set(
            key,
            run().then((users) => users.get(key) || null),
          );
        }
        return pending.get(key);
      },
    };
  }
}

export async function isKailoAdmin(
  user: KailoUserProfile | null,
  token: string | undefined,
): Promise<boolean> {
  if (!isGovernedQueryMode()) return user?.admin === true;
  // Loaded on use, as in apiUtils: the GOVERNED consumers import this module's
  // callers and must not form an import cycle.
  const { loadQueryDelivery, NativeQueryRefusal } = await import(
    './nativeQueryAdmission'
  );
  const { authorizeNativeScope } = await import('./nativeHumanQuery');
  try {
    await authorizeNativeScope(await loadQueryDelivery(), token, 'manage');
    return true;
  } catch (error) {
    if (
      error instanceof NativeQueryRefusal &&
      [401, 403].includes(error.status)
    )
      return false;
    throw error;
  }
}

export const kailoAdminRequired = () =>
  create(GeneralErrorCodes.KAILO_ADMIN_REQUIRED);

// STANDALONE enforcement; GOVERNED keeps the Core `manage` wrapper. A verified
// native service token (the instance's own AI service) is not a member.
export function assertStandaloneAdmin(
  user: KailoUserProfile | null,
  nativeService = false,
): void {
  if (isGovernedQueryMode() || nativeService) return;
  if (user?.admin !== true) throw kailoAdminRequired();
}

// STANDALONE: the creator of a thread or an admin may rename/delete/edit it.
export function assertStandaloneOwnerOrAdmin(
  user: KailoUserProfile | null,
  ownerKey: string | null | undefined,
): void {
  if (isGovernedQueryMode()) return;
  if (user?.admin === true) return;
  if (!user || !ownerKey || ownerKey !== user.key) throw kailoAdminRequired();
}
