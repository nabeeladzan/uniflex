import { websocket } from 'hono/bun';
import { loadConfig } from './config';
import { createApp } from './app';

const config = await loadConfig();
const { app } = createApp(config);

export default {
  port: config.server.port,
  hostname: config.server.host,
  fetch: app.fetch,
  websocket,
};
