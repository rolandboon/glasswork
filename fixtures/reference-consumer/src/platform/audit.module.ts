import { randomUUID } from 'node:crypto';
import { type AuditSink, createAuditLogger } from 'glasswork/audit';
import { createLogger, defineModule } from 'glasswork/core';
import { type Database, DatabaseModule, type Transaction } from './database.module.js';

/** Writes audit records in the caller's transaction when it passes one. */
export function createAuditSink(prisma: Database): AuditSink<Transaction> {
  return {
    async record(entry, options) {
      await (options?.tx ?? prisma).auditLog.create({
        data: {
          id: randomUUID(),
          tenantId: entry.tenantId,
          actorUserId: entry.actorUserId,
          action: entry.action,
          subjectType: entry.subjectType,
          subjectId: entry.subjectId,
          createdAt: entry.createdAt,
        },
      });
    },
  };
}

export const AuditModule = defineModule({
  name: 'audit',
  imports: [DatabaseModule],
  providers: [
    {
      provide: 'audit',
      useFactory: ({ prisma }: { prisma: Database }) =>
        createAuditLogger<Transaction>({
          sink: createAuditSink(prisma),
          logger: createLogger('audit', 'silent'),
          service: 'reference-consumer',
        }),
    },
  ],
  exports: ['audit'],
});
