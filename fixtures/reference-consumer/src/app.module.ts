import { defineModule } from 'glasswork/core';
import { InventoryModule } from './inventory/inventory.module.js';
import { InvitationsModule } from './invitations/invitations.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { EmailModule } from './platform/email.module.js';
import { JobsModule } from './platform/jobs.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { ReportingModule } from './reporting/reporting.module.js';

export const AppModule = defineModule({
  name: 'app',
  imports: [
    ProjectsModule,
    InvitationsModule,
    OrdersModule,
    InventoryModule,
    ReportingModule,
    JobsModule,
    EmailModule,
  ],
});
