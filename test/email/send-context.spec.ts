import { describe, expect, it } from 'vitest';
import { createTemplateRegistry } from '../../src/email/template-registry.js';
import { TemplatedEmailService } from '../../src/email/templated-email-service.js';
import { MockTransport } from '../../src/email/transports/mock-transport.js';
import type { EmailSendContext } from '../../src/email/types.js';

describe('email send context', () => {
  it('keeps templates and correlation metadata isolated during concurrent sends', async () => {
    const transport = new MockTransport();
    const received = new Map<string, EmailSendContext>();
    const templates = createTemplateRegistry()
      .register('welcome', () => ({ html: '<p>Welcome</p>', text: 'Welcome' }), {
        subject: 'Welcome',
      })
      .register('reset', () => ({ html: '<p>Reset</p>', text: 'Reset' }), {
        subject: 'Reset',
      });
    const service = new TemplatedEmailService({
      config: { transport, from: 'noreply@example.com' },
      templates,
      onSent: async (_result, message, context) => {
        await Promise.resolve();
        received.set(message.subject, context);
      },
    });

    await Promise.all([
      service.send('welcome', { to: 'a@example.com', context: {}, metadata: { reference: 'a' } }),
      service.send('reset', { to: 'b@example.com', context: {}, metadata: { reference: 'b' } }),
      service.sendRaw({ to: 'c@example.com', subject: 'Direct', html: '<p>Direct</p>' }),
    ]);

    expect(received.get('Welcome')).toEqual({ template: 'welcome', metadata: { reference: 'a' } });
    expect(received.get('Reset')).toEqual({ template: 'reset', metadata: { reference: 'b' } });
    expect(received.get('Direct')?.template).toBeUndefined();
    expect(transport.sentEmails.map(({ message }) => 'metadata' in message)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('does not record a successful send when the transport fails', async () => {
    const transport = new MockTransport();
    transport.simulateFailure();
    const received: EmailSendContext[] = [];
    const service = new TemplatedEmailService({
      config: { transport, from: 'noreply@example.com' },
      templates: createTemplateRegistry(),
      onSent: (_result, _message, context) => {
        received.push(context);
      },
    });

    await expect(
      service.sendRaw({ to: 'a@example.com', subject: 'Direct', html: '<p>Direct</p>' })
    ).rejects.toThrow('Mock transport failure');
    expect(received).toEqual([]);
  });
});
