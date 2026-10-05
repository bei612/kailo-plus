import { readFile } from 'node:fs/promises';
import { configuration, createAdapter } from './query-revision.mjs';

// This private configuration contains references to OpenBao Agent files, never
// inline credentials. No URL, native root or binding is selected by a caller.
try {
  const path = process.env.ADAPTER_CONFIG_FILE;
  if (!path?.startsWith('/')) throw new Error('configuration unavailable');
  const config = configuration(JSON.parse(await readFile(path, 'utf8')));
  const server = createAdapter(config);
  server.on('error', () => { process.exitCode = 1; });
  server.listen(config.listenPort, config.listenHost);
} catch {
  // Error text may contain credential paths or a provider body. Do not log it.
  process.stderr.write('file storage adapter configuration unavailable\n');
  process.exitCode = 1;
}
