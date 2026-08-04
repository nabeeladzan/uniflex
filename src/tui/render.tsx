import React from 'react';
import { render } from 'ink';
import { App } from './App';
import { createClient } from '@uniflex/sdk';
import { args } from './args';

export async function runTui(): Promise<void> {
  // Enter xterm alternate screen buffer, clear screen, move cursor to 1,1
  process.stdout.write('\x1b[?1049h\x1b[H\x1b[2J');

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    // Restore cursor and main terminal screen buffer
    process.stdout.write('\x1b[?25h\x1b[?1049l');
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });

  try {
    const client = createClient({
      endpoint: args.endpoint,
      appId: args.appId || 'my-app',
    });
    const inst = render(<App client={client} initialAppId={args.appId} onExit={cleanup} />);
    await inst.waitUntilExit();
  } finally {
    cleanup();
  }
}
