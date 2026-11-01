import { defineModule } from 'glasswork/core';
import { InvitationsModule } from './invitations/invitations.module.js';
import { EmailModule } from './platform/email.module.js';
import { JobsModule } from './platform/jobs.module.js';
import { ProjectsModule } from './projects/projects.module.js';

export const AppModule = defineModule({
  name: 'app',
  imports: [ProjectsModule, InvitationsModule, JobsModule, EmailModule],
});
