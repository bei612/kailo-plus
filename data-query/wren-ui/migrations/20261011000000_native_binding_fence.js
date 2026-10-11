// Execution attribution belongs to Wren's original records, not a second ledger.
exports.up = async function (knex) {
  await knex.schema.alterTable('project', (table) => {
    table.json('native_binding_fences').nullable();
  });
  await knex.schema.alterTable('api_history', (table) => {
    table.integer('governance_generation').nullable();
  });
  // Historical generation cannot be inferred from today's binding delivery.
  // Such rows remain unproven and prevent binding reconciliation completing.
};

exports.down = async function (knex) {
  if (
    (await knex('project').whereNotNull('native_binding_fences').first()) ||
    (await knex('api_history').whereNotNull('governance_generation').first())
  ) {
    throw new Error(
      'Native binding fence and generation evidence must be retained',
    );
  }
  await knex.schema.alterTable('api_history', (table) => {
    table.dropColumn('governance_generation');
  });
  await knex.schema.alterTable('project', (table) => {
    table.dropColumn('native_binding_fences');
  });
};
