import assert from 'node:assert/strict';
import { bootstrap, defineModule } from 'glasswork/core';

const { app } = await bootstrap(defineModule({ name: 'swagger' }), {
  environment: 'test',
  openapi: { enabled: true, serveUI: true, serveSpecs: true },
});
const responses = await Promise.all([app.request('/api'), app.request('/api')]);
for (const response of responses) {
  assert.equal(response.status, 200);
  assert.match(await response.text(), /swagger/i);
}
assert.equal((await app.request('/api/openapi.json')).status, 200);
console.log('Swagger UI works when its optional peer is installed.');
