import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailService } from '../../src/email/email-service.js';
import { MockTransport } from '../../src/email/transports/mock-transport.js';

describe('EmailService', () => {
  let transport: MockTransport;
  let service: EmailService;

  beforeEach(() => {
    transport = new MockTransport();
    service = new EmailService({
      transport,
      from: 'default@example.com',
      replyTo: 'reply@example.com',
    });
  });

  describe('sendRaw', () => {
    it('should send email with default from address', async () => {
      await service.sendRaw({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      });

      expect(transport.lastEmail?.message.from).toBe('default@example.com');
    });

    it('should send email with default reply-to address', async () => {
      await service.sendRaw({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      });

      expect(transport.lastEmail?.message.replyTo).toBe('reply@example.com');
    });

    it('should override from address with message from', async () => {
      await service.sendRaw({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
        from: 'custom@example.com',
      });

      expect(transport.lastEmail?.message.from).toBe('custom@example.com');
    });

    it('should override from address with options', async () => {
      await service.sendRaw(
        {
          to: 'user@example.com',
          subject: 'Test',
          html: '<p>Hello</p>',
        },
        { from: 'options@example.com' }
      );

      expect(transport.lastEmail?.message.from).toBe('options@example.com');
    });

    it('should auto-generate plain text from HTML', async () => {
      await service.sendRaw({
        to: 'user@example.com',
        subject: 'Test',
        html: '<h1>Hello</h1><p>World</p>',
      });

      expect(transport.lastEmail?.message.text).toContain('Hello');
      expect(transport.lastEmail?.message.text).toContain('World');
    });

    it('should use provided plain text when given', async () => {
      await service.sendRaw({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>HTML</p>',
        text: 'Plain text',
      });

      expect(transport.lastEmail?.message.text).toBe('Plain text');
    });

    it('should return message ID on success', async () => {
      const result = await service.sendRaw({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      });

      expect(result.messageId).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should propagate transport errors', async () => {
      transport.simulateFailure(new Error('Send failed'));

      await expect(
        service.sendRaw({
          to: 'user@example.com',
          subject: 'Test',
          html: '<p>Hello</p>',
        })
      ).rejects.toThrow('Send failed');
    });
  });

  describe('onSent hook', () => {
    it('should call onSent hook after successful send', async () => {
      const onSent = vi.fn();
      const serviceWithHook = new EmailService(
        {
          transport,
          from: 'default@example.com',
        },
        onSent
      );

      await serviceWithHook.sendRaw({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      });

      expect(onSent).toHaveBeenCalledTimes(1);
      expect(onSent).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, messageId: expect.any(String) }),
        expect.objectContaining({ to: 'user@example.com' })
      );
    });

    it('should not throw when onSent hook fails', async () => {
      const onSent = vi.fn().mockRejectedValue(new Error('Hook failed'));
      const serviceWithHook = new EmailService(
        {
          transport,
          from: 'default@example.com',
        },
        onSent
      );

      // Should not throw
      const result = await serviceWithHook.sendRaw({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('transportName', () => {
    it('should return the transport name', () => {
      expect(service.transportName).toBe('mock');
    });
  });

  describe('HTML to text conversion', () => {
    it('should convert br tags to newlines', async () => {
      await service.sendRaw({
        to: 'user@example.com',
        subject: 'Test',
        html: 'Line 1<br>Line 2<br/>Line 3',
      });

      expect(transport.lastEmail?.message.text).toBe('Line 1\nLine 2\nLine 3');
    });

    it('should convert block elements to newlines', async () => {
      await service.sendRaw({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Paragraph 1</p><p>Paragraph 2</p>',
      });

      const text = transport.lastEmail?.message.text;
      expect(text).toContain('Paragraph 1');
      expect(text).toContain('Paragraph 2');
    });

    it('should convert list items', async () => {
      await service.sendRaw({
        to: 'user@example.com',
        subject: 'Test',
        html: '<ul><li>Item 1</li><li>Item 2</li></ul>',
      });

      const text = transport.lastEmail?.message.text;
      expect(text).toContain('• Item 1');
      expect(text).toContain('• Item 2');
    });

    it('should decode HTML entities', async () => {
      await service.sendRaw({
        to: 'user@example.com',
        subject: 'Test',
        html: '&lt;tag&gt; &amp; &quot;quotes&quot;',
      });

      const text = transport.lastEmail?.message.text;
      expect(text).toContain('<tag>');
      expect(text).toContain('&');
      expect(text).toContain('"quotes"');
    });

    it('should remove style and script tags', async () => {
      await service.sendRaw({
        to: 'user@example.com',
        subject: 'Test',
        html: '<style>.foo { color: red; }</style><script>alert("hi")</script><p>Content</p>',
      });

      const text = transport.lastEmail?.message.text;
      expect(text).not.toContain('.foo');
      expect(text).not.toContain('alert');
      expect(text).toContain('Content');
    });
  });
});
