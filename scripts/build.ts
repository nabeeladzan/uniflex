import { readdirSync } from 'node:fs';
import path from 'node:path';

function findWasmDir(dir: string): string | undefined {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findWasmDir(fullPath);
        if (found) return found;
      } else if (entry.isFile() && entry.name.endsWith('.wasm')) {
        return dir;
      }
    }
  } catch {
    // Ignore unreadable dirs
  }
  return undefined;
}

const wasmDir = findWasmDir(path.join(process.cwd(), 'node_modules'));
if (wasmDir) {
  console.log(`Found WASM asset directory: ${wasmDir}`);
} else {
  console.log('No standalone .wasm file found; yoga uses inline base64 WASM bundle.');
}

const isWin = process.platform === 'win32';
const target = isWin ? 'bun-windows-x64' : 'bun-linux-x64';
const outfile = isWin ? 'uniflex.exe' : 'uniflex';

console.log(`Building single-binary for ${target} -> ${outfile}...`);

const buildConfig: Parameters<typeof Bun.build>[0] = {
  entrypoints: ['src/cli.ts'],
  compile: {
    target: target as any,
    outfile,
  },
  minify: true,
};

if (wasmDir) {
  buildConfig.assets = [wasmDir];
}

const res = await Bun.build(buildConfig);

if (!res.success) {
  console.error('Build failed:', res.logs);
  process.exit(1);
}

console.log(`Successfully built single-binary executable: ${outfile}`);
