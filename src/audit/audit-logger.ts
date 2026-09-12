import type { Logger } from '../utils/logger.js';
import { resolveAuditRecord } from './context.js';
import type { AuditEntryInput, AuditingLogger, AuditRecordInput, AuditSink } from './types.js';

export interface CreateAuditLoggerOptions<TTx = unknown> {
  /** Persistence sink for audit records */
  sink: AuditSink<TTx>;
  /** Underlying logger (e.g. Pino logger) */
  logger: Logger;
  /** Service name to tag audit events with */
  service?: string;
  /** Custom formatter for the structured log payload */
  formatLogPayload?: (record: AuditRecordInput) => Record<string, unknown>;
}

/**
 * Creates an AuditingLogger that combines structured logging with persistence via an AuditSink.
 *
 * Each call to `logger.audit(message, entry, options)`:
 * 1. Resolves ambient request context (actor, impersonation, tenant, correlation ID).
 * 2. Emits a structured log (`audit: true` with audit attributes) via the underlying logger.
 * 3. Persists the resolved audit record atomically using the provided sink.
 */
export function createAuditLogger<TTx = unknown>(
  options: CreateAuditLoggerOptions<TTx>
): AuditingLogger<TTx> {
  const { sink, logger, service, formatLogPayload } = options;

  const audit = async (
    message: string,
    entry: AuditEntryInput,
    auditOptions?: { tx?: TTx }
  ): Promise<void> => {
    const record = resolveAuditRecord(
      {
        ...entry,
        message: entry.message ?? message,
      },
      service
    );

    const logPayload = formatLogPayload
      ? formatLogPayload(record)
      : {
          audit: true,
          action: record.action,
          category: record.category,
          subjectType: record.subjectType,
          subjectId: record.subjectId,
          actorUserId: record.actorUserId,
          effectiveUserId: record.effectiveUserId,
          isImpersonating: record.isImpersonating,
          tenantId: record.tenantId,
          service: record.service,
          metadata: record.metadata,
        };

    logger.info(message, logPayload);

    await sink.record(record, auditOptions);
  };

  return {
    debug: logger.debug.bind(logger),
    info: logger.info.bind(logger),
    warn: logger.warn.bind(logger),
    error: logger.error.bind(logger),
    child: logger.child?.bind(logger),
    audit,
  };
}
