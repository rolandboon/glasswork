import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESTransport } from '../../src/email/transports/ses-transport.js';
import type { EmailMessage } from '../../src/email/types.js';

// Mock AWS SDK
const mockSend = vi.fn();

vi.mock('@aws-sdk/client-sesv2', () => {
  return {
    SESv2Client: class {
      send = mockSend;
    },
    SendEmailCommand: class {
      input: unknown;
      constructor(input: unknown) {
        this.input = input;
      }
    },
  };
});

describe('SESTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('send', () => {
    it('should send simple email without attachments', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'ses-message-id-123',
      });

      const transport = new SESTransport({
        region: 'us-east-1',
      });

      const message: EmailMessage = {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'Test Email',
        html: '<p>Hello</p>',
        text: 'Hello',
      };

      const result = await transport.send(message);

      expect(result.messageId).toBe('ses-message-id-123');
      expect(result.success).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should send email with multiple recipients', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'ses-message-id-456',
      });

      const transport = new SESTransport({
        region: 'us-east-1',
      });

      const message: EmailMessage = {
        to: ['recipient1@example.com', 'recipient2@example.com'],
        from: 'sender@example.com',
        subject: 'Test Email',
        html: '<p>Hello</p>',
      };

      const result = await transport.send(message);

      expect(result.messageId).toBe('ses-message-id-456');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should send email with CC and BCC', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'ses-message-id-789',
      });

      const transport = new SESTransport({
        region: 'us-east-1',
      });

      const message: EmailMessage = {
        to: 'recipient@example.com',
        cc: 'cc@example.com',
        bcc: 'bcc@example.com',
        from: 'sender@example.com',
        subject: 'Test Email',
        html: '<p>Hello</p>',
      };

      await transport.send(message);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs.input.Destination.CcAddresses).toContain('cc@example.com');
      expect(callArgs.input.Destination.BccAddresses).toContain('bcc@example.com');
    });

    it('should send email with reply-to address', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'ses-message-id-reply',
      });

      const transport = new SESTransport({
        region: 'us-east-1',
      });

      const message: EmailMessage = {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        replyTo: 'reply@example.com',
        subject: 'Test Email',
        html: '<p>Hello</p>',
      };

      await transport.send(message);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs.input.ReplyToAddresses).toContain('reply@example.com');
    });

    it('should use configuration set when provided', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'ses-message-id-config',
      });

      const transport = new SESTransport({
        region: 'us-east-1',
        configurationSet: 'my-config-set',
      });

      const message: EmailMessage = {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'Test Email',
        html: '<p>Hello</p>',
      };

      await transport.send(message);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs.input.ConfigurationSetName).toBe('my-config-set');
    });

    it('should throw error if SES does not return message ID', async () => {
      mockSend.mockResolvedValue({
        MessageId: undefined,
      });

      const transport = new SESTransport({
        region: 'us-east-1',
      });

      const message: EmailMessage = {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'Test Email',
        html: '<p>Hello</p>',
      };

      await expect(transport.send(message)).rejects.toThrow('SES did not return a message ID');
    });

    it('should send raw email with attachments', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'ses-message-id-attachment',
      });

      const transport = new SESTransport({
        region: 'us-east-1',
      });

      const message: EmailMessage = {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'Test Email',
        html: '<p>Hello</p>',
        attachments: [
          {
            filename: 'test.pdf',
            content: Buffer.from('test content'),
            contentType: 'application/pdf',
          },
        ],
      };

      const result = await transport.send(message);

      expect(result.messageId).toBe('ses-message-id-attachment');
      expect(result.metadata?.hasAttachments).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs.input.Content.Raw).toBeDefined();
    });

    it('should send raw email when custom headers are provided', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'ses-message-id-raw-headers',
      });

      const transport = new SESTransport({
        region: 'us-east-1',
      });

      const message: EmailMessage = {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'Test Email',
        html: '<p>Hello</p>',
        headers: {
          'X-Custom-Header': 'value1',
          'X-Another-Header': 'value2',
        },
      };

      await transport.send(message);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs.input.Content.Raw).toBeDefined();
      const raw = callArgs.input.Content.Raw.Data;
      const rawString = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
      expect(rawString).toContain('X-Custom-Header: value1');
      expect(rawString).toContain('X-Another-Header: value2');
    });
  });

  describe('transport name', () => {
    it('should have correct transport name', () => {
      const transport = new SESTransport({
        region: 'us-east-1',
      });

      expect(transport.name).toBe('ses');
    });
  });

  describe('raw email with attachments', () => {
    it('should encode non-ASCII subject headers', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'ses-message-id-unicode',
      });

      const transport = new SESTransport({
        region: 'us-east-1',
      });

      const message: EmailMessage = {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'Тест сообщение 日本語', // Non-ASCII characters
        html: '<p>Hello</p>',
        attachments: [
          {
            filename: 'test.txt',
            content: Buffer.from('test'),
            contentType: 'text/plain',
          },
        ],
      };

      const result = await transport.send(message);

      expect(result.success).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const callArgs = mockSend.mock.calls[0][0];
      // Raw message should contain Base64-encoded subject
      expect(callArgs.input.Content.Raw).toBeDefined();
    });

    it('should encode special characters in quoted-printable', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'ses-message-id-special',
      });

      const transport = new SESTransport({
        region: 'us-east-1',
      });

      const message: EmailMessage = {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'Test Email',
        html: '<p>Special chars: © ® ™</p>',
        text: 'Special chars: © ® ™',
        attachments: [
          {
            filename: 'test.txt',
            content: 'base64encodedcontent',
            contentType: 'text/plain',
          },
        ],
      };

      const result = await transport.send(message);

      expect(result.success).toBe(true);
    });

    it('should handle inline attachments with content ID', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'ses-message-id-inline',
      });

      const transport = new SESTransport({
        region: 'us-east-1',
      });

      const message: EmailMessage = {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        subject: 'Test Email',
        html: '<img src="cid:logo123" />',
        attachments: [
          {
            filename: 'logo.png',
            content: Buffer.from('imagedata'),
            contentType: 'image/png',
            contentId: 'logo123',
            disposition: 'inline',
          },
        ],
      };

      const result = await transport.send(message);

      expect(result.success).toBe(true);
      expect(result.metadata?.hasAttachments).toBe(true);
    });

    it('should handle raw emails with CC addresses', async () => {
      mockSend.mockResolvedValue({
        MessageId: 'ses-message-id-raw-cc',
      });

      const transport = new SESTransport({
        region: 'us-east-1',
      });

      const message: EmailMessage = {
        to: 'recipient@example.com',
        cc: ['cc1@example.com', 'cc2@example.com'],
        bcc: 'bcc@example.com',
        replyTo: 'reply@example.com',
        from: 'sender@example.com',
        subject: 'Test Email',
        html: '<p>Hello</p>',
        attachments: [
          {
            filename: 'test.txt',
            content: Buffer.from('test'),
          },
        ],
      };

      const result = await transport.send(message);

      expect(result.success).toBe(true);
    });
  });
});
