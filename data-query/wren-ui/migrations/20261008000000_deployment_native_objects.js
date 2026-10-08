// Historical model names cannot prove the native IDs used to build an old
// deployment. Retain such records as-is; their object reads fail closed until
// exact native evidence is available. Never backfill using current names.
exports.up = async function (knex) {
  await knex.schema.alterTable('deploy_log', (table) => {
    table.jsonb('native_object_refs').nullable();
  });
};

exports.down = async function (knex) {
  if (await knex('deploy_log').whereNotNull('native_object_refs').first()) {
    throw new Error('Native deployment object evidence must be retained');
  }
  await knex.schema.alterTable('deploy_log', (table) => {
    table.dropColumn('native_object_refs');
  });
};
