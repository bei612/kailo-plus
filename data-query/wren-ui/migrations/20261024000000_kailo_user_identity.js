// DD-138(4), `.design/07` §4.8.3: Core addresses a ComponentNotification to
// the recipient's (and actor's) OIDC `issuer` + `subject`, the same values the
// member directory carries in `members[].identities[]`. `kailo_user` so far
// kept only their SHA-256 digest (`user_key`), so a user_key is mapped back to
// the pair here. Both columns are written together, only from a verified
// source: the login token the gateway forwards (middleware, key re-derived
// before storing) or an applied directory snapshot. Rows without them (no
// login or snapshot since this migration) are simply not notified.
// The pair is an identifier, not a credential or permission.
exports.up = async function (knex) {
  await knex.schema.alterTable('kailo_user', (table) => {
    table.string('issuer', 2048).nullable();
    table.string('subject', 255).nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('kailo_user', (table) => {
    table.dropColumn('subject');
    table.dropColumn('issuer');
  });
};
