import { readFile } from 'node:fs/promises';
import { configuration, createAdapter } from './query-revision.mjs';

try {
  const path = process.env.ADAPTER_CONFIG_FILE;
  if (!path?.startsWith('/')) throw new Error('configuration unavailable');
  const config = configuration(JSON.parse(await readFile(path, 'utf8')));
  const server = createAdapter(config);
  server.on('error', () => { process.exitCode = 1; });
  server.listen(config.listenPort, config.listenHost);
} catch {
  process.stderr.write('knowledge adapter configuration unavailable\n');
  process.exitCode = 1;
}
