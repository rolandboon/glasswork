import { describe, expect, it } from 'vitest';
import {
  createTemplateRegistry,
  type TemplateRegistry,
} from '../../src/email/template-registry.js';

describe('TemplateRegistry', () => {
  describe('register', () => {
    it('should register a template', () => {
      const registry = createTemplateRegistry().register('welcome', (ctx: { name: string }) => ({
        html: `<p>Hello ${ctx.name}</p>`,
        text: `Hello ${ctx.name}`,
      }));

      expect(registry.has('welcome')).toBe(true);
      expect(registry.size).toBe(1);
    });

    it('should support chaining multiple registrations', () => {
      const registry = createTemplateRegistry()
        .register('welcome', (ctx: { name: string }) => ({
          html: `<p>Hello ${ctx.name}</p>`,
          text: `Hello ${ctx.name}`,
        }))
        .register('goodbye', (ctx: { name: string }) => ({
          html: `<p>Goodbye ${ctx.name}</p>`,
          text: `Goodbye ${ctx.name}`,
        }));

      expect(registry.has('welcome')).toBe(true);
      expect(registry.has('goodbye')).toBe(true);
      expect(registry.size).toBe(2);
    });

    it('should store default subject', () => {
      const registry = createTemplateRegistry().register(
        'welcome',
        (ctx: { name: string }) => ({
          html: `<p>Hello ${ctx.name}</p>`,
          text: `Hello ${ctx.name}`,
        }),
        { subject: 'Welcome!' }
      );

      expect(registry.getSubject('welcome')).toBe('Welcome!');
    });
  });

  describe('render', () => {
    it('should render template with context', () => {
      const registry = createTemplateRegistry().register('welcome', (ctx: { name: string }) => ({
        html: `<p>Hello ${ctx.name}</p>`,
        text: `Hello ${ctx.name}`,
      }));

      const result = registry.render('welcome', { name: 'Alice' });

      expect(result.html).toBe('<p>Hello Alice</p>');
      expect(result.text).toBe('Hello Alice');
    });

    it('should throw for unknown template', () => {
      const registry = createTemplateRegistry();

      expect(() => {
        (registry as TemplateRegistry<{ unknown: never }>).render('unknown', {});
      }).toThrow('Template "unknown" not found in registry');
    });
  });

  describe('getSubject', () => {
    it('should return default subject when set', () => {
      const registry = createTemplateRegistry().register(
        'welcome',
        () => ({ html: '', text: '' }),
        { subject: 'Welcome!' }
      );

      expect(registry.getSubject('welcome')).toBe('Welcome!');
    });

    it('should return undefined when no subject set', () => {
      const registry = createTemplateRegistry().register('welcome', () => ({
        html: '',
        text: '',
      }));

      expect(registry.getSubject('welcome')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return true for registered template', () => {
      const registry = createTemplateRegistry().register('welcome', () => ({
        html: '',
        text: '',
      }));

      expect(registry.has('welcome')).toBe(true);
    });

    it('should return false for unregistered template', () => {
      const registry = createTemplateRegistry();

      expect(registry.has('unknown')).toBe(false);
    });
  });

  describe('names', () => {
    it('should return all registered template names', () => {
      const registry = createTemplateRegistry()
        .register('welcome', () => ({ html: '', text: '' }))
        .register('goodbye', () => ({ html: '', text: '' }));

      expect(registry.names).toEqual(['welcome', 'goodbye']);
    });

    it('should return empty array when no templates', () => {
      const registry = createTemplateRegistry();

      expect(registry.names).toEqual([]);
    });
  });

  describe('size', () => {
    it('should return number of registered templates', () => {
      const registry = createTemplateRegistry()
        .register('welcome', () => ({ html: '', text: '' }))
        .register('goodbye', () => ({ html: '', text: '' }));

      expect(registry.size).toBe(2);
    });

    it('should return 0 when no templates', () => {
      const registry = createTemplateRegistry();

      expect(registry.size).toBe(0);
    });
  });

  describe('type safety', () => {
    it('should infer correct context type', () => {
      interface WelcomeContext {
        name: string;
        email: string;
      }

      const registry = createTemplateRegistry().register('welcome', (ctx: WelcomeContext) => ({
        html: `<p>Hello ${ctx.name} (${ctx.email})</p>`,
        text: `Hello ${ctx.name} (${ctx.email})`,
      }));

      // This should compile
      const result = registry.render('welcome', {
        name: 'Alice',
        email: 'alice@example.com',
      });

      expect(result.html).toContain('Alice');
      expect(result.html).toContain('alice@example.com');
    });
  });
});
