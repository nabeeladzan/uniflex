import { startServer } from './serve';

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
  const { runTui } = await import('./tui/render');
  await runTui();
} else if (subcommand === 'serve' || !subcommand || !subcommand.startsWith('-')) {
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
