import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Native DATA_KEY delivery only. This does not read Core state or provision
// a native account. Do not rotate these keys without native re-encryption.
async function dataKey(path) {
  if (!path?.startsWith('/')) throw new Error('NATIVE_DATA_KEY_UNAVAILABLE');
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
      throw new Error('NATIVE_DATA_KEY_UNAVAILABLE');
    }
    const value = (await file.readFile('utf8')).replace(/\r?\n$/, '');
    if (!value || /[\x00-\x1f\x7f]/.test(value)) {
      throw new Error('NATIVE_DATA_KEY_UNAVAILABLE');
    }
    return value;
  } catch {
    throw new Error('NATIVE_DATA_KEY_UNAVAILABLE');
  } finally {
    await file?.close();
  }
}

export async function nativeEnvironment(input = process.env) {
  if (!input.WREN_NATIVE_IDENTITY_JSON) {
    throw new Error('NATIVE_STARTUP_CONFIGURATION_REQUIRED');
  }
  // Identity claims remain verified by the existing middleware on each request.
  // File delivery overrides rather than retaining a stale inline key.
  return {
    ...input,
    ENCRYPTION_PASSWORD: await dataKey(input.WREN_ENCRYPTION_PASSWORD_FILE),
    ENCRYPTION_SALT: await dataKey(input.WREN_ENCRYPTION_SALT_FILE),
  };
}

async function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' });
    let stopped;
    const interrupt = () => { stopped = 130; child.kill('SIGINT'); };
    const terminate = () => { stopped = 143; child.kill('SIGTERM'); };
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    const cleanup = () => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', terminate);
    };
    child.once('error', () => { cleanup(); reject(new Error('NATIVE_START_FAILED')); });
    child.once('exit', (code) => { cleanup(); resolve(stopped ?? code ?? 1); });
  });
}

export async function start(input = process.env, execute = run) {
  const env = await nativeEnvironment(input);
  // The original native Knex migration owns the Wren database. A failure must
  // never continue into Next. Nothing here connects to a platform database.
  const migrated = await execute('node', ['node_modules/knex/bin/cli.js', 'migrate:latest'], env);
  if (migrated !== 0) return migrated;
  return execute('node', ['server.js'], env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await start();
  } catch {
    // Never print a filesystem error, environment or key value.
    console.error('NATIVE_STARTUP_FAILED');
    process.exitCode = 1;
  }
}
