import { fileURLToPath } from 'node:url';
import { generateOpenAPI } from 'glasswork/core';
import { assertOpenAPIMatches, writeOpenAPIDocument } from 'glasswork/http';
import type { MiddlewareHandler } from 'hono';
import { AppModule } from './app.module.js';

/**
 * Writes contract/openapi.json, or with --check fails when the routes no longer match it.
 *
 * Route factories read the auth middleware while routes register. Contract generation
 * creates no providers, so it gets metadata-only replacements instead.
 */
const contract = fileURLToPath(new URL('../../contract/openapi.json', import.meta.url));
const passThrough = (): MiddlewareHandler => async (_context, next) => next();

const document = await generateOpenAPI(AppModule, {
  openapi: { documentation: { info: { title: 'Reference consumer', version: '1.0.0' } } },
  providerOverrides: [
    { provide: 'requireAuth', useValue: passThrough },
    { provide: 'optionalAuth', useValue: passThrough },
  ],
});

if (process.argv.includes('--check')) {
  await assertOpenAPIMatches(document, contract);
  console.log('contract/openapi.json matches the routes.');
} else {
  await writeOpenAPIDocument(document, contract);
}
