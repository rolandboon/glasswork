import { serve } from '@hono/node-server';
import { bootstrap } from 'glasswork/core';
import { AppModule } from './app.module.js';

const { app, stop } = await bootstrap(AppModule);

const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) }, (info) => {
  console.log(`listening on ${info.port}`);
});

process.once('SIGTERM', () => {
  server.close(async () => {
    await stop();
    process.exit(0);
  });
});
