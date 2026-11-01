import { randomUUID } from 'node:crypto';
import {
  type AuditEntryInput,
  type AuditingLogger,
  type AuditSink,
  createAuditLogger,
} from 'glasswork/audit';
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

/** What a use case needs from audit: records that commit or roll back with its work. */
export interface AuditTrail {
  record(message: string, entry: AuditEntryInput): Promise<void>;
}

/**
 * Binds the audit logger to one transaction. The log line it writes first describes an
 * attempt; the audit row, written in the transaction, is the record of a completed change.
 */
export function auditIn(audit: AuditingLogger<Transaction>, tx: Transaction): AuditTrail {
  return { record: (message, entry) => audit.audit(message, entry, { tx }) };
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
