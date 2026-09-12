import { getRequestActor, getRequestId } from '../observability/request-context.js';
import type { AuditContext, AuditEntryInput, AuditRecordInput } from './types.js';

/**
 * Get contextual information about the current actor and request for auditing.
 * Returns undefined if called outside an authenticated request lifecycle.
 */
export function getAuditContext(): AuditContext | undefined {
  const actor = getRequestActor();
  if (!actor?.actorUserId) return undefined;
  return {
    actorUserId: actor.actorUserId,
    effectiveUserId: actor.effectiveUserId,
    isImpersonating: actor.isImpersonating,
    tenantId: actor.tenantId,
    requestId: getRequestId(),
  };
}

interface ResolvedActors {
  actorUserId: string;
  effectiveUserId: string | null;
  isImpersonating: boolean;
  tenantId: string | null;
}

function resolveActor(entry: AuditEntryInput, ctx?: AuditContext): ResolvedActors {
  if (ctx?.isImpersonating) {
    return {
      actorUserId: ctx.actorUserId,
      effectiveUserId: ctx.effectiveUserId ?? null,
      isImpersonating: Boolean(ctx.effectiveUserId && ctx.effectiveUserId !== ctx.actorUserId),
      tenantId: ctx.tenantId ?? entry.tenantId ?? null,
    };
  }

  const actorUserId = entry.actorUserId ?? ctx?.actorUserId;
  if (!actorUserId) {
    throw new Error(
      `Audit entry '${entry.action}' requires an actorUserId, but none was provided or available in request context`
    );
  }

  const effectiveUserId = entry.effectiveUserId ?? ctx?.effectiveUserId ?? null;
  return {
    actorUserId,
    effectiveUserId,
    isImpersonating: Boolean(effectiveUserId && effectiveUserId !== actorUserId),
    tenantId: entry.tenantId ?? ctx?.tenantId ?? null,
  };
}

function formatAuditMessage(entry: AuditEntryInput): string {
  if (entry.message) return entry.message;
  const target = entry.subjectId ? ` ${entry.subjectId}` : '';
  return `Audit: ${entry.action} on ${entry.subjectType}${target}`;
}

/**
 * Resolve an audit entry input with ambient request context to produce a complete AuditRecordInput.
 *
 * @throws Error if no actorUserId can be resolved from either the entry or the request context.
 */
export function resolveAuditRecord(entry: AuditEntryInput, service?: string): AuditRecordInput {
  const ctx = getAuditContext();
  const actors = resolveActor(entry, ctx);

  return {
    ...actors,
    requestId: ctx?.requestId ?? null,
    action: entry.action,
    category: entry.category ?? 'DATA',
    subjectType: entry.subjectType,
    subjectId: entry.subjectId ?? null,
    message: formatAuditMessage(entry),
    metadata: entry.metadata ?? null,
    service: service ?? null,
    createdAt: new Date(),
  };
}
