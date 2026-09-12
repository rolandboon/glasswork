import type { Logger } from '../utils/logger.js';

/**
 * Contextual information about the actor and request for an audit event.
 */
export interface AuditContext {
  /** Physical authenticated user who initiated the request */
  actorUserId: string;
  /** Effective user identity when acting via impersonation */
  effectiveUserId?: string;
  /** Whether the request is being executed via impersonation */
  isImpersonating: boolean;
  /** Tenant / organization identifier */
  tenantId?: string;
  /** Request identifier for distributed correlation */
  requestId?: string;
}

/**
 * Input for creating an audit event from business logic.
 */
export interface AuditEntryInput {
  /** Unique action identifier (e.g. 'poll.create', 'member.archive') */
  action: string;
  /** Audit category (defaults to 'DATA') */
  category?: string;
  /** Target entity type (e.g. 'Poll', 'User', 'MedicalGroup') */
  subjectType: string;
  /** Target entity ID */
  subjectId?: string | null;
  /** Human-readable description of the event */
  message?: string;
  /** Additional structured metadata or changed fields */
  metadata?: Record<string, unknown> | null;
  /** Explicit actor override (e.g. for background jobs / seeders) */
  actorUserId?: string | null;
  /** Explicit effective user override */
  effectiveUserId?: string | null;
  /** Explicit tenant override */
  tenantId?: string | null;
}

/**
 * Fully resolved audit record ready for persistence and structured logging.
 */
export interface AuditRecordInput {
  actorUserId: string;
  effectiveUserId: string | null;
  isImpersonating: boolean;
  tenantId: string | null;
  requestId: string | null;
  action: string;
  category: string;
  subjectType: string;
  subjectId: string | null;
  message: string;
  metadata: Record<string, unknown> | null;
  service: string | null;
  createdAt: Date;
}

/**
 * Pluggable persistence sink for audit records (e.g. Prisma, DynamoDB, CloudWatch).
 */
export interface AuditSink<TTx = unknown> {
  record(entry: AuditRecordInput, options?: { tx?: TTx }): Promise<void>;
}

/**
 * Logger extended with an `.audit()` method that writes structured logs and persists via a sink.
 */
export type AuditingLogger<TTx = unknown> = Logger & {
  audit(message: string, entry: AuditEntryInput, options?: { tx?: TTx }): Promise<void>;
};
