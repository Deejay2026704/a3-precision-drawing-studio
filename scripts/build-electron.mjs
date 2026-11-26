import { rmSync } from 'node:fs';
import { buildElectron } from './electron-build.mjs';

rmSync('dist-electron', { recursive: true, force: true });
await buildElectron({ dev: false });
console.log('Electron main/preload built to dist-electron/');
