import { defineModule } from 'glasswork/core';
import { EmailService, MockTransport } from 'glasswork/email';

/** Shared so tests can read what the API and the worker sent. */
export const outbox = new MockTransport();

export const EmailModule = defineModule({
  name: 'email',
  providers: [
    {
      provide: 'emailService',
      useFactory: () => new EmailService({ from: 'noreply@example.com', transport: outbox }),
    },
  ],
  exports: ['emailService'],
});
