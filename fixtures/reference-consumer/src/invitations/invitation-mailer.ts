import type { EmailService } from 'glasswork/email';
import type { Database } from '../platform/database.module.js';

/**
 * Skips stale versions and invitations already marked sent. Concurrent deliveries and a
 * crash after sending still need an idempotency protocol; this example does not provide one.
 */
export class InvitationMailer {
  readonly #prisma: Database;
  readonly #emailService: EmailService;

  constructor({ prisma, emailService }: { prisma: Database; emailService: EmailService }) {
    this.#prisma = prisma;
    this.#emailService = emailService;
  }

  async send(invitationId: string, version: number): Promise<void> {
    const invitation = await this.#prisma.invitation.findUnique({ where: { id: invitationId } });
    if (invitation?.status !== 'pending' || invitation.version !== version) return;

    await this.#emailService.sendRaw({
      to: invitation.email,
      subject: 'You are invited',
      html: `<p>You are invited to project ${invitation.projectId}.</p>`,
    });
    await this.#prisma.invitation.update({
      where: { id: invitationId },
      data: { status: 'sent', sentAt: new Date() },
    });
  }
}
