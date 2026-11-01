import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { bootstrap, type ProviderConfig } from 'glasswork/core';
import { generateRLSPolicies } from 'glasswork/rls';
import { AppModule } from '../src/app.module.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { tenantModels } from '../src/platform/database.module.js';
import { outbox } from '../src/platform/email.module.js';

const adminUrl = process.env.REFERENCE_DATABASE_URL;

/**
 * Creates a schema, tables, RLS policies and a restricted runtime role, and points the
 * application at them through DATABASE_URL and DATABASE_SCHEMA.
 */
export async function createDatabase() {
  if (!adminUrl) throw new Error('REFERENCE_DATABASE_URL must point to a test database');
  const schema = `reference_${randomUUID().replaceAll('-', '')}`;
  const role = `${schema}_app`;
  const password = randomUUID();
  const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) });

  await admin.$executeRawUnsafe(
    `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`
  );
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  await admin.$transaction(async (tx) => {
    const statements = [
      `SET LOCAL search_path = "${schema}"`,
      `CREATE TABLE "Project" (id text PRIMARY KEY, "tenantId" text NOT NULL, name text NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE "Invitation" (id text PRIMARY KEY, "tenantId" text NOT NULL, "projectId" text NOT NULL REFERENCES "Project"(id), email text NOT NULL, status text NOT NULL, version integer NOT NULL DEFAULT 1, "sentAt" timestamp(3))`,
      `CREATE TABLE "AuditLog" (id text PRIMARY KEY, "tenantId" text, "actorUserId" text NOT NULL, action text NOT NULL, "subjectType" text NOT NULL, "subjectId" text, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE "Order" (id text PRIMARY KEY, "tenantId" text NOT NULL, sku text NOT NULL, quantity integer NOT NULL, status text NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE "OutboxMessage" (id text PRIMARY KEY, sequence bigserial NOT NULL UNIQUE, "tenantId" text NOT NULL, type text NOT NULL, "payloadVersion" integer NOT NULL, payload jsonb NOT NULL, "aggregateType" text NOT NULL, "aggregateId" text NOT NULL, "correlationId" text, "actorUserId" text, status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, "claimedBy" text, "claimedUntil" timestamp(3), "lastError" text, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "publishedAt" timestamp(3))`,
      `CREATE INDEX "OutboxMessage_status_sequence" ON "OutboxMessage" (status, sequence)`,
      `CREATE INDEX "OutboxMessage_aggregate_sequence" ON "OutboxMessage" ("tenantId", "aggregateType", "aggregateId", sequence)`,
      `CREATE TABLE "InboxMessage" (consumer text NOT NULL, "eventId" text NOT NULL, "tenantId" text NOT NULL, "receivedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (consumer, "eventId"))`,
      `CREATE TABLE "IdempotencyKey" ("tenantId" text NOT NULL, "principalId" text NOT NULL, operation text NOT NULL, key text NOT NULL, "requestHash" text NOT NULL, "responseStatus" integer, "responseBody" jsonb, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" timestamp(3) NOT NULL, PRIMARY KEY ("tenantId", "principalId", operation, key))`,
      `CREATE TABLE "PointsEntry" (id text PRIMARY KEY, "tenantId" text NOT NULL, "userId" text NOT NULL, "orderId" text NOT NULL, points integer NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE "StockItem" (id text PRIMARY KEY, "tenantId" text NOT NULL, sku text NOT NULL, available integer NOT NULL, UNIQUE ("tenantId", sku))`,
      `CREATE TABLE "Reservation" (id text PRIMARY KEY, "tenantId" text NOT NULL, "orderId" text NOT NULL, sku text NOT NULL, quantity integer NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      ...generateRLSPolicies({ models: tenantModels })
        .split(';')
        .filter((statement) => statement.trim()),
      `GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO "${role}"`,
      `GRANT USAGE ON ALL SEQUENCES IN SCHEMA "${schema}" TO "${role}"`,
    ];
    for (const statement of statements) await tx.$executeRawUnsafe(statement);
  });

  const url = new URL(adminUrl);
  url.username = role;
  url.password = password;
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.href;
  process.env.DATABASE_SCHEMA = schema;

  return {
    /** Unrestricted reads for assertions, bypassing RLS. */
    query<T>(sql: string): Promise<T[]> {
      return admin.$queryRawUnsafe<T[]>(`SELECT * FROM "${schema}".${sql}`);
    },
    /** Runs a query as the administrator in this schema, for columns such as `xmin`. */
    select<T>(sql: string, ...values: unknown[]): Promise<T[]> {
      return admin.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path = "${schema}"`);
        return tx.$queryRawUnsafe<T[]>(sql, ...values);
      });
    },
    /** Runs a function in an administrator transaction in this schema, to hold locks. */
    transaction<T>(fn: (tx: Pick<typeof admin, '$queryRawUnsafe'>) => Promise<T>): Promise<T> {
      return admin.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path = "${schema}"`);
        return fn(tx);
      });
    },
    /** Runs a statement as the administrator, in this schema, for test data. */
    execute(sql: string, ...values: unknown[]): Promise<number> {
      return admin.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL search_path = "${schema}"`);
        return tx.$executeRawUnsafe(sql, ...values);
      });
    },
    async drop() {
      await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.$executeRawUnsafe(`DROP ROLE "${role}"`);
      await admin.$disconnect();
    },
  };
}

export async function startApp(providerOverrides: ProviderConfig[] = []) {
  outbox.clear();
  const application = await bootstrap(AppModule, { environment: 'test', providerOverrides });
  await application.start();
  return application;
}

export function request(
  app: { request(path: string, init?: RequestInit): Response | Promise<Response> },
  path: string,
  options: { token?: string; method?: string; body?: unknown } = {}
) {
  return app.request(`/api${path}`, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}
