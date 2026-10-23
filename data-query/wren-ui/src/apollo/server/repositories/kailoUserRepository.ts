import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';

// DD-133 §3: display claims of a Kailo user, keyed by the issuer+subject
// digest. Written only from the verified middleware profile.
export interface KailoUser {
  userKey: string;
  name: string | null;
  username: string | null;
  email: string | null;
  picture: string | null;
  locale: string | null;
  // DD-138(4), `07` §4.8.3: verified OIDC issuer + subject behind userKey,
  // used only to address Kailo notifications. Undefined = leave as stored.
  issuer?: string | null;
  subject?: string | null;
}

export interface KailoUserIdentity {
  userKey: string;
  issuer: string;
  subject: string;
}

export interface IKailoUserRepository extends IBasicRepository<KailoUser> {
  upsertProfile(user: KailoUser): Promise<void>;
  findByKeys(keys: string[]): Promise<KailoUser[]>;
  findIdentities(keys: string[]): Promise<Map<string, KailoUserIdentity>>;
}

export class KailoUserRepository
  extends BaseRepository<KailoUser>
  implements IKailoUserRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'kailo_user' });
  }

  public async upsertProfile(user: KailoUser): Promise<void> {
    // The identity pair is written only as a whole and never cleared by a
    // profile that does not carry it (DD-138(4)).
    const { issuer, subject, ...profile } = user;
    const row = this.transformToDBData(
      issuer && subject ? { ...profile, issuer, subject } : profile,
    );
    await this.knex(this.tableName)
      .insert(row)
      .onConflict('user_key')
      .merge({ ...row, updated_at: this.knex.fn.now() });
  }

  public async findByKeys(keys: string[]): Promise<KailoUser[]> {
    const unique = [...new Set(keys.filter(Boolean))];
    if (!unique.length) return [];
    const rows = await this.knex(this.tableName).whereIn('user_key', unique);
    return rows.map((row) => this.transformFromDBData(row));
  }

  // DD-138(4): userKey -> issuer/subject for the keys that have both.
  public async findIdentities(
    keys: string[],
  ): Promise<Map<string, KailoUserIdentity>> {
    const unique = [...new Set(keys.filter(Boolean))];
    const identities = new Map<string, KailoUserIdentity>();
    for (let i = 0; i < unique.length; i += 500) {
      const rows = await this.knex(this.tableName)
        .whereIn('user_key', unique.slice(i, i + 500))
        .whereNotNull('issuer')
        .whereNotNull('subject')
        .select('user_key', 'issuer', 'subject');
      for (const row of rows)
        identities.set(row.user_key, {
          userKey: row.user_key,
          issuer: row.issuer,
          subject: row.subject,
        });
    }
    return identities;
  }
}
