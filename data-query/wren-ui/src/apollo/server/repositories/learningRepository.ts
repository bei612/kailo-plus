import { Knex } from 'knex';
import { BaseRepository, IBasicRepository } from './baseRepository';
import {
  camelCase,
  isPlainObject,
  mapKeys,
  mapValues,
  snakeCase,
} from 'lodash';

export interface Learning {
  id: number; // ID
  userId: string; // Original standalone UUID or verified native identity partition.
  paths: string[]; // The learning paths, array of learning stories
}

export interface ILearningRepository extends IBasicRepository<Learning> {
  saveNativePath(
    projectId: number,
    userId: string,
    path: string,
    beforeWrite: () => Promise<void>,
  ): Promise<Learning>;
}

export class LearningRepository
  extends BaseRepository<Learning>
  implements ILearningRepository
{
  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'learning' });
  }

  public async saveNativePath(
    projectId: number,
    userId: string,
    path: string,
    beforeWrite: () => Promise<void>,
  ): Promise<Learning> {
    return this.knex.transaction(async (tx) => {
      // Serialize the first insert as well as updates using the existing
      // project row. No new account or permission registry is introduced.
      const project = await tx('project')
        .where({ id: projectId })
        .forUpdate()
        .first();
      if (!project) throw new Error('Project not found');
      const records = await this.findAllBy({ userId }, { tx });
      const paths = [
        ...new Set([...records.flatMap((record) => record.paths), path]),
      ];
      await beforeWrite();
      return records.length
        ? this.updateOne(records[0].id, { userId, paths }, { tx })
        : this.createOne({ userId, paths }, { tx });
    });
  }

  protected override transformToDBData = (data: any) => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const transformedData = mapValues(data, (value, key) => {
      if (['paths'].includes(key)) {
        return value ? JSON.stringify(value) : null;
      }
      return value;
    });
    return mapKeys(transformedData, (_value, key) => snakeCase(key));
  };

  protected override transformFromDBData = (data: any): Learning => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const formattedData = mapValues(camelCaseData, (value, key) => {
      if (['paths'].includes(key)) {
        // The value from Sqlite will be string type, while the value from PG is JSON object
        if (typeof value === 'string') {
          return value ? JSON.parse(value) : value;
        } else {
          return value;
        }
      }
      return value;
    }) as Learning;
    return formattedData;
  };
}
