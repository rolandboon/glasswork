import type { EmailMessage, EmailResult, EmailTransport } from '../types.js';

/**
 * Stored email for inspection in tests
 */
export interface StoredEmail {
  /** The original message */
  message: EmailMessage;
  /** The result returned */
  result: EmailResult;
  /** Timestamp when the email was "sent" */
  sentAt: Date;
}

/**
 * Mock email transport for testing
 *
 * Stores all sent emails in memory for inspection.
 * Does not actually send any emails.
 *
 * @example
 * ```typescript
 * import { MockTransport } from '@glasswork/email/testing';
 *
 * const transport = new MockTransport();
 * const emailService = new EmailService({ transport, from: 'test@example.com' });
 *
 * await emailService.sendRaw({
 *   to: 'user@example.com',
 *   subject: 'Test',
 *   html: '<p>Hello</p>',
 * });
 *
 * expect(transport.sentEmails).toHaveLength(1);
 * expect(transport.sentEmails[0].message.to).toBe('user@example.com');
 * ```
 */
export class MockTransport implements EmailTransport {
  readonly name = 'mock';

  /** All emails that have been "sent" */
  readonly sentEmails: StoredEmail[] = [];

  /** Counter for generating message IDs */
  private messageIdCounter = 0;

  /** Whether to simulate failures */
  private shouldFail = false;
  private failureError: Error | null = null;

  /**
   * Sends an email (stores it in memory)
   */
  async send(message: EmailMessage): Promise<EmailResult> {
    if (this.shouldFail) {
      const error = this.failureError || new Error('Mock transport failure');
      this.shouldFail = false;
      this.failureError = null;
      throw error;
    }

    const result: EmailResult = {
      messageId: `mock-${++this.messageIdCounter}-${Date.now()}`,
      success: true,
      metadata: {
        provider: 'mock',
      },
    };

    this.sentEmails.push({
      message,
      result,
      sentAt: new Date(),
    });

    return result;
  }

  /**
   * Clears all stored emails
   */
  clear(): void {
    this.sentEmails.length = 0;
    this.messageIdCounter = 0;
  }

  /**
   * Makes the next send() call fail with an error
   */
  simulateFailure(error?: Error): void {
    this.shouldFail = true;
    this.failureError = error || null;
  }

  /**
   * Gets the last sent email
   */
  get lastEmail(): StoredEmail | undefined {
    return this.sentEmails[this.sentEmails.length - 1];
  }

  /**
   * Gets emails sent to a specific address
   */
  getEmailsTo(address: string): StoredEmail[] {
    return this.sentEmails.filter((email) => {
      const to = email.message.to;
      if (Array.isArray(to)) {
        return to.includes(address);
      }
      return to === address;
    });
  }

  /**
   * Gets emails with a specific subject
   */
  getEmailsWithSubject(subject: string): StoredEmail[] {
    return this.sentEmails.filter((email) => email.message.subject === subject);
  }

  /**
   * Checks if any email was sent to the given address
   */
  hasSentTo(address: string): boolean {
    return this.getEmailsTo(address).length > 0;
  }
}
