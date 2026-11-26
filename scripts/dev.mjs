// Development runner: starts the Vite dev server, builds the Electron main/preload
// scripts and launches Electron pointed at the dev server. Extra CLI arguments are
// forwarded to Electron (e.g. `npm run dev -- --no-sandbox` when running as root on Linux).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { buildElectron } from './electron-build.mjs';

const require = createRequire(import.meta.url);
const electronBinary = require('electron'); // resolves to the Electron executable path

await buildElectron({ dev: true });
const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:5173/';
console.log(`Vite dev server: ${url}`);

const env = { ...process.env, VITE_DEV_SERVER_URL: url };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronBinary, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });

const shutdown = async (code) => {
  await server.close();
  process.exit(code ?? 0);
};
child.on('exit', (code) => void shutdown(code));
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
