import { describe, expect, it, vi } from 'vitest';
import { bootstrap, defineModule } from '../../src/core/index.js';
import { createConsoleTracker } from '../../src/observability/exception-tracking.js';
import {
  createSanitizedExceptionTracker,
  createSanitizedLogger,
} from '../../src/observability/sanitizers.js';

describe('central observability policy', () => {
  it('preserves safe child bindings without native child support and honors user identity redaction', () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    createSanitizedLogger(logger, { metadata: (metadata) => ({ ...metadata, token: 'safe' }) })
      .child?.({ jobId: 'job', token: 'secret' })
      .info('attempt');
    expect(logger.info).toHaveBeenCalledWith('attempt', { jobId: 'job', token: 'safe' });
    const tracker = {
      captureException: vi.fn(),
      captureMessage: vi.fn(),
      setUser: vi.fn(),
      setContext: vi.fn(),
    };
    createSanitizedExceptionTracker(tracker, { metadata: () => ({ id: 'redacted' }) }).setUser({
      id: 'private',
    });
    expect(tracker.setUser).toHaveBeenCalledWith({ id: 'redacted' });
  });
  it('sanitizes internal HTTP errors, access paths and tracker exports with isolated policies', async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const tracker = {
      captureException: vi.fn(),
      captureMessage: vi.fn(),
      setUser: vi.fn(),
      setContext: vi.fn(),
    };
    const module = defineModule({
      name: 'errors',
      basePath: 'errors',
      routes: (router) => {
        router.get('/:token', () => {
          throw new Error('secret');
        });
      },
    });
    const { app, container } = await bootstrap(module, {
      logger: {
        instance: logger,
        sanitizers: {
          path: () => '/redacted',
          error: () => new Error('safe'),
        },
      },
      exceptionTracking: { tracker },
    });
    const response = await app.request('/api/errors/secret');
    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(
      'Unhandled error:',
      expect.objectContaining({ message: 'safe' })
    );
    expect(logger.error).toHaveBeenCalledWith(
      'HTTP Request',
      expect.objectContaining({ path: '/redacted', status: 500 })
    );
    expect(tracker.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'safe' }),
      expect.objectContaining({ path: '/redacted' })
    );
    await container.dispose();

    const second = createSanitizedLogger(logger, { message: () => 'other policy' });
    second.info('secret');
    expect(logger.info).toHaveBeenLastCalledWith('other policy');
  });

  it('routes built-in tracker diagnostics to an injected logger without a console bypass', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    createConsoleTracker({ logger }).captureException(new Error('failure'));
    expect(logger.error).toHaveBeenCalledOnce();
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
