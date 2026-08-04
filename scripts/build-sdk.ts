import { mkdirSync, rmSync } from 'node:fs';
import { $ } from 'bun';
import path from 'node:path';

const root = process.cwd();
const sdkDir = path.join(root, 'packages', 'sdk');

// Clear prior dist output
rmSync(path.join(sdkDir, 'dist'), { recursive: true, force: true });
mkdirSync(path.join(sdkDir, 'dist'), { recursive: true });

// Bundle main + react entries as both ESM and CJS. React is a peer dependency (external).
const targets = [
  { format: 'esm', extension: 'js' },
  { format: 'cjs', extension: 'cjs' },
] as const;

for (const target of targets) {
  const out = await Bun.build({
    entrypoints: [
      path.join(sdkDir, 'src', 'index.ts'),
      path.join(sdkDir, 'src', 'react.tsx'),
    ],
    outdir: path.join(sdkDir, 'dist', target.format === 'esm' ? 'esm' : 'cjs'),
    format: target.format,
    external: ['react'],
    target: 'browser',
  });

  if (!out.success) {
    console.error('SDK bundle failed:', out.logs);
    process.exit(1);
  }
}

// Emit type declarations with tsc
await $`bunx tsc -p ${path.join(sdkDir, 'tsconfig.json')}`.cwd(root).quiet();

console.log('Built @uniflex/sdk dist (ESM + CJS + types).');
