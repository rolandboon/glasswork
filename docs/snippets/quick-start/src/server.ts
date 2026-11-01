import { serve } from '@hono/node-server';
import { bootstrap, isLambda } from 'glasswork/core';
import { handle } from 'hono/aws-lambda';
import { AppModule } from './app.module';

const { app } = await bootstrap(AppModule, {
  openapi: {
    enabled: true,
    documentation: {
      info: {
        title: 'My API',
        version: '1.0.0',
      },
    },
  },
});

// Export for Lambda
export const handler = handle(app);

// Start local server if not in Lambda
if (!isLambda()) {
  const port = Number(process.env.PORT) || 3000;
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });
}
