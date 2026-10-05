// Extend the original native query history. This is not a platform workflow
// store: Core still owns ActionExecution/ExternalExecution and their timers.
exports.up = async function (knex) {
  await knex.schema.alterTable('api_history', (table) => {
    table.string('governance_binding_id');
    table.string('governance_key');
    table.string('governance_action_execution_id');
    table.string('governance_operation_id');
    table.string('governance_parameter_hash');
    table.string('governance_state');
    table.integer('governance_deployment_id');
    table.string('governance_deployment_hash');
    table.unique(['governance_binding_id', 'governance_key']);
    table.unique(['governance_binding_id', 'governance_action_execution_id']);
  });
};

exports.down = async function (knex) {
  if (await knex('api_history').whereNotNull('governance_key').first()) {
    throw new Error('Governed native query evidence must be retained');
  }
  await knex.schema.alterTable('api_history', (table) => {
    table.dropUnique(['governance_binding_id', 'governance_key']);
    table.dropUnique([
      'governance_binding_id',
      'governance_action_execution_id',
    ]);
    table.dropColumns(
      'governance_binding_id',
      'governance_key',
      'governance_action_execution_id',
      'governance_operation_id',
      'governance_parameter_hash',
      'governance_state',
      'governance_deployment_id',
      'governance_deployment_hash',
    );
  });
};
