import knex, { Knex } from 'knex';
import { LearningRepository } from './apollo/server/repositories/learningRepository';

describe('original learning repository SQLite transaction consumer', () => {
  let db: Knex;
  let repository: LearningRepository;
  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('project', (table) => table.increments('id'));
    await db.schema.createTable('learning', (table) => {
      table.increments('id');
      table.string('user_id').notNullable();
      table.text('paths').notNullable();
    });
    await db('project').insert({ id: 3 });
    repository = new LearningRepository(db);
  });
  afterEach(async () => {
    await db?.destroy();
  });
  test('two real user rows stay separate and retrying a path is idempotent', async () => {
    await repository.saveNativePath(3, 'person-a', 'intro', async () => {});
    await repository.saveNativePath(3, 'person-b', 'sql', async () => {});
    await repository.saveNativePath(3, 'person-a', 'intro', async () => {});
    await repository.saveNativePath(3, 'person-a', 'sql', async () => {});
    expect(
      (await repository.findAllBy({ userId: 'person-a' })).map(
        (row) => row.paths,
      ),
    ).toEqual([['intro', 'sql']]);
    expect(
      (await repository.findAllBy({ userId: 'person-b' })).map(
        (row) => row.paths,
      ),
    ).toEqual([['sql']]);
  });
  test('the actual transaction rolls back if the final permission callback refuses', async () => {
    await expect(
      repository.saveNativePath(3, 'person-a', 'intro', async () => {
        throw new Error('revoked');
      }),
    ).rejects.toThrow('revoked');
    expect(await repository.findAll()).toEqual([]);
  });
  test('a nonexistent original project cannot acquire a learning row', async () => {
    const check = jest.fn(async () => {});
    await expect(
      repository.saveNativePath(9, 'person-a', 'intro', check),
    ).rejects.toThrow('Project not found');
    expect(check).not.toHaveBeenCalled();
    expect(await repository.findAll()).toEqual([]);
  });
});
