// Attribute the original native task; no platform task authority is created.
exports.up = async function (knex) {
  const unresolved = await knex('asking_task as task')
    .leftJoin('thread as owner', 'owner.id', 'task.thread_id')
    .leftJoin(
      'thread_response as response',
      'response.id',
      'task.thread_response_id',
    )
    .leftJoin(
      'thread as response_owner',
      'response_owner.id',
      'response.thread_id',
    )
    .where((builder) =>
      builder
        .where((missing) =>
          missing
            .whereNull('owner.project_id')
            .whereNull('response_owner.project_id'),
        )
        .orWhere((missing) =>
          missing.whereNotNull('task.thread_id').whereNull('owner.project_id'),
        )
        .orWhere((missing) =>
          missing
            .whereNotNull('task.thread_response_id')
            .whereNull('response_owner.project_id'),
        )
        .orWhere((mismatch) =>
          mismatch
            .whereNotNull('task.thread_id')
            .whereNotNull('task.thread_response_id')
            .whereColumn('task.thread_id', '<>', 'response.thread_id'),
        ),
    )
    .first('task.id');
  if (unresolved) {
    throw new Error(
      `Cannot prove asking_task project ownership for ID: ${unresolved.id}. Stop migration; reconcile native thread references from evidence, never assign the first project or delete task evidence.`,
    );
  }
  await knex.schema.alterTable('asking_task', (table) => {
    table
      .integer('project_id')
      .references('id')
      .inTable('project')
      .onDelete('CASCADE')
      .index();
  });
  await knex('asking_task').update({
    project_id: knex('asking_task as source')
      .leftJoin('thread as owner', 'owner.id', 'source.thread_id')
      .leftJoin(
        'thread_response as response',
        'response.id',
        'source.thread_response_id',
      )
      .leftJoin(
        'thread as response_owner',
        'response_owner.id',
        'response.thread_id',
      )
      .whereColumn('source.id', 'asking_task.id')
      .select(
        knex.raw('COALESCE(??, ??)', [
          'owner.project_id',
          'response_owner.project_id',
        ]),
      ),
  });
  await knex.schema.alterTable('asking_task', (table) => {
    table.integer('project_id').notNullable().alter();
  });
};

exports.down = async function (knex) {
  if (await knex('asking_task').first()) {
    throw new Error(
      'Native task ownership evidence must be retained; stop rollback while asking_task contains records',
    );
  }
  await knex.schema.alterTable('asking_task', (table) => {
    table.dropColumn('project_id');
  });
};
