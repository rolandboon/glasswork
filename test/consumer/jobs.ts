import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { defineModule } from 'glasswork/core';
import { bootstrapWorker, defineJob, type EMFJobMetricRecord } from 'glasswork/jobs';

const require = createRequire(import.meta.url);
assert.throws(() => require.resolve('@aws-sdk/client-cloudwatch'), { code: 'MODULE_NOT_FOUND' });
assert.throws(() => require.resolve('@aws-sdk/client-dynamodb'), { code: 'MODULE_NOT_FOUND' });
assert.throws(() => require.resolve('@aws-sdk/lib-dynamodb'), { code: 'MODULE_NOT_FOUND' });
const metrics: EMFJobMetricRecord[] = [];
const worker = bootstrapWorker({
  module: defineModule({ name: 'worker', jobs: [defineJob({ name: 'smoke', handler: () => {} })] }),
  metrics: {
    sink: (line) => {
      metrics.push(JSON.parse(line));
    },
  },
});
assert.deepEqual(await worker({ jobName: 'smoke' }), { success: true });
assert.equal(metrics.length, 1);
assert.equal(metrics[0].Status, 'success');
assert.equal(metrics[0].JobCount, 1);
console.log('Worker EMF works without the CloudWatch SDK.');
