import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger, createPlainLogger, defaultLogger } from '../../src/utils/logger.js';

describe('defaultLogger', () => {
  it('should have debug method', () => {
    expect(defaultLogger.debug).toBeDefined();
    expect(typeof defaultLogger.debug).toBe('function');
  });

  it('should have info method', () => {
    expect(defaultLogger.info).toBeDefined();
    expect(typeof defaultLogger.info).toBe('function');
  });

  it('should have warn method', () => {
    expect(defaultLogger.warn).toBeDefined();
    expect(typeof defaultLogger.warn).toBe('function');
  });

  it('should have error method', () => {
    expect(defaultLogger.error).toBeDefined();
    expect(typeof defaultLogger.error).toBe('function');
  });
});

describe('createLogger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should prefix log messages', () => {
    const logger = createLogger('TestService');

    logger.info('test message');

    expect(console.log).toHaveBeenCalledWith('[TestService] test message');
  });

  it('should include meta data in logs', () => {
    const logger = createLogger('TestService');
    const meta = { userId: 123, action: 'create' };

    logger.info('test message', meta);

    expect(console.log).toHaveBeenCalledWith('[TestService] test message', meta);
  });

  it('should log debug messages with prefix', () => {
    const logger = createLogger('TestService');

    logger.debug('debug message');

    expect(console.debug).toHaveBeenCalledWith('[TestService] debug message');
  });

  it('should log warn messages with prefix', () => {
    const logger = createLogger('TestService');

    logger.warn('warn message');

    expect(console.warn).toHaveBeenCalledWith('[TestService] warn message');
  });

  it('should log error messages with prefix', () => {
    const logger = createLogger('TestService');

    logger.error('error message');

    expect(console.error).toHaveBeenCalledWith('[TestService] error message');
  });

  it('should return noop logger when disabled', () => {
    const logger = createLogger('TestService', false);

    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('createPlainLogger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should strip ANSI color codes from log messages', async () => {
    const app = new Hono();
    app.use('*', createPlainLogger());
    app.get('/test', (context) => context.json({ success: true }));

    await app.request('/test');

    expect(console.log).toHaveBeenCalled();
    const calls = (console.log as unknown as ReturnType<typeof vi.spyOn>).mock.calls;
    for (const call of calls) {
      const message = call[0] as string;
      // Check that ANSI codes are stripped
      // biome-ignore lint/suspicious/noControlCharactersInRegex: we want to strip ANSI color codes
      expect(message).not.toMatch(/\u001B\[[0-9;]*m/);
    }
  });

  it('should log request information', async () => {
    const app = new Hono();
    app.use('*', createPlainLogger());
    app.get('/test', (context) => context.json({ success: true }));

    await app.request('/test');

    expect(console.log).toHaveBeenCalled();
    const calls = (console.log as unknown as ReturnType<typeof vi.spyOn>).mock.calls;
    const messages = calls.map((call) => call[0]).join(' ');
    expect(messages).toContain('GET');
    expect(messages).toContain('/test');
  });
});
