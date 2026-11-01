import { defineModule } from 'glasswork/core';
import type { IdempotencyOptions } from './idempotency.js';

export {
  fingerprint,
  IdempotencyKeyInProgressError,
  IdempotencyKeyMismatchError,
  type IdempotencyOptions,
  type IdempotencyScope,
  isLockTimeout,
  onceForKey,
  type StoredResponse,
} from './idempotency.js';

/** The key lifetime and wait; the defaults suit most APIs, tests shorten them. */
export const IdempotencyModule = defineModule({
  name: 'idempotency',
  providers: [{ provide: 'idempotencyOptions', useValue: {} satisfies IdempotencyOptions }],
  exports: ['idempotencyOptions'],
});
