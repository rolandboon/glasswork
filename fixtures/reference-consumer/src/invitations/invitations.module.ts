import type { AuthContext } from 'glasswork/auth';
import { defineModule } from 'glasswork/core';
import { createRoutes } from 'glasswork/http';
import { createRLSMiddleware } from 'glasswork/rls';
import * as v from 'valibot';
import { AuditModule } from '../platform/audit.module.js';
import { type AppUser, type AuthMiddlewareFactory, AuthModule } from '../platform/auth.module.js';
import { DatabaseModule } from '../platform/database.module.js';
import { EmailModule } from '../platform/email.module.js';
import { JobsModule } from '../platform/jobs.module.js';
import { InvitationMailer } from './invitation-mailer.js';
import { InvitationsService } from './invitations.service.js';
import { sendInvitationJob } from './send-invitation.job.js';

const InviteDto = v.object({
  projectId: v.string(),
  email: v.pipe(v.string(), v.email()),
});
const InvitationDto = v.object({ id: v.string(), projectId: v.string(), status: v.string() });

interface InvitationServices {
  invitationsService: InvitationsService;
  requireAuth: AuthMiddlewareFactory;
}

const invitationRoutes = createRoutes<InvitationServices, AuthContext<AppUser>>(
  (router, services, route) => {
    router.post(
      '/',
      ...route({
        operationId: 'createInvitation',
        summary: 'Invite someone to a project',
        middleware: [services.requireAuth(), createRLSMiddleware()],
        authorize: { action: 'create', subject: 'Invitation' },
        body: InviteDto,
        responses: { 202: InvitationDto },
        handler: async ({ body, user, context }) => {
          const invitation = await services.invitationsService.invite({
            tenantId: user.tenantId,
            actorUserId: user.id,
            projectId: body.projectId,
            email: body.email,
          });
          context.status(202);
          return invitation;
        },
      })
    );
  }
);

export const InvitationsModule = defineModule({
  name: 'invitations',
  basePath: 'invitations',
  imports: [DatabaseModule, AuditModule, AuthModule, EmailModule, JobsModule],
  // InvitationMailer stays private: the job resolves it in this module.
  providers: [InvitationsService, InvitationMailer],
  routes: invitationRoutes,
  jobs: [sendInvitationJob],
});
