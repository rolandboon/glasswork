import { EmailService, type SendOptions } from './email-service.js';
import type { TemplateDefinition, TemplateRegistry } from './template-registry.js';
import type { EmailConfig, EmailResult, OnSentHook } from './types.js';

/**
 * Options for sending a templated email
 */
export interface SendTemplateOptions extends SendOptions {
  /** Recipient email address(es) */
  to: string | string[];
  /** Override the template's default subject */
  subject?: string;
  /** CC recipients */
  cc?: string | string[];
  /** BCC recipients */
  bcc?: string | string[];
}

/**
 * Templated email service with type-safe template sending
 *
 * Extends the base EmailService with template-aware sending methods.
 *
 * @example
 * ```typescript
 * // Create service with templates
 * const emailService = new TemplatedEmailService({
 *   config: { transport, from: 'noreply@example.com' },
 *   templates,
 * });
 *
 * // Send with full type safety
 * await emailService.send('welcome', {
 *   to: 'user@example.com',
 *   context: { name: 'Alice', verificationLink: '...' },
 * });
 * ```
 */
export class TemplatedEmailService<
  TTemplates extends Record<string, TemplateDefinition>,
> extends EmailService {
  private readonly templates: TemplateRegistry<TTemplates>;

  constructor(options: {
    config: EmailConfig;
    templates: TemplateRegistry<TTemplates>;
    onSent?: OnSentHook;
  }) {
    super(options.config, options.onSent);
    this.templates = options.templates;
  }

  /**
   * Sends a templated email
   *
   * @param template - Template name (type-safe)
   * @param options - Send options including recipient and context
   * @returns The send result with message ID
   */
  async send<TName extends keyof TTemplates & string>(
    template: TName,
    options: SendTemplateOptions & {
      context: TTemplates[TName] extends TemplateDefinition<infer TContext> ? TContext : never;
    }
  ): Promise<EmailResult> {
    // Render the template
    const { html, text } = this.templates.render(template, options.context);

    // Get default subject if not provided
    const subject = options.subject || this.templates.getSubject(template);
    if (!subject) {
      throw new Error(`No subject provided and template "${template}" has no default subject`);
    }

    // Send using the base service
    return this.sendRaw(
      {
        to: options.to,
        subject,
        html,
        text,
        cc: options.cc,
        bcc: options.bcc,
      },
      {
        from: options.from,
        replyTo: options.replyTo,
      }
    );
  }

  /**
   * Gets the template registry
   */
  getTemplates(): TemplateRegistry<TTemplates> {
    return this.templates;
  }
}
