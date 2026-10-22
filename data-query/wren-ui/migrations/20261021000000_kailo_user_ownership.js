// DD-133 §3: Wren users are Kailo users. `kailo_user` keeps the display claims
// of the verified component token (refreshed on every login) under the
// issuer+subject digest; it is not an account, credential or permission
// registry. Thread, knowledge and API-history rows record which Kailo user
// created them so the native pages can show the Kailo name and avatar.
// Rows written before this migration have no recorded owner (NULL) and are
// shown as such; ownership is never inferred afterwards.
const owned = ['thread', 'sql_pair', 'instruction', 'api_history'];

exports.up = async function (knex) {
  await knex.schema.createTable('kailo_user', (table) => {
    table.string('user_key', 64).primary();
    table.string('name', 200).nullable();
    table.string('username', 200).nullable();
    table.string('email', 320).nullable();
    table.text('picture').nullable();
    table.string('locale', 35).nullable();
    table.timestamps(true, true);
  });
  for (const name of owned) {
    await knex.schema.alterTable(name, (table) => {
      table.string('owner_key', 64).nullable();
    });
  }
};

exports.down = async function (knex) {
  for (const name of owned) {
    await knex.schema.alterTable(name, (table) => {
      table.dropColumn('owner_key');
    });
  }
  await knex.schema.dropTable('kailo_user');
};
