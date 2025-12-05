import { beforeEach, describe, expect, it } from 'vitest';
import { MockTransport } from '../../src/email/transports/mock-transport.js';
import type { EmailMessage } from '../../src/email/types.js';

describe('MockTransport', () => {
  let transport: MockTransport;

  beforeEach(() => {
    transport = new MockTransport();
  });

  describe('send', () => {
    it('should store sent emails', async () => {
      const message: EmailMessage = {
        to: 'user@example.com',
        subject: 'Test Subject',
        html: '<p>Hello</p>',
        from: 'sender@example.com',
      };

      const result = await transport.send(message);

      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^mock-\d+-\d+$/);
      expect(transport.sentEmails).toHaveLength(1);
      expect(transport.sentEmails[0].message).toEqual(message);
    });

    it('should generate unique message IDs', async () => {
      const message: EmailMessage = {
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
        from: 'sender@example.com',
      };

      const result1 = await transport.send(message);
      const result2 = await transport.send(message);

      expect(result1.messageId).not.toBe(result2.messageId);
    });

    it('should store multiple emails', async () => {
      await transport.send({
        to: 'user1@example.com',
        subject: 'Test 1',
        html: '<p>Hello 1</p>',
        from: 'sender@example.com',
      });
      await transport.send({
        to: 'user2@example.com',
        subject: 'Test 2',
        html: '<p>Hello 2</p>',
        from: 'sender@example.com',
      });

      expect(transport.sentEmails).toHaveLength(2);
    });
  });

  describe('simulateFailure', () => {
    it('should make next send fail', async () => {
      transport.simulateFailure();

      await expect(
        transport.send({
          to: 'user@example.com',
          subject: 'Test',
          html: '<p>Hello</p>',
          from: 'sender@example.com',
        })
      ).rejects.toThrow('Mock transport failure');
    });

    it('should use custom error when provided', async () => {
      transport.simulateFailure(new Error('Custom error'));

      await expect(
        transport.send({
          to: 'user@example.com',
          subject: 'Test',
          html: '<p>Hello</p>',
          from: 'sender@example.com',
        })
      ).rejects.toThrow('Custom error');
    });

    it('should only fail once', async () => {
      transport.simulateFailure();

      await expect(
        transport.send({
          to: 'user@example.com',
          subject: 'Test 1',
          html: '<p>Hello</p>',
          from: 'sender@example.com',
        })
      ).rejects.toThrow();

      // Second send should succeed
      const result = await transport.send({
        to: 'user@example.com',
        subject: 'Test 2',
        html: '<p>Hello</p>',
        from: 'sender@example.com',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('clear', () => {
    it('should clear all stored emails', async () => {
      await transport.send({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
        from: 'sender@example.com',
      });

      transport.clear();

      expect(transport.sentEmails).toHaveLength(0);
    });

    it('should reset message ID counter', async () => {
      await transport.send({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
        from: 'sender@example.com',
      });

      transport.clear();

      const result = await transport.send({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
        from: 'sender@example.com',
      });

      expect(result.messageId).toMatch(/^mock-1-\d+$/);
    });
  });

  describe('lastEmail', () => {
    it('should return undefined when no emails sent', () => {
      expect(transport.lastEmail).toBeUndefined();
    });

    it('should return the last sent email', async () => {
      await transport.send({
        to: 'user1@example.com',
        subject: 'Test 1',
        html: '<p>Hello 1</p>',
        from: 'sender@example.com',
      });
      await transport.send({
        to: 'user2@example.com',
        subject: 'Test 2',
        html: '<p>Hello 2</p>',
        from: 'sender@example.com',
      });

      expect(transport.lastEmail?.message.to).toBe('user2@example.com');
    });
  });

  describe('getEmailsTo', () => {
    it('should find emails sent to a specific address', async () => {
      await transport.send({
        to: 'user1@example.com',
        subject: 'Test 1',
        html: '<p>Hello</p>',
        from: 'sender@example.com',
      });
      await transport.send({
        to: 'user2@example.com',
        subject: 'Test 2',
        html: '<p>Hello</p>',
        from: 'sender@example.com',
      });
      await transport.send({
        to: 'user1@example.com',
        subject: 'Test 3',
        html: '<p>Hello</p>',
        from: 'sender@example.com',
      });

      const emails = transport.getEmailsTo('user1@example.com');

      expect(emails).toHaveLength(2);
      expect(emails[0].message.subject).toBe('Test 1');
      expect(emails[1].message.subject).toBe('Test 3');
    });

    it('should find emails when recipient is in array', async () => {
      await transport.send({
        to: ['user1@example.com', 'user2@example.com'],
        subject: 'Test',
        html: '<p>Hello</p>',
        from: 'sender@example.com',
      });

      const emails = transport.getEmailsTo('user1@example.com');

      expect(emails).toHaveLength(1);
    });
  });

  describe('getEmailsWithSubject', () => {
    it('should find emails with matching subject', async () => {
      await transport.send({
        to: 'user@example.com',
        subject: 'Welcome',
        html: '<p>Hello</p>',
        from: 'sender@example.com',
      });
      await transport.send({
        to: 'user@example.com',
        subject: 'Reset Password',
        html: '<p>Hello</p>',
        from: 'sender@example.com',
      });

      const emails = transport.getEmailsWithSubject('Welcome');

      expect(emails).toHaveLength(1);
    });
  });

  describe('hasSentTo', () => {
    it('should return true when email was sent to address', async () => {
      await transport.send({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
        from: 'sender@example.com',
      });

      expect(transport.hasSentTo('user@example.com')).toBe(true);
    });

    it('should return false when no email was sent to address', async () => {
      await transport.send({
        to: 'other@example.com',
        subject: 'Test',
        html: '<p>Hello</p>',
        from: 'sender@example.com',
      });

      expect(transport.hasSentTo('user@example.com')).toBe(false);
    });
  });

  describe('name', () => {
    it('should return "mock"', () => {
      expect(transport.name).toBe('mock');
    });
  });
});
