import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import {
  EmailConfigSchema,
  MockTransportConfigSchema,
  SESTransportConfigSchema,
  SMTPTransportConfigSchema,
  validateEmailConfig,
} from '../../src/email/config.js';

describe('Email Configuration Schemas', () => {
  describe('SESTransportConfigSchema', () => {
    it('should validate valid SES config', () => {
      const config = {
        type: 'ses' as const,
        region: 'eu-west-1',
        configurationSet: 'my-config-set',
      };

      const result = v.parse(SESTransportConfigSchema, config);

      expect(result.type).toBe('ses');
      expect(result.region).toBe('eu-west-1');
      expect(result.configurationSet).toBe('my-config-set');
    });

    it('should allow optional configurationSet', () => {
      const config = {
        type: 'ses' as const,
        region: 'us-east-1',
      };

      const result = v.parse(SESTransportConfigSchema, config);

      expect(result.configurationSet).toBeUndefined();
    });

    it('should reject empty region', () => {
      const config = {
        type: 'ses' as const,
        region: '',
      };

      expect(() => v.parse(SESTransportConfigSchema, config)).toThrow();
    });
  });

  describe('SMTPTransportConfigSchema', () => {
    it('should validate valid SMTP config', () => {
      const config = {
        type: 'smtp' as const,
        host: 'smtp.example.com',
        port: 587,
        secure: true,
        auth: {
          user: 'user@example.com',
          pass: 'password123',
        },
      };

      const result = v.parse(SMTPTransportConfigSchema, config);

      expect(result.type).toBe('smtp');
      expect(result.host).toBe('smtp.example.com');
      expect(result.port).toBe(587);
      expect(result.auth?.user).toBe('user@example.com');
    });

    it('should allow optional auth', () => {
      const config = {
        type: 'smtp' as const,
        host: 'smtp.example.com',
        port: 25,
      };

      const result = v.parse(SMTPTransportConfigSchema, config);

      expect(result.auth).toBeUndefined();
    });

    it('should reject invalid port', () => {
      const config = {
        type: 'smtp' as const,
        host: 'smtp.example.com',
        port: 99999,
      };

      expect(() => v.parse(SMTPTransportConfigSchema, config)).toThrow();
    });
  });

  describe('MockTransportConfigSchema', () => {
    it('should validate mock config', () => {
      const config = {
        type: 'mock' as const,
      };

      const result = v.parse(MockTransportConfigSchema, config);

      expect(result.type).toBe('mock');
    });
  });

  describe('EmailConfigSchema', () => {
    it('should validate complete email config with SES', () => {
      const config = {
        from: 'noreply@example.com',
        replyTo: 'support@example.com',
        transport: {
          type: 'ses' as const,
          region: 'eu-west-1',
        },
      };

      const result = v.parse(EmailConfigSchema, config);

      expect(result.from).toBe('noreply@example.com');
      expect(result.replyTo).toBe('support@example.com');
      expect(result.transport.type).toBe('ses');
    });

    it('should validate email config with mock transport', () => {
      const config = {
        from: 'test@example.com',
        transport: {
          type: 'mock' as const,
        },
      };

      const result = v.parse(EmailConfigSchema, config);

      expect(result.from).toBe('test@example.com');
      expect(result.transport.type).toBe('mock');
    });

    it('should reject invalid from email', () => {
      const config = {
        from: 'not-an-email',
        transport: {
          type: 'mock' as const,
        },
      };

      expect(() => v.parse(EmailConfigSchema, config)).toThrow();
    });

    it('should reject invalid replyTo email', () => {
      const config = {
        from: 'valid@example.com',
        replyTo: 'not-an-email',
        transport: {
          type: 'mock' as const,
        },
      };

      expect(() => v.parse(EmailConfigSchema, config)).toThrow();
    });
  });

  describe('validateEmailConfig', () => {
    it('should return parsed config for valid input', () => {
      const config = {
        from: 'test@example.com',
        transport: {
          type: 'mock' as const,
        },
      };

      const result = validateEmailConfig(config);

      expect(result.from).toBe('test@example.com');
    });

    it('should throw for invalid input', () => {
      expect(() => validateEmailConfig({ from: 'invalid' })).toThrow();
    });
  });
});
