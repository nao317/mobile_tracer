import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const result = spawnSync(process.execPath, [path.join(here, 'node_modules/playwright/cli.js'), 'install', 'chromium'], {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(root, '.cache-docs/browsers') },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
