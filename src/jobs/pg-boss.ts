/**
 * @module glasswork/jobs/pg-boss
 * PostgreSQL jobs with pg-boss: a queue driver, with a transactional variant, and a
 * long-running worker. Requires the optional peer `pg-boss` 12 or later (Node.js 22.12+).
 */
export {
  type PgBossDatabase,
  type PgBossDriverConfig,
  PgBossQueueDriver,
  type PgBossSender,
} from './drivers/pg-boss-driver.js';
export {
  createPgBossWorker,
  type PgBossWorker,
  type PgBossWorkerConfig,
} from './pg-boss-worker.js';
