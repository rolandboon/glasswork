import { randomUUID } from 'node:crypto';
import type { AuditingLogger } from 'glasswork/audit';
import { NotFoundException } from 'glasswork/http';
import type { JobService } from 'glasswork/jobs';
import type { Database, Transaction } from '../platform/database.module.js';
import { sendInvitationJob } from './send-invitation.job.js';

export interface InviteInput {
  tenantId: string;
  actorUserId: string;
  projectId: string;
  email: string;
}

/**
 * Claims the invitation and records the audit entry in one transaction, then enqueues the
 * delivery. A crash between commit and enqueue leaves a pending invitation to resend.
 */
export class InvitationsService {
  readonly #prisma: Database;
  readonly #audit: AuditingLogger<Transaction>;
  readonly #jobService: JobService;

  constructor({
    prisma,
    audit,
    jobService,
  }: {
    prisma: Database;
    audit: AuditingLogger<Transaction>;
    jobService: JobService;
  }) {
    this.#prisma = prisma;
    this.#audit = audit;
    this.#jobService = jobService;
  }

  async invite(input: InviteInput) {
    const invitation = await this.#prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({ where: { id: input.projectId } });
      if (!project) throw new NotFoundException('Project not found');

      const created = await tx.invitation.create({
        data: {
          id: randomUUID(),
          tenantId: input.tenantId,
          projectId: input.projectId,
          email: input.email,
          status: 'pending',
        },
      });
      await this.#audit.audit(
        'Invitation created',
        {
          action: 'invitation.create',
          subjectType: 'Invitation',
          subjectId: created.id,
          actorUserId: input.actorUserId,
          tenantId: input.tenantId,
        },
        { tx }
      );
      return created;
    });

    await this.#jobService.enqueue(sendInvitationJob, {
      invitationId: invitation.id,
      tenantId: input.tenantId,
      version: invitation.version,
      requestedAt: new Date().toISOString(),
    });
    return invitation;
  }
}
