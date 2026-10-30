// DD-169(7): multiple data sources per instance.
//   * `kailo_ai_project_scoped`: the project's last deployment has been
//     prepared again in the AI Service with its `project_id` (DD-169(2)③);
//     until then its documents are unscoped and not retrieved.
// Credentials moved into Kailo custody stay in `connection_info` as a
// reference (`kailoSecretId`); an older writer cannot use such a row.
exports.up = async function (knex) {
  await knex.schema.alterTable('project', (table) => {
    table.boolean('kailo_ai_project_scoped').notNullable().defaultTo(false);
  });
};

exports.down = async function (knex) {
  // An older release can neither read credentials held by Kailo nor tell its
  // data sources apart in the AI Service: stop the rollback instead.
  const projects = await knex('project').select('id', 'connection_info');
  const held = projects.some((row) => {
    const info =
      typeof row.connection_info === 'string'
        ? JSON.parse(row.connection_info || '{}')
        : row.connection_info || {};
    return typeof info.kailoSecretId === 'string';
  });
  if (held || projects.length > 1)
    throw new Error(
      'Refuse data source rollback while Kailo holds credentials or more than one data source exists',
    );
  await knex.schema.alterTable('project', (table) => {
    table.dropColumn('kailo_ai_project_scoped');
  });
};
