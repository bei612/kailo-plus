// DD-12 / SS-WRN-GOVERNANCE: correlate the existing native recommendation
// task with its original response. Historical rows stay uncorrelated.
exports.up = async function (knex) {
  await knex.schema.alterTable('thread', (table) => {
    table.integer('questions_source_response_id').nullable();
  });
  await knex.schema.alterTable('thread_response', (table) => {
    table.string('recommendation_query_id').nullable();
    table.string('recommendation_intent_key').nullable();
    table.integer('recommendation_source_response_id').nullable();
    table.integer('recommendation_index').nullable();
    table.unique(
      ['thread_id', 'recommendation_intent_key'],
      'thread_response_recommendation_intent_unique',
    );
  });
};
exports.down = async function (knex) {
  // Downgrade must never discard the original UNKNOWN task/selection identity.
  // Stop release while any producer has written these facts; do not backfill,
  // delete native rows, or authorize an older writer to blindly repeat them.
  const task = await knex('thread').whereNotNull('questions_source_response_id').first('id');
  const selection = await knex('thread_response').where((query) => {
    query.whereNotNull('recommendation_intent_key')
      .orWhereNotNull('recommendation_query_id')
      .orWhereNotNull('recommendation_source_response_id')
      .orWhereNotNull('recommendation_index');
  }).first('id');
  if (task || selection) throw new Error('Refuse recommendation rollback while native source or selection facts exist');
  await knex.schema.alterTable('thread_response', (table) => {
    table.dropUnique(
      ['thread_id', 'recommendation_intent_key'],
      'thread_response_recommendation_intent_unique',
    );
    table.dropColumn('recommendation_intent_key');
    table.dropColumn('recommendation_index');
    table.dropColumn('recommendation_source_response_id');
    table.dropColumn('recommendation_query_id');
  });
  await knex.schema.alterTable('thread', (table) => {
    table.dropColumn('questions_source_response_id');
  });
};
