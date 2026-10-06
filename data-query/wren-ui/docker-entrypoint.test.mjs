import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { nativeEnvironment, start } from './docker-entrypoint.mjs';

const directories = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'wren-native-start-'));
  directories.push(directory);
  const password = join(directory, 'password');
  const salt = join(directory, 'salt');
  await writeFile(password, 'fixture-password-'.repeat(3) + '\n', { mode: 0o400 });
  await writeFile(salt, 'fixture-salt-'.repeat(3) + '\n', { mode: 0o400 });
  return {
    WREN_NATIVE_IDENTITY_JSON: '{"issuer":"https://issuer.example"}',
    DB_TYPE: 'sqlite',
    SQLITE_FILE: '/app/data/db.sqlite3',
    WREN_ENCRYPTION_PASSWORD_FILE: password,
    WREN_ENCRYPTION_SALT_FILE: salt,
  };
}

test('loads only explicit file keys then runs original migration before standalone server', async () => {
  const env = await fixture();
  const calls = [];
  assert.equal(await start({ ...env, ENCRYPTION_PASSWORD: 'old-inline' }, async (command, args, delivered) => {
    calls.push([command, args]);
    assert.equal(delivered.ENCRYPTION_PASSWORD, 'fixture-password-'.repeat(3));
    assert.equal(delivered.ENCRYPTION_SALT, 'fixture-salt-'.repeat(3));
    assert.equal(delivered.SQLITE_FILE, '/app/data/db.sqlite3');
    return 0;
  }), 0);
  assert.deepEqual(calls, [
    ['node', ['node_modules/knex/bin/cli.js', 'migrate:latest']],
    ['node', ['server.js']],
  ]);
});

test('failed native migration never starts server or changes its exit', async () => {
  let calls = 0;
  assert.equal(await start(await fixture(), async () => { calls++; return 7; }), 7);
  assert.equal(calls, 1);
});

test('missing identity cannot start', async () => {
  const env = await fixture();
  for (const invalid of [
    { ...env, WREN_NATIVE_IDENTITY_JSON: '' },
  ]) {
    let called = false;
    await assert.rejects(start(invalid, async () => { called = true; }), /NATIVE_STARTUP_CONFIGURATION_REQUIRED/);
    assert.equal(called, false);
  }
});

test('native database and network settings pass unchanged to original Knex and Next', async () => {
  const env = await fixture();
  const require = createRequire(import.meta.url);
  for (const configured of [
    { DB_TYPE: 'pg', PG_URL: 'postgres://fixture@native-db/wren', HOSTNAME: '127.0.0.1', PORT: '3100' },
    { DB_TYPE: 'sqlite', SQLITE_FILE: '/native/custom/db.sqlite3', HOSTNAME: '::', PORT: '3200' },
  ]) {
    let calls = 0;
    await start({ ...env, ...configured }, async (_command, _args, delivered) => {
      calls++;
      for (const [key, value] of Object.entries(configured)) assert.equal(delivered[key], value);
      const original = process.env;
      try {
        process.env = delivered;
        delete require.cache[require.resolve('./knexfile.js')];
        const knex = require('./knexfile.js');
        assert.equal(knex.client, configured.DB_TYPE === 'pg' ? 'pg' : 'better-sqlite3');
        assert.equal(knex.connection, configured.PG_URL ?? configured.SQLITE_FILE);
      } finally {
        process.env = original;
      }
      return 0;
    });
    assert.equal(calls, 2);
  }
  const delivered = await nativeEnvironment(env);
  assert.equal(delivered.HOSTNAME, undefined);
  assert.equal(delivered.PORT, undefined);
});

test('DATA_KEY input has no invented PBKDF2 passphrase length restriction', async () => {
  const env = await fixture();
  for (const value of ['short', 'a'.repeat(4097)]) {
    await chmod(env.WREN_ENCRYPTION_PASSWORD_FILE, 0o600);
    await writeFile(env.WREN_ENCRYPTION_PASSWORD_FILE, value);
    await chmod(env.WREN_ENCRYPTION_PASSWORD_FILE, 0o400);
    assert.equal((await nativeEnvironment(env)).ENCRYPTION_PASSWORD, value);
  }
});

test('missing, empty, control-character and readable-by-others keys fail before migration', async () => {
  const env = await fixture();
  for (const value of ['', 'a'.repeat(32) + '\n' + 'b']) {
    await chmod(env.WREN_ENCRYPTION_PASSWORD_FILE, 0o600);
    await writeFile(env.WREN_ENCRYPTION_PASSWORD_FILE, value, { mode: 0o400 });
    await chmod(env.WREN_ENCRYPTION_PASSWORD_FILE, 0o400);
    await assert.rejects(nativeEnvironment(env), /^Error: NATIVE_DATA_KEY_UNAVAILABLE$/);
  }
  await chmod(env.WREN_ENCRYPTION_PASSWORD_FILE, 0o600);
  await writeFile(env.WREN_ENCRYPTION_PASSWORD_FILE, 'a'.repeat(32));
  await chmod(env.WREN_ENCRYPTION_PASSWORD_FILE, 0o644);
  await assert.rejects(nativeEnvironment(env), /^Error: NATIVE_DATA_KEY_UNAVAILABLE$/);
  await rm(env.WREN_ENCRYPTION_PASSWORD_FILE);
  await assert.rejects(nativeEnvironment(env), /^Error: NATIVE_DATA_KEY_UNAVAILABLE$/);
});

test('symlinked delivery is rejected and key values do not enter failure details', async () => {
  const env = await fixture();
  await rm(env.WREN_ENCRYPTION_PASSWORD_FILE);
  await symlink(env.WREN_ENCRYPTION_SALT_FILE, env.WREN_ENCRYPTION_PASSWORD_FILE);
  await assert.rejects(nativeEnvironment(env), /^Error: NATIVE_DATA_KEY_UNAVAILABLE$/);
});
