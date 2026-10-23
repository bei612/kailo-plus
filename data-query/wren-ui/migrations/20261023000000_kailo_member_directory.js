// DD-133(4), `.design/07` §4.7.4 (Wren table): the last Core member directory
// snapshot this STANDALONE or GOVERNED instance applied completely. It
// survives restarts, so a restart never falls back to the pre-directory
// behaviour (everyone a member, nobody an admin) or admits a removed person.
//   kailo_directory_state   one row (id = 1): binding and directoryVersion of
//                           the applied snapshot. No row = never delivered.
//   kailo_directory_member  one row per member identity (issuer+subject digest,
//                           the kailo_user key) with the Tenant role. Replaced
//                           as a whole with each new snapshot.
// Display data stays in kailo_user, whose rows are never removed with a member
// (history attribution only).
exports.up = async function (knex) {
  await knex.schema.createTable('kailo_directory_state', (table) => {
    table.integer('id').primary();
    table.string('binding_id', 36).notNullable();
    table.string('directory_version', 64).notNullable();
    table.timestamp('applied_at').notNullable();
  });
  await knex.schema.createTable('kailo_directory_member', (table) => {
    table.string('user_key', 64).primary();
    table.string('principal_id', 36).notNullable();
    table.boolean('admin').notNullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTable('kailo_directory_member');
  await knex.schema.dropTable('kailo_directory_state');
};
