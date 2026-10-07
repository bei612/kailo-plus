// Native task observation must survive both direct and cascading deletes.
exports.up = async function (knex) {
  if (knex.client.config.client === 'pg') {
    await knex.raw(`
      CREATE FUNCTION preserve_running_asking_task() RETURNS trigger AS $$
      BEGIN
        IF COALESCE(OLD.detail->>'status', '') NOT IN ('FINISHED', 'FAILED', 'STOPPED') THEN
          RAISE EXCEPTION 'Native asking task % has no observed terminal result; retain it for observation before deletion', OLD.id;
        END IF;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER preserve_running_asking_task
        BEFORE DELETE ON asking_task
        FOR EACH ROW EXECUTE FUNCTION preserve_running_asking_task();
    `);
  } else {
    await knex.raw(`
      CREATE TRIGGER preserve_running_asking_task
      BEFORE DELETE ON asking_task
      WHEN COALESCE(CASE WHEN json_valid(OLD.detail) THEN json_extract(OLD.detail, '$.status') END, '')
        NOT IN ('FINISHED', 'FAILED', 'STOPPED')
      BEGIN
        SELECT RAISE(ABORT, 'Native asking task has no observed terminal result; retain it for observation before deletion');
      END;
    `);
  }
};

exports.down = async function (knex) {
  if (await knex('asking_task').first('id')) {
    throw new Error(
      'Stop rollback while native task observation evidence exists',
    );
  }
  if (knex.client.config.client === 'pg') {
    await knex.raw('DROP TRIGGER preserve_running_asking_task ON asking_task');
    await knex.raw('DROP FUNCTION preserve_running_asking_task()');
  } else {
    await knex.raw('DROP TRIGGER preserve_running_asking_task');
  }
};
