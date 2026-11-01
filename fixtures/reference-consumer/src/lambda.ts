import { bootstrap } from 'glasswork/core';
import { bootstrapWorker } from 'glasswork/jobs';
import { handle } from 'hono/aws-lambda';
import { AppModule } from './app.module.js';

const { app } = await bootstrap(AppModule);

/** API Gateway or Function URL handler. */
export const handler = handle(app);

/** SQS handler for the jobs this application declares. */
export const worker = bootstrapWorker({ module: AppModule });
