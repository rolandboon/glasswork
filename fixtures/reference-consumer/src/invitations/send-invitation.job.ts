import { defineJob } from 'glasswork/jobs';
import { runWithTenant } from 'glasswork/rls';
import * as v from 'valibot';
import type { InvitationMailer } from './invitation-mailer.js';

/**
 * Payloads travel as JSON: the timestamp is an ISO string that the schema turns into a
 * Date, and the version lets a later send skip an invitation that changed meanwhile.
 */
const SendInvitationPayload = v.object({
  invitationId: v.string(),
  tenantId: v.string(),
  version: v.number(),
  requestedAt: v.pipe(
    v.string(),
    v.isoTimestamp(),
    v.transform((value) => new Date(value))
  ),
});

/** A private provider of the invitations module, also when the job runs in-process. */
interface SendInvitationServices {
  invitationMailer: InvitationMailer;
}

export const sendInvitationJob = defineJob<typeof SendInvitationPayload, SendInvitationServices>({
  name: 'send-invitation',
  schema: SendInvitationPayload,
  handler: async ({ invitationId, tenantId, version }, { services }) => {
    await runWithTenant({ tenantId }, () => services.invitationMailer.send(invitationId, version));
  },
});
