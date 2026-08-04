import { websocket } from 'hono/bun';
import { loadConfig } from './config';
import { createApp } from './app';

const pkg = { name: 'uniflex', version: '0.1.0' };
const subcommand = process.argv[2];

if (subcommand === '--version' || subcommand === '-v') {
  console.log(`${pkg.name} v${pkg.version}`);
  process.exit(0);
}

if (subcommand === '--help' || subcommand === '-h' || subcommand === 'help') {
  console.log(`
Uniflex BaaS Server & TUI Admin CLI v${pkg.version}

Usage:
  uniflex [command] [options]

Commands:
  serve                 Start the HTTP and WebSocket BaaS server engine (default)
  tui                   Open the interactive terminal dashboard
  --help, -h            Show this help message
  --version, -v         Show version

TUI Options:
  --endpoint <url>      Uniflex server endpoint (default: http://localhost:8080)
  --appId <slug>        Tenant application slug (auto-detects if omitted)
  --adminKey <key>      Admin secret key for managing protected server endpoints

Examples:
  uniflex               Start server listening on localhost:8080
  uniflex serve         Start server listening on localhost:8080
  uniflex tui --adminKey my-admin-key Launch interactive TUI dashboard
`);
  process.exit(0);
}

if (subcommand === 'tui') {
  // Exception: dynamic import keeps server mode fast and lets bundler split cleanly
  const { runTui } = await import('./tui/render');
  await runTui();
} else if (subcommand === 'serve' || !subcommand || !subcommand.startsWith('-')) {
  try {
    const config = await loadConfig();
    const { app } = createApp(config);

    Bun.serve({
      port: config.server.port,
      hostname: config.server.host,
      fetch: app.fetch,
      websocket,
    });

    console.log(`Uniflex server listening on http://${config.server.host}:${config.server.port}`);
  } catch (err) {
    console.error('Failed to start Uniflex server:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
} else {
  console.error(`Unknown command: "${subcommand}". Run "uniflex --help" for usage.`);
  process.exit(1);
}
