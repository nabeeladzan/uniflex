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
  } catch {}
  return undefined;
}

const withTui = process.argv.some((a) => a === '--with-tui' || a === 'tui');
const isLinuxRequested = process.argv.some((a) => a === 'linux' || a === '--target=linux');
const isWinRequested = process.argv.some((a) => a === 'windows' || a === '--target=windows');

let target: 'bun-linux-x64' | 'bun-windows-x64';
let outfile: string;

if (isLinuxRequested) {
  target = 'bun-linux-x64';
  outfile = 'uniflex-linux';
} else if (isWinRequested) {
  target = 'bun-windows-x64';
  outfile = 'uniflex.exe';
} else {
  const isWin = process.platform === 'win32';
  target = isWin ? 'bun-windows-x64' : 'bun-linux-x64';
  outfile = isWin ? 'uniflex.exe' : 'uniflex';
}

const entrypoint = withTui ? 'src/cli.ts' : 'src/serve.ts';
console.log(`Building ${withTui ? 'full (server + TUI)' : 'lean headless server'} binary for ${target} -> ${outfile}...`);

const buildConfig: Parameters<typeof Bun.build>[0] = {
  entrypoints: [entrypoint],
  compile: {
    target,
    outfile,
  },
  external: ['sharp'],
  minify: true,
};

if (withTui) {
  const wasmDir = findWasmDir(path.join(process.cwd(), 'node_modules'));
  if (wasmDir) {
    (buildConfig as unknown as Record<string, unknown>).assets = [wasmDir];
  }
}

const res = await Bun.build(buildConfig);

if (!res.success) {
  console.error('Build failed:', res.logs);
  process.exit(1);
}

console.log(`Successfully built single-binary executable: ${outfile}`);
