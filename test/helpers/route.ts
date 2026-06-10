import { Hono } from 'hono';
import { setOpenAPIContext } from '../../src/http/route-helpers.js';

/** Create a Hono router with an empty OpenAPI context for route tests. */
export function createTestRouter(): Hono {
  const router = new Hono();
  setOpenAPIContext(router, { processors: [], securitySchemes: [] });
  return router;
}
