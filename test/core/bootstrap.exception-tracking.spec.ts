import { describe, expect, it, vi } from 'vitest';
import { bootstrap } from '../../src/core/bootstrap.js';
import { defineModule } from '../../src/core/module.js';
import type { ExceptionTracker } from '../../src/observability/exception-tracking.js';

describe('bootstrap exception tracking', () => {
  it('should create custom error handler with exception tracking', async () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    const mockTracker: ExceptionTracker = {
      captureException: vi.fn(),
      captureMessage: vi.fn(),
      setUser: vi.fn(),
      setContext: vi.fn(),
    };

    const module = defineModule({
      name: 'test',
      providers: [],
    });

    const { app } = await bootstrap(module, {
      debug: true,
      exceptionTracking: {
        tracker: mockTracker,
      },
    });

    expect(app).toBeDefined();
    // Verify exception tracking was configured (appears in debug logs)
    const calls = consoleSpy.mock.calls.flat().join(' ');
    expect(calls).toContain('exception tracking');

    consoleSpy.mockRestore();
  });

  it('should use custom trackStatusCodes with exception tracking', async () => {
    const mockTracker: ExceptionTracker = {
      captureException: vi.fn(),
      captureMessage: vi.fn(),
      setUser: vi.fn(),
      setContext: vi.fn(),
    };

    const module = defineModule({
      name: 'test',
      basePath: 'test',
      providers: [],
      routes: (router) => {
        router.get('/error', () => {
          throw new Error('Test error');
        });
      },
    });

    const { app } = await bootstrap(module, {
      exceptionTracking: {
        tracker: mockTracker,
        trackStatusCodes: (status) => status >= 400,
      },
    });

    // Make a request that throws an error
    await app.request('/api/test/error');

    expect(mockTracker.captureException).toHaveBeenCalled();
  });
});
