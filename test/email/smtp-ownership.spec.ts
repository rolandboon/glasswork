import { describe, expect, it, vi } from 'vitest';
import { SmtpTransport } from '../../src/email/transports/smtp-transport.js';

const mailer = vi.hoisted(() => ({
  close: vi.fn(),
  sendMail: vi.fn(async () => ({ messageId: 'message' })),
}));
vi.mock('nodemailer', () => ({ createTransport: () => mailer }));

describe('owned SMTP transporter', () => {
  it('closes an owned transporter even while it is being initialized', async () => {
    const transport = new SmtpTransport({ host: 'localhost' });
    const sending = transport.send({ to: 'a@example.com', subject: 'Hi', text: 'Hi' });
    await Promise.all([sending, transport.close()]);
    await transport.close();
    expect(mailer.close).toHaveBeenCalledTimes(1);
  });
});
