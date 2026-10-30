import { websocket } from 'hono/bun';
import { loadConfig } from './config';
import { createApp } from './app';

const pkg = { name: 'uniflex', version: '0.1.0' };

export async function startServer() {
  const config = await loadConfig();
  const { app } = createApp(config);

  if (config.server.udpPort && config.server.udpPort > 0) {
    const { createUdpAudioServer } = await import('./sfu');
    createUdpAudioServer(config.server.udpPort);
  }

  Bun.serve({
    port: config.server.port,
    hostname: config.server.host,
    fetch: app.fetch,
    websocket,
  });
  console.log(`Uniflex server listening on http://${config.server.host}:${config.server.port}`);
}

if (import.meta.main) {
  const subcommand = process.argv[2];

  if (subcommand === '--version' || subcommand === '-v') {
    console.log(`${pkg.name} v${pkg.version}`);
    process.exit(0);
  }

  if (subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
    console.log(`
Uniflex Headless BaaS Server Engine v${pkg.version}

Usage:
  uniflex [serve]       Start the HTTP, WebSocket, and UDP SFU server engine
  --help, -h            Show this help message
  --version, -v         Show version
`);
    process.exit(0);
  }

  if (subcommand === 'tui') {
    console.error('TUI is excluded from the lean server binary. Run "bun run tui" from the project repo or build with "bun run build:tui".');
    process.exit(1);
  }

  if (!subcommand || subcommand === 'serve' || !subcommand.startsWith('-')) {
    try {
      await startServer();
    } catch (err) {
      console.error('Failed to start Uniflex server:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  } else {
    console.error(`Unknown command: "${subcommand}". Run "uniflex --help" for usage.`);
    process.exit(1);
  }
}
