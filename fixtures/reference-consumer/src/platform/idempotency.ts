import { createHash } from 'node:crypto';
import { ConflictException, UnprocessableEntityException } from 'glasswork/http';
import type { Transaction } from './database.module.js';

/** Whose key it is and what it protects. Tenants, principals and operations never share keys. */
export interface IdempotencyScope {
  tenantId: string;
  principalId: string;
  operation: string;
  key: string;
}

export interface StoredResponse<TBody> {
  status: number;
  body: TBody;
}

export interface IdempotencyOptions {
  /** How long a key protects its request; afterwards it starts over. Default one day. */
  ttlSeconds?: number;
  /** How long a request waits for another one with the same key. Default 5000. */
  lockTimeoutMs?: number;
}

export class IdempotencyKeyMismatchError extends UnprocessableEntityException {
  constructor() {
    super('This Idempotency-Key was used for a different request', {
      errorCode: 'idempotency-key-mismatch',
    });
  }
}

export class IdempotencyKeyInProgressError extends ConflictException {
  constructor() {
    super('A request with this Idempotency-Key is still in progress; retry later', {
      errorCode: 'idempotency-key-in-progress',
    });
  }
}

/** A stable hash of a request body: object keys are sorted, so their order does not matter. */
export function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

interface ExistingKey {
  requestHash: string;
  responseStatus: number | null;
  responseBody: unknown;
  expired: boolean;
}

const scopeWhere = '"tenantId" = $1 AND "principalId" = $2 AND operation = $3 AND key = $4';

/**
 * Runs `execute` at most once per key while the key lives, in the caller's transaction,
 * and stores its response in that transaction. A crash can therefore never leave the
 * change without its stored response, or the other way round.
 *
 * - A repeat after completion returns the stored response without running `execute`.
 * - A repeat with a different request hash fails with 422.
 * - A concurrent repeat waits for the first transaction, up to `lockTimeoutMs`, and then
 *   returns its response. When the first transaction rolls back, the repeat runs instead.
 *   When the wait times out, PostgreSQL ends the transaction; see `isLockTimeout`.
 * - A rolled-back request leaves no key behind, so a retry runs again.
 */
export async function onceForKey<TBody>(
  tx: Transaction,
  scope: IdempotencyScope,
  requestHash: string,
  options: IdempotencyOptions,
  execute: () => Promise<StoredResponse<TBody>>
): Promise<{ replayed: boolean; response: StoredResponse<TBody> }> {
  const { ttlSeconds = 86_400, lockTimeoutMs = 5_000 } = options;
  const key = [scope.tenantId, scope.principalId, scope.operation, scope.key];

  // Bound only the wait for the key, then restore the setting for the rest of the work.
  const [setting] = await tx.$queryRawUnsafe<Array<{ previous: string }>>(
    `SELECT current_setting('lock_timeout') AS previous, set_config('lock_timeout', $1, true)`,
    `${Math.trunc(lockTimeoutMs)}ms`
  );
  const existing = await acquireKey(tx, key, requestHash, ttlSeconds);
  await tx.$queryRawUnsafe(`SELECT set_config('lock_timeout', $1, true)`, setting?.previous ?? '0');

  if (existing) {
    if (!existing.expired) {
      if (existing.requestHash !== requestHash) throw new IdempotencyKeyMismatchError();
      if (existing.responseStatus === null) throw new IdempotencyKeyInProgressError();
      return {
        replayed: true,
        response: { status: existing.responseStatus, body: existing.responseBody as TBody },
      };
    }
    // An expired key starts over for the new request.
    await tx.$executeRawUnsafe(
      `UPDATE "IdempotencyKey"
       SET "requestHash" = $5, "responseStatus" = NULL, "responseBody" = NULL,
           "createdAt" = LOCALTIMESTAMP,
           "expiresAt" = LOCALTIMESTAMP + make_interval(secs => $6::double precision)
       WHERE ${scopeWhere}`,
      ...key,
      requestHash,
      ttlSeconds
    );
  }

  const response = await execute();
  await tx.$executeRawUnsafe(
    `UPDATE "IdempotencyKey" SET "responseStatus" = $5, "responseBody" = $6::jsonb
     WHERE ${scopeWhere}`,
    ...key,
    response.status,
    JSON.stringify(response.body)
  );
  return { replayed: false, response };
}

/** Acquires a row before any business change, including when retention deletes a conflict. */
async function acquireKey(
  tx: Transaction,
  key: string[],
  requestHash: string,
  ttlSeconds: number
): Promise<ExistingKey | undefined> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inserted = await tx.$executeRawUnsafe(
      `INSERT INTO "IdempotencyKey" ("tenantId", "principalId", operation, key, "requestHash", "expiresAt")
       VALUES ($1, $2, $3, $4, $5, LOCALTIMESTAMP + make_interval(secs => $6::double precision))
       ON CONFLICT DO NOTHING`,
      ...key,
      requestHash,
      ttlSeconds
    );
    if (inserted === 1) return undefined;
    const [existing] = await tx.$queryRawUnsafe<ExistingKey[]>(
      `SELECT "requestHash", "responseStatus", "responseBody", "expiresAt" < LOCALTIMESTAMP AS expired
       FROM "IdempotencyKey" WHERE ${scopeWhere} FOR UPDATE`,
      ...key
    );
    if (existing) return existing;
    // Retention removed the expired row between INSERT and SELECT. Acquire it again;
    // executing without a row would commit a change whose response cannot be stored.
  }
  throw new IdempotencyKeyInProgressError();
}

/** True when PostgreSQL ended a wait for a lock, such as a concurrent request's key. */
export function isLockTimeout(error: unknown): boolean {
  const text = `${(error as Error)?.message ?? ''} ${JSON.stringify((error as { meta?: unknown })?.meta ?? {})}`;
  return text.includes('55P03') || /lock timeout/i.test(text);
}
