import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { bootstrap as rootBootstrap } from 'glasswork';
import { bootstrap, defineModule } from 'glasswork/core';
import { createRoutes } from 'glasswork/http';

const require = createRequire(import.meta.url);
assert.throws(() => require.resolve('@hono/swagger-ui'), { code: 'MODULE_NOT_FOUND' });
assert.equal(rootBootstrap, bootstrap);
assert.equal(typeof createRoutes, 'function');
const errors = [];
const { app } = await bootstrap(
  defineModule({
    name: 'minimal',
    basePath: 'minimal',
    routes: (router) => {
      router.get('/ping', (c) => c.text('pong'));
    },
  }),
  {
    environment: 'test',
    openapi: { enabled: true, serveUI: true, serveSpecs: true },
    errorHandler: (error, c) => {
      errors.push(error);
      return c.text('failed', 500);
    },
  }
);
assert.equal((await app.request('/api/minimal/ping')).status, 200);
assert.equal((await app.request('/api/openapi.json')).status, 200);
assert.equal(errors.length, 0);
assert.equal((await app.request('/api')).status, 500);
assert.match(errors[0].message, /npm install @hono\/swagger-ui/);
assert.equal((await app.request('/api/minimal/ping')).status, 200);
console.log('Minimal consumer works without Swagger UI.');
