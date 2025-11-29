import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CloudWatchClientLike,
  createCloudWatchTracker,
  createConsoleTracker,
  createExceptionTrackingMiddleware,
  defaultTrackStatusCodes,
  type ExceptionTracker,
  type ExceptionTrackingConfig,
  shouldTrackException,
} from '../../src/observability/exception-tracking.js';
import { requestContextStorage } from '../../src/observability/request-context.js';

// Mock AWS SDK
class MockPutMetricDataCommand {
  input: unknown;
  constructor(input: unknown) {
    this.input = input;
  }
}

vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: class {
    send = vi.fn().mockResolvedValue({});
  },
  PutMetricDataCommand: MockPutMetricDataCommand,
}));

/** Create a typed mock CloudWatch client */
function createMockCloudWatchClient(): CloudWatchClientLike & { send: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn().mockResolvedValue({}),
  };
}

describe('Exception Tracking', () => {
  describe('defaultTrackStatusCodes', () => {
    it('should track 5xx errors', () => {
      expect(defaultTrackStatusCodes(500)).toBe(true);
      expect(defaultTrackStatusCodes(503)).toBe(true);
      expect(defaultTrackStatusCodes(599)).toBe(true);
    });

    it('should not track 4xx errors', () => {
      expect(defaultTrackStatusCodes(400)).toBe(false);
      expect(defaultTrackStatusCodes(404)).toBe(false);
      expect(defaultTrackStatusCodes(422)).toBe(false);
    });

    it('should not track 2xx/3xx responses', () => {
      expect(defaultTrackStatusCodes(200)).toBe(false);
      expect(defaultTrackStatusCodes(201)).toBe(false);
      expect(defaultTrackStatusCodes(301)).toBe(false);
    });
  });

  describe('shouldTrackException', () => {
    const config: ExceptionTrackingConfig = {
      tracker: {
        captureException: vi.fn(),
        captureMessage: vi.fn(),
        setUser: vi.fn(),
        setContext: vi.fn(),
      },
      trackStatusCodes: defaultTrackStatusCodes,
    };

    it('should use explicit track flag when provided', () => {
      expect(shouldTrackException(true, 404, config)).toBe(true);
      expect(shouldTrackException(false, 500, config)).toBe(false);
    });

    it('should use status code rules when explicit flag is undefined', () => {
      expect(shouldTrackException(undefined, 500, config)).toBe(true);
      expect(shouldTrackException(undefined, 404, config)).toBe(false);
    });

    it('should respect custom trackStatusCodes function', () => {
      const customConfig: ExceptionTrackingConfig = {
        ...config,
        trackStatusCodes: (status) => status >= 400,
      };

      expect(shouldTrackException(undefined, 404, customConfig)).toBe(true);
      expect(shouldTrackException(undefined, 500, customConfig)).toBe(true);
      expect(shouldTrackException(undefined, 200, customConfig)).toBe(false);
    });
  });

  describe('createExceptionTrackingMiddleware', () => {
    it('should set request context on tracker', async () => {
      const mockTracker: ExceptionTracker = {
        captureException: vi.fn(),
        captureMessage: vi.fn(),
        setUser: vi.fn(),
        setContext: vi.fn(),
      };

      const app = new Hono();
      app.use(async (c, next) => {
        await requestContextStorage.run(
          {
            requestId: 'req-123',
            method: c.req.method,
            path: c.req.path,
            custom: {},
          },
          async () => {
            await next();
          }
        );
      });
      app.use(
        createExceptionTrackingMiddleware({
          tracker: mockTracker,
          trackStatusCodes: defaultTrackStatusCodes,
        })
      );
      app.get('/test', (c) => c.json({ success: true }));

      await app.request('/test', {
        headers: { 'user-agent': 'test-agent' },
      });

      expect(mockTracker.setContext).toHaveBeenCalledWith('request', {
        id: 'req-123',
        method: 'GET',
        path: '/test',
        userAgent: 'test-agent',
      });
    });

    it('should fallback to context requestId if AsyncLocalStorage not available', async () => {
      const mockTracker: ExceptionTracker = {
        captureException: vi.fn(),
        captureMessage: vi.fn(),
        setUser: vi.fn(),
        setContext: vi.fn(),
      };

      const app = new Hono<{ Variables: { requestId: string } }>();
      app.use((c, next) => {
        c.set('requestId', 'fallback-id');
        return next();
      });
      app.use(
        createExceptionTrackingMiddleware({
          tracker: mockTracker,
          trackStatusCodes: defaultTrackStatusCodes,
        })
      );
      app.get('/test', (c) => c.json({ success: true }));

      await app.request('/test');

      expect(mockTracker.setContext).toHaveBeenCalledWith('request', {
        id: 'fallback-id',
        method: 'GET',
        path: '/test',
        userAgent: undefined,
      });
    });
  });

  describe('createConsoleTracker', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should log exceptions to console', async () => {
      const tracker = createConsoleTracker();
      const error = new Error('Test error');

      await requestContextStorage.run(
        {
          requestId: 'req-123',
          method: 'GET',
          path: '/test',
          custom: {},
        },
        async () => {
          tracker.captureException(error, {
            path: '/test',
            statusCode: 500,
          });
        }
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Exception]',
        expect.objectContaining({
          error: 'Test error',
          stack: expect.any(String),
          requestId: 'req-123',
          path: '/test',
          statusCode: 500,
        })
      );
    });

    it('should log error messages with error level', async () => {
      const tracker = createConsoleTracker();

      await requestContextStorage.run(
        {
          requestId: 'req-456',
          method: 'GET',
          path: '/test',
          custom: {},
        },
        async () => {
          tracker.captureMessage('Error occurred', 'error', {
            userId: 'user-123',
          });
        }
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[ERROR]',
        'Error occurred',
        expect.objectContaining({
          requestId: 'req-456',
          userId: 'user-123',
        })
      );
    });

    it('should log warning messages with warn level', async () => {
      const tracker = createConsoleTracker();

      tracker.captureMessage('Warning message', 'warning', {
        key: 'value',
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[WARNING]',
        'Warning message',
        expect.objectContaining({
          key: 'value',
        })
      );
    });

    it('should log info messages with log level', async () => {
      const tracker = createConsoleTracker();

      tracker.captureMessage('Info message', 'info', {
        key: 'value',
      });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[INFO]',
        'Info message',
        expect.objectContaining({
          key: 'value',
        })
      );
    });

    it('should have no-op setUser and setContext', () => {
      const tracker = createConsoleTracker();
      expect(() => tracker.setUser({ id: 'user-123' })).not.toThrow();
      expect(() => tracker.setContext('key', { data: 'value' })).not.toThrow();
    });
  });

  describe('createCloudWatchTracker', () => {
    let mockCloudWatchClient: CloudWatchClientLike & { send: ReturnType<typeof vi.fn> };
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      mockCloudWatchClient = createMockCloudWatchClient();
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should create tracker with default namespace', () => {
      const tracker = createCloudWatchTracker({
        cloudWatchClient: mockCloudWatchClient,
      });
      expect(tracker).toBeDefined();
      expect(tracker.captureException).toBeDefined();
      expect(tracker.captureMessage).toBeDefined();
    });

    it('should create tracker with custom namespace', () => {
      const tracker = createCloudWatchTracker({
        namespace: 'MyApp/Errors',
        cloudWatchClient: mockCloudWatchClient,
      });
      expect(tracker).toBeDefined();
    });

    it('should capture exceptions and log to console', async () => {
      const tracker = createCloudWatchTracker({
        cloudWatchClient: mockCloudWatchClient,
        logToConsole: true,
      });
      const error = new Error('Test error');

      await requestContextStorage.run(
        {
          requestId: 'req-123',
          method: 'GET',
          path: '/test',
          custom: {},
        },
        async () => {
          tracker.captureException(error, {
            path: '/test',
            statusCode: 500,
          });
        }
      );

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should publish metrics to CloudWatch', async () => {
      const tracker = createCloudWatchTracker({
        cloudWatchClient: mockCloudWatchClient,
        namespace: 'TestApp/Errors',
        dimensions: { environment: 'test' },
      });
      const error = new Error('Test error');

      tracker.captureException(error, {
        path: '/test',
        statusCode: 500,
      });

      // Wait for async metric publishing (fire-and-forget promise)
      // Dynamic import in putMetric may take longer on CI, so we wait for 1 second.
      await vi.waitFor(
        () => {
          expect(mockCloudWatchClient.send).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );

      const call = mockCloudWatchClient.send.mock.calls[0];
      const command = call[0];

      // Check command structure
      expect(command.input).toMatchObject({
        Namespace: 'TestApp/Errors',
        MetricData: expect.arrayContaining([
          expect.objectContaining({
            MetricName: 'ErrorCount',
            Value: 1,
            Unit: 'Count',
            Dimensions: expect.arrayContaining([
              expect.objectContaining({
                Name: 'environment',
                Value: 'test',
              }),
              expect.objectContaining({
                Name: 'ErrorType',
              }),
              expect.objectContaining({
                Name: 'Path',
              }),
              expect.objectContaining({
                Name: 'StatusCode',
              }),
            ]),
          }),
        ]),
      });
    });

    it('should include custom dimensions in metrics', async () => {
      const tracker = createCloudWatchTracker({
        cloudWatchClient: mockCloudWatchClient,
        dimensions: {
          service: 'user-api',
          environment: 'production',
        },
      });
      const error = new Error('Test error');

      tracker.captureException(error, {
        path: '/users',
        statusCode: 500,
      });

      // Dynamic import in putMetric may take longer on CI, so we wait for 1 second.
      await vi.waitFor(
        () => {
          expect(mockCloudWatchClient.send).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );

      const call = mockCloudWatchClient.send.mock.calls[0];
      const command = call[0];
      const dimensions = command.input.MetricData[0].Dimensions;

      expect(dimensions).toEqual(
        expect.arrayContaining([
          { Name: 'service', Value: 'user-api' },
          { Name: 'environment', Value: 'production' },
        ])
      );
    });

    it('should handle CloudWatch client errors gracefully', async () => {
      const failingClient: CloudWatchClientLike = {
        send: vi.fn().mockRejectedValue(new Error('CloudWatch error')),
      };
      const tracker = createCloudWatchTracker({
        cloudWatchClient: failingClient,
        logToConsole: true,
      });
      const error = new Error('Test error');

      // Should not throw
      expect(() => {
        tracker.captureException(error);
      }).not.toThrow();

      // Wait for error logging (may take longer on CI, so we wait for 500ms).
      await vi.waitFor(
        () => {
          expect(consoleErrorSpy).toHaveBeenCalledWith(
            '[CloudWatchTracker] Failed to put metric:',
            expect.any(Error)
          );
        },
        { timeout: 500 }
      );
    });

    it('should work without CloudWatch client (lazy loading)', async () => {
      // Create tracker without providing client - will try to lazy load
      const tracker = createCloudWatchTracker({
        logToConsole: true,
      });
      const error = new Error('Test error');

      // Should not throw even if CloudWatch SDK is not available
      expect(() => {
        tracker.captureException(error);
      }).not.toThrow();

      // Wait a bit for async operations
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should still log to console
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should capture error messages and publish metrics', async () => {
      const tracker = createCloudWatchTracker({
        cloudWatchClient: mockCloudWatchClient,
      });

      tracker.captureMessage('Error message', 'error', {
        path: '/test',
      });

      // Dynamic import in putMetric may take longer on CI, so we wait for 1 second.
      await vi.waitFor(
        () => {
          expect(mockCloudWatchClient.send).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );

      const call = mockCloudWatchClient.send.mock.calls[0];
      const command = call[0];
      expect(command.input.MetricData[0].MetricName).toBe('ErrorCount');
    });

    it('should not publish metrics for non-error messages', async () => {
      const tracker = createCloudWatchTracker({
        cloudWatchClient: mockCloudWatchClient,
      });

      tracker.captureMessage('Info message', 'info');
      tracker.captureMessage('Warning message', 'warning');

      // Wait a bit to ensure async operations complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should not have called CloudWatch for info/warning
      expect(mockCloudWatchClient.send).not.toHaveBeenCalled();
    });

    it('should use request context when available', async () => {
      const tracker = createCloudWatchTracker({
        cloudWatchClient: mockCloudWatchClient,
        logToConsole: true,
      });
      const error = new Error('Test error');

      await requestContextStorage.run(
        {
          requestId: 'req-context',
          method: 'POST',
          path: '/users',
          custom: {},
        },
        async () => {
          tracker.captureException(error, {
            statusCode: 500,
          });
        }
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Exception]',
        expect.objectContaining({
          requestId: 'req-context',
        })
      );

      // Dynamic import in putMetric may take longer on CI, so we wait for 1 second.
      await vi.waitFor(
        () => {
          expect(mockCloudWatchClient.send).toHaveBeenCalled();
        },
        { timeout: 1000 }
      );

      const call = mockCloudWatchClient.send.mock.calls[0];
      const command = call[0];
      const dimensions = command.input.MetricData[0].Dimensions;
      const pathDim = dimensions.find((d: { Name: string }) => d.Name === 'Path');
      expect(pathDim.Value).toBe('/users');
    });

    it('should support setUser and setContext (no-op)', () => {
      const tracker = createCloudWatchTracker({
        cloudWatchClient: mockCloudWatchClient,
      });

      expect(() => {
        tracker.setUser({ id: 'user-123', email: 'test@example.com' });
        tracker.setContext('key', { data: 'value' });
      }).not.toThrow();
    });

    it('should disable console logging when logToConsole is false', async () => {
      const tracker = createCloudWatchTracker({
        cloudWatchClient: mockCloudWatchClient,
        logToConsole: false,
      });
      const error = new Error('Test error');

      tracker.captureException(error);

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });
});
