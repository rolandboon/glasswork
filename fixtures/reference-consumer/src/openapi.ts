import { writeFile } from 'node:fs/promises';
import { generateOpenAPI } from 'glasswork/core';
import type { MiddlewareHandler } from 'hono';
import { AppModule } from './app.module.js';

/**
 * Route factories read the auth middleware while routes register. Contract generation
 * creates no providers, so it gets metadata-only replacements instead.
 */
const passThrough = (): MiddlewareHandler => async (_context, next) => next();

const document = await generateOpenAPI(AppModule, {
  openapi: { documentation: { info: { title: 'Reference consumer', version: '1.0.0' } } },
  providerOverrides: [
    { provide: 'requireAuth', useValue: passThrough },
    { provide: 'optionalAuth', useValue: passThrough },
  ],
});

await writeFile(process.argv[2] ?? 'openapi.json', `${JSON.stringify(document, null, 2)}\n`);
