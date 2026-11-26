// Bundles the Electron main and preload scripts (TypeScript → CommonJS) with esbuild.
import { build } from 'esbuild';

export async function buildElectron({ dev = false } = {}) {
  await build({
    entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
    outdir: 'dist-electron',
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
    sourcemap: dev,
    minify: !dev,
    logLevel: 'warning',
  });
}
