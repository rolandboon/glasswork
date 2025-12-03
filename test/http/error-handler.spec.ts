import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createErrorHandler, defaultErrorHandler } from '../../src/http/error-handler';
import {
  BadRequestException,
  ConflictException,
  DomainException,
  ForbiddenException,
  NotFoundException,
  TooManyRequestsException,
  UnauthorizedException,
  ValidationException,
} from '../../src/http/errors';
import type { ExceptionTracker } from '../../src/observability/exception-tracking';

describe('Error Handler', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
  });

  describe('DomainException handling', () => {
    it('should handle BadRequestException with 400 status', async () => {
      app.onError(defaultErrorHandler);
      app.get('/test', () => {
        throw new BadRequestException('Invalid input');
      });

      const res = await app.request('/test');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({ error: 'Invalid input' });
    });

    it('should handle UnauthorizedException with 401 status', async () => {
      app.onError(defaultErrorHandler);
      app.get('/test', () => {
        throw new UnauthorizedException('Not authenticated');
      });

      const res = await app.request('/test');
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: 'Not authenticated' });
    });

    it('should handle ForbiddenException with 403 status', async () => {
      app.onError(defaultErrorHandler);
      app.get('/test', () => {
        throw new ForbiddenException('Access denied');
      });

      const res = await app.request('/test');
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toEqual({ error: 'Access denied' });
    });

    it('should handle NotFoundException with 404 status', async () => {
      app.onError(defaultErrorHandler);
      app.get('/test', () => {
        throw new NotFoundException('Resource not found');
      });

      const res = await app.request('/test');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ error: 'Resource not found' });
    });

    it('should handle ConflictException with 409 status', async () => {
      app.onError(defaultErrorHandler);
      app.get('/test', () => {
        throw new ConflictException('Resource exists');
      });

      const res = await app.request('/test');
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body).toEqual({ error: 'Resource exists' });
    });

    it('should handle ValidationException with 422 status', async () => {
      app.onError(defaultErrorHandler);
      app.get('/test', () => {
        throw new ValidationException('Invalid data');
      });

      const res = await app.request('/test');
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body).toEqual({ error: 'Invalid data' });
    });

    it('should handle TooManyRequestsException with 429 status', async () => {
      app.onError(defaultErrorHandler);
      app.get('/test', () => {
        throw new TooManyRequestsException('Rate limit exceeded');
      });

      const res = await app.request('/test');
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body).toEqual({ error: 'Rate limit exceeded' });
    });
  });

  describe('HTTPException handling', () => {
    it('should handle HTTPException', async () => {
      app.onError(defaultErrorHandler);
      app.get('/test', () => {
        throw new HTTPException(418, { message: 'I am a teapot' });
      });

      const res = await app.request('/test');
      expect(res.status).toBe(418);
      const body = await res.json();
      expect(body).toEqual({ error: 'I am a teapot' });
    });
  });

  describe('Generic error handling', () => {
    it('should handle generic Error as 500', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      app.onError(createErrorHandler({ logLevel: 'error' }));
      app.get('/test', () => {
        throw new Error('Something went wrong');
      });

      const res = await app.request('/test');
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({ error: 'Internal server error' });
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should not log errors when logLevel is silent', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      app.onError(createErrorHandler({ logLevel: 'silent' }));
      app.get('/test', () => {
        throw new Error('Something went wrong');
      });

      const res = await app.request('/test');
      expect(res.status).toBe(500);
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Custom response handler', () => {
    it('should use custom response handler', async () => {
      const customResponseHandler = vi.fn((error, context) => {
        return context.json(
          { customError: error.message, code: error.statusCode },
          error.statusCode
        );
      });

      app.onError(createErrorHandler({ responseHandler: customResponseHandler }));
      app.get('/test', () => {
        throw new NotFoundException('Not found');
      });

      const res = await app.request('/test');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ customError: 'Not found', code: 404 });
      expect(customResponseHandler).toHaveBeenCalled();
    });
  });

  describe('Exception tracking', () => {
    let mockTracker: ExceptionTracker;

    beforeEach(() => {
      mockTracker = {
        captureException: vi.fn(),
        captureMessage: vi.fn(),
        setUser: vi.fn(),
        setContext: vi.fn(),
      };
    });

    it('should track 5xx DomainException errors by default', async () => {
      // Create a DomainException with an unknown code that maps to 500
      class UnknownException extends DomainException {
        constructor(message: string) {
          super(message, 'UNKNOWN_CODE');
        }
      }

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      app.onError(
        createErrorHandler({
          exceptionTracker: mockTracker,
          logLevel: 'error',
        })
      );
      app.get('/test', () => {
        throw new UnknownException('Unknown error');
      });

      const res = await app.request('/test');
      expect(res.status).toBe(500);

      expect(mockTracker.captureException).toHaveBeenCalledWith(
        expect.any(DomainException),
        expect.objectContaining({
          path: '/test',
          method: 'GET',
          statusCode: 500,
          errorCode: 'UNKNOWN_CODE',
        })
      );

      // Should also log the unknown code error
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should not track 4xx DomainException errors by default', async () => {
      app.onError(
        createErrorHandler({
          exceptionTracker: mockTracker,
        })
      );
      app.get('/test', () => {
        throw new NotFoundException('Not found');
      });

      await app.request('/test');

      expect(mockTracker.captureException).not.toHaveBeenCalled();
    });

    it('should respect explicit track flag on DomainException', async () => {
      app.onError(
        createErrorHandler({
          exceptionTracker: mockTracker,
        })
      );
      app.get('/test', () => {
        // Force tracking a 404 error
        throw new NotFoundException('Critical not found', { track: true });
      });

      await app.request('/test');

      expect(mockTracker.captureException).toHaveBeenCalledWith(
        expect.any(NotFoundException),
        expect.objectContaining({
          statusCode: 404,
        })
      );
    });

    it('should respect explicit track=false to prevent tracking', async () => {
      class ServerException extends DomainException {
        constructor(message: string) {
          super(message, 'UNKNOWN_CODE', { track: false });
        }
      }

      app.onError(
        createErrorHandler({
          exceptionTracker: mockTracker,
        })
      );
      app.get('/test', () => {
        throw new ServerException('Expected server error');
      });

      await app.request('/test');

      expect(mockTracker.captureException).not.toHaveBeenCalled();
    });

    it('should track HTTPException based on status code', async () => {
      app.onError(
        createErrorHandler({
          exceptionTracker: mockTracker,
        })
      );
      app.get('/test', () => {
        throw new HTTPException(503, { message: 'Service unavailable' });
      });

      await app.request('/test');

      expect(mockTracker.captureException).toHaveBeenCalledWith(
        expect.any(HTTPException),
        expect.objectContaining({
          statusCode: 503,
        })
      );
    });

    it('should not track 4xx HTTPException by default', async () => {
      app.onError(
        createErrorHandler({
          exceptionTracker: mockTracker,
        })
      );
      app.get('/test', () => {
        throw new HTTPException(404, { message: 'Not found' });
      });

      await app.request('/test');

      expect(mockTracker.captureException).not.toHaveBeenCalled();
    });

    it('should always track unexpected errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      app.onError(
        createErrorHandler({
          exceptionTracker: mockTracker,
          logLevel: 'error',
        })
      );
      app.get('/test', () => {
        throw new Error('Unexpected error');
      });

      await app.request('/test');

      expect(mockTracker.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          statusCode: 500,
          unexpected: true,
        })
      );
      consoleSpy.mockRestore();
    });

    it('should use custom trackStatusCodes function', async () => {
      app.onError(
        createErrorHandler({
          exceptionTracker: mockTracker,
          trackingConfig: {
            // Track all 4xx and 5xx
            trackStatusCodes: (status) => status >= 400,
          },
        })
      );
      app.get('/test', () => {
        throw new NotFoundException('Not found');
      });

      await app.request('/test');

      expect(mockTracker.captureException).toHaveBeenCalledWith(
        expect.any(NotFoundException),
        expect.objectContaining({
          statusCode: 404,
        })
      );
    });

    it('should include requestId in tracking context', async () => {
      const appWithRequestId = new Hono<{ Variables: { requestId: string } }>();
      appWithRequestId.use((c, next) => {
        c.set('requestId', 'test-request-123');
        return next();
      });
      appWithRequestId.onError(
        createErrorHandler({
          exceptionTracker: mockTracker,
        })
      );
      appWithRequestId.get('/test', () => {
        throw new HTTPException(500, { message: 'Server error' });
      });

      await appWithRequestId.request('/test');

      expect(mockTracker.captureException).toHaveBeenCalledWith(
        expect.any(HTTPException),
        expect.objectContaining({
          requestId: 'test-request-123',
        })
      );
    });
  });
});
