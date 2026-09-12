/**
 * @module glasswork/audit
 * Audit logging, impersonation correlation, and audit sink abstraction.
 */

export {
  type CreateAuditLoggerOptions,
  createAuditLogger,
} from './audit-logger.js';
export { getAuditContext, resolveAuditRecord } from './context.js';
export type {
  AuditContext,
  AuditEntryInput,
  AuditingLogger,
  AuditRecordInput,
  AuditSink,
} from './types.js';
