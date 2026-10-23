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
}

export interface IKailoUserRepository extends IBasicRepository<KailoUser> {
  upsertProfile(user: KailoUser): Promise<void>;
  findByKeys(keys: string[]): Promise<KailoUser[]>;
}

export class KailoUserRepository
  extends BaseRepository<KailoUser>
  implements IKailoUserRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'kailo_user' });
  }

  public async upsertProfile(user: KailoUser): Promise<void> {
    const row = this.transformToDBData(user);
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
}
