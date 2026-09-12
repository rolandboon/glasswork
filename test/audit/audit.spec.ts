import { describe, expect, it, vi } from 'vitest';
import { createAuditLogger, getAuditContext, resolveAuditRecord } from '../../src/audit/index.js';
import type { AuditRecordInput, AuditSink } from '../../src/audit/types.js';
import {
  getRequestActor,
  requestContextStorage,
  setRequestAuth,
} from '../../src/observability/request-context.js';

describe('audit context and request-context impersonation', () => {
  it('correctly sets regular authentication without impersonation', () => {
    requestContextStorage.run(
      { requestId: 'req-1', method: 'POST', path: '/polls', custom: {} },
      () => {
        setRequestAuth({ userId: 'user-admin', tenantId: 'tenant-1' });

        const actor = getRequestActor();
        expect(actor).toEqual({
          actorUserId: 'user-admin',
          effectiveUserId: undefined,
          isImpersonating: false,
          tenantId: 'tenant-1',
        });

        const auditCtx = getAuditContext();
        expect(auditCtx).toEqual({
          actorUserId: 'user-admin',
          effectiveUserId: undefined,
          isImpersonating: false,
          tenantId: 'tenant-1',
          requestId: 'req-1',
        });
      }
    );
  });

  it('correctly distinguishes actorUserId and effectiveUserId during impersonation', () => {
    requestContextStorage.run(
      { requestId: 'req-2', method: 'POST', path: '/polls', custom: {} },
      () => {
        setRequestAuth({
          userId: 'user-admin',
          tenantId: 'tenant-1',
          impersonatedBy: 'superadmin-99',
        });

        const actor = getRequestActor();
        expect(actor).toEqual({
          actorUserId: 'superadmin-99',
          effectiveUserId: 'user-admin',
          isImpersonating: true,
          tenantId: 'tenant-1',
        });

        const auditCtx = getAuditContext();
        expect(auditCtx).toEqual({
          actorUserId: 'superadmin-99',
          effectiveUserId: 'user-admin',
          isImpersonating: true,
          tenantId: 'tenant-1',
          requestId: 'req-2',
        });
      }
    );
  });
});

describe('resolveAuditRecord', () => {
  it('resolves audit record from ambient context', () => {
    requestContextStorage.run(
      { requestId: 'req-3', method: 'POST', path: '/polls', custom: {} },
      () => {
        setRequestAuth({
          userId: 'admin-1',
          tenantId: 'tenant-abc',
          impersonatedBy: 'super-1',
        });

        const record = resolveAuditRecord(
          {
            action: 'poll.create',
            subjectType: 'Poll',
            subjectId: 'poll-123',
            metadata: { title: 'Test' },
          },
          'polls'
        );

        expect(record).toMatchObject({
          actorUserId: 'super-1',
          effectiveUserId: 'admin-1',
          isImpersonating: true,
          tenantId: 'tenant-abc',
          requestId: 'req-3',
          action: 'poll.create',
          category: 'DATA',
          subjectType: 'Poll',
          subjectId: 'poll-123',
          message: 'Audit: poll.create on Poll poll-123',
          metadata: { title: 'Test' },
          service: 'polls',
        });
        expect(record.createdAt).toBeInstanceOf(Date);
      }
    );
  });

  it('allows explicit overrides for actor, effectiveUser, tenant, and message', () => {
    const record = resolveAuditRecord({
      action: 'admin.create',
      category: 'SECURITY',
      subjectType: 'User',
      subjectId: 'user-new',
      actorUserId: 'sys-cron',
      effectiveUserId: 'target-user',
      tenantId: 'tenant-xyz',
      message: 'Custom audit message',
    });

    expect(record).toMatchObject({
      actorUserId: 'sys-cron',
      effectiveUserId: 'target-user',
      isImpersonating: true,
      tenantId: 'tenant-xyz',
      requestId: null,
      action: 'admin.create',
      category: 'SECURITY',
      subjectType: 'User',
      subjectId: 'user-new',
      message: 'Custom audit message',
      service: null,
    });
  });

  it('throws error when no actorUserId can be resolved', () => {
    expect(() =>
      resolveAuditRecord({
        action: 'orphan.action',
        subjectType: 'Test',
      })
    ).toThrowError(/requires an actorUserId/);
  });
});

describe('createAuditLogger', () => {
  it('emits structured logs and dispatches to sink with transaction support', async () => {
    const recordedEntries: Array<{
      entry: AuditRecordInput;
      tx?: unknown;
    }> = [];
    const sink: AuditSink<{ txId: string }> = {
      record: async (entry, options) => {
        recordedEntries.push({ entry, tx: options?.tx });
      },
    };

    const infoMock = vi.fn();
    const loggerMock = {
      debug: vi.fn(),
      info: infoMock,
      warn: vi.fn(),
      error: vi.fn(),
    };

    const auditingLogger = createAuditLogger({
      sink,
      logger: loggerMock,
      service: 'PollService',
    });

    await requestContextStorage.run(
      { requestId: 'req-audit', method: 'PUT', path: '/polls/1', custom: {} },
      async () => {
        setRequestAuth({
          userId: 'admin-target',
          tenantId: 'tenant-cwz',
          impersonatedBy: 'superadmin-origin',
        });

        const tx = { txId: 'tx-456' };
        await auditingLogger.audit(
          'Poll deadline modified',
          {
            action: 'poll.update',
            subjectType: 'Poll',
            subjectId: 'poll-1',
            metadata: { deadlineAt: '2026-10-01T12:00:00.000Z' },
          },
          { tx }
        );

        expect(infoMock).toHaveBeenCalledTimes(1);
        expect(infoMock).toHaveBeenCalledWith('Poll deadline modified', {
          audit: true,
          action: 'poll.update',
          category: 'DATA',
          subjectType: 'Poll',
          subjectId: 'poll-1',
          actorUserId: 'superadmin-origin',
          effectiveUserId: 'admin-target',
          isImpersonating: true,
          tenantId: 'tenant-cwz',
          service: 'PollService',
          metadata: { deadlineAt: '2026-10-01T12:00:00.000Z' },
        });

        expect(recordedEntries).toHaveLength(1);
        expect(recordedEntries[0]?.tx).toBe(tx);
        expect(recordedEntries[0]?.entry).toMatchObject({
          actorUserId: 'superadmin-origin',
          effectiveUserId: 'admin-target',
          isImpersonating: true,
          tenantId: 'tenant-cwz',
          action: 'poll.update',
          subjectType: 'Poll',
          subjectId: 'poll-1',
        });
      }
    );
  });
});
