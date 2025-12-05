import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTemplateRegistry } from '../../src/email/template-registry.js';
import { TemplatedEmailService } from '../../src/email/templated-email-service.js';
import { MockTransport } from '../../src/email/transports/mock-transport.js';

describe('TemplatedEmailService', () => {
  let transport: MockTransport;

  // Create a typed template registry
  const templates = createTemplateRegistry()
    .register(
      'welcome',
      (ctx: { name: string; activationLink: string }) => ({
        html: `<h1>Welcome ${ctx.name}!</h1><a href="${ctx.activationLink}">Activate</a>`,
        text: `Welcome ${ctx.name}! Activate: ${ctx.activationLink}`,
      }),
      { subject: 'Welcome to our app!' }
    )
    .register(
      'password-reset',
      (ctx: { name: string; resetLink: string }) => ({
        html: `<p>Hi ${ctx.name}, reset your password: <a href="${ctx.resetLink}">Reset</a></p>`,
        text: `Hi ${ctx.name}, reset your password: ${ctx.resetLink}`,
      })
      // Note: no default subject
    );

  beforeEach(() => {
    transport = new MockTransport();
  });

  describe('send', () => {
    it('should send templated email with context', async () => {
      const service = new TemplatedEmailService({
        config: { transport, from: 'noreply@example.com' },
        templates,
      });

      await service.send('welcome', {
        to: 'user@example.com',
        context: {
          name: 'Alice',
          activationLink: 'https://example.com/activate/123',
        },
      });

      expect(transport.lastEmail?.message.to).toBe('user@example.com');
      expect(transport.lastEmail?.message.html).toContain('Welcome Alice!');
      expect(transport.lastEmail?.message.html).toContain('https://example.com/activate/123');
    });

    it('should use default subject from template', async () => {
      const service = new TemplatedEmailService({
        config: { transport, from: 'noreply@example.com' },
        templates,
      });

      await service.send('welcome', {
        to: 'user@example.com',
        context: {
          name: 'Alice',
          activationLink: 'https://example.com/activate/123',
        },
      });

      expect(transport.lastEmail?.message.subject).toBe('Welcome to our app!');
    });

    it('should allow overriding subject', async () => {
      const service = new TemplatedEmailService({
        config: { transport, from: 'noreply@example.com' },
        templates,
      });

      await service.send('welcome', {
        to: 'user@example.com',
        subject: 'Custom Subject',
        context: {
          name: 'Alice',
          activationLink: 'https://example.com/activate/123',
        },
      });

      expect(transport.lastEmail?.message.subject).toBe('Custom Subject');
    });

    it('should throw when no subject provided and template has no default', async () => {
      const service = new TemplatedEmailService({
        config: { transport, from: 'noreply@example.com' },
        templates,
      });

      await expect(
        service.send('password-reset', {
          to: 'user@example.com',
          context: {
            name: 'Alice',
            resetLink: 'https://example.com/reset/123',
          },
        })
      ).rejects.toThrow(/No subject provided/);
    });

    it('should send to multiple recipients', async () => {
      const service = new TemplatedEmailService({
        config: { transport, from: 'noreply@example.com' },
        templates,
      });

      await service.send('welcome', {
        to: ['user1@example.com', 'user2@example.com'],
        context: {
          name: 'Team',
          activationLink: 'https://example.com/activate',
        },
      });

      expect(transport.lastEmail?.message.to).toEqual(['user1@example.com', 'user2@example.com']);
    });

    it('should support CC and BCC', async () => {
      const service = new TemplatedEmailService({
        config: { transport, from: 'noreply@example.com' },
        templates,
      });

      await service.send('welcome', {
        to: 'user@example.com',
        cc: 'cc@example.com',
        bcc: 'bcc@example.com',
        context: {
          name: 'Alice',
          activationLink: 'https://example.com/activate',
        },
      });

      expect(transport.lastEmail?.message.cc).toBe('cc@example.com');
      expect(transport.lastEmail?.message.bcc).toBe('bcc@example.com');
    });

    it('should override from address', async () => {
      const service = new TemplatedEmailService({
        config: { transport, from: 'default@example.com' },
        templates,
      });

      await service.send('welcome', {
        to: 'user@example.com',
        from: 'custom@example.com',
        context: {
          name: 'Alice',
          activationLink: 'https://example.com/activate',
        },
      });

      expect(transport.lastEmail?.message.from).toBe('custom@example.com');
    });

    it('should return message ID on success', async () => {
      const service = new TemplatedEmailService({
        config: { transport, from: 'noreply@example.com' },
        templates,
      });

      const result = await service.send('welcome', {
        to: 'user@example.com',
        context: {
          name: 'Alice',
          activationLink: 'https://example.com/activate',
        },
      });

      expect(result.messageId).toBeDefined();
      expect(result.success).toBe(true);
    });
  });

  describe('onSent hook', () => {
    it('should call onSent hook after successful send', async () => {
      const onSent = vi.fn();
      const service = new TemplatedEmailService({
        config: { transport, from: 'noreply@example.com' },
        templates,
        onSent,
      });

      await service.send('welcome', {
        to: 'user@example.com',
        context: {
          name: 'Alice',
          activationLink: 'https://example.com/activate',
        },
      });

      expect(onSent).toHaveBeenCalledTimes(1);
    });
  });

  describe('getTemplates', () => {
    it('should return the template registry', () => {
      const service = new TemplatedEmailService({
        config: { transport, from: 'noreply@example.com' },
        templates,
      });

      expect(service.getTemplates()).toBe(templates);
    });
  });

  describe('sendRaw (inherited)', () => {
    it('should still support raw email sending', async () => {
      const service = new TemplatedEmailService({
        config: { transport, from: 'noreply@example.com' },
        templates,
      });

      await service.sendRaw({
        to: 'user@example.com',
        subject: 'Raw Email',
        html: '<p>Raw content</p>',
      });

      expect(transport.lastEmail?.message.subject).toBe('Raw Email');
      expect(transport.lastEmail?.message.html).toBe('<p>Raw content</p>');
    });
  });
});
