import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createErrorHandler, defaultErrorHandler } from '../../src/http/error-handler';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  TooManyRequestsException,
  UnauthorizedException,
  ValidationException,
} from '../../src/http/errors';

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
      app.onError(createErrorHandler({ logErrors: true }));
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

    it('should not log errors when logErrors is false', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      app.onError(createErrorHandler({ logErrors: false }));
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
});
