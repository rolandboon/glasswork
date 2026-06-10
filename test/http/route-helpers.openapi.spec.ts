import { Hono } from 'hono';
import * as v from 'valibot';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { route } from '../../src/http/route-helpers.js';
import { createTestRouter } from '../helpers/route.js';

describe('route', () => {
  let router: Hono;

  beforeEach(() => {
    router = createTestRouter();
  });

  describe('OpenAPI exclusion', () => {
    it('should exclude route from OpenAPI when exclude option is true', () => {
      const handler = vi.fn().mockResolvedValue({ success: true });

      const middlewares = route(router, {
        summary: 'Excluded route',
        openapi: { exclude: true },
        handler,
      });

      // Should have: handler (1)
      // OpenAPI middleware should be skipped
      expect(middlewares.length).toBe(1);
    });

    it('should include route in OpenAPI when exclude option is false', () => {
      const handler = vi.fn().mockResolvedValue({ success: true });

      const middlewares = route(router, {
        summary: 'Included route',
        openapi: { exclude: false },
        handler,
      });

      // Should have: OpenAPI + handler (2)
      expect(middlewares.length).toBe(2);
    });

    it('should include route in OpenAPI when exclude option is undefined', () => {
      const handler = vi.fn().mockResolvedValue({ success: true });

      const middlewares = route(router, {
        summary: 'Included route',
        handler,
      });

      // Should have: OpenAPI + handler (2)
      expect(middlewares.length).toBe(2);
    });
  });
  describe('Request body type', () => {
    it('should default to json validation', async () => {
      const app = new Hono();
      const handler = vi.fn().mockResolvedValue({ success: true });

      app.post(
        '/json',
        ...route(router, {
          summary: 'JSON route',
          body: v.object({ name: v.string() }),
          // bodyType defaults to 'json'
          handler,
        })
      );

      // Should accept JSON
      const res = await app.request('/json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      });
      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ body: { name: 'test' } }));
    });

    it('should support form validation', async () => {
      const app = new Hono();
      const handler = vi.fn().mockResolvedValue({ success: true });

      app.post(
        '/form',
        ...route(router, {
          summary: 'Form route',
          body: v.object({ name: v.string() }),
          bodyType: 'form',
          handler,
        })
      );

      // Should accept form data
      const formData = new FormData();
      formData.append('name', 'test');

      const res = await app.request('/form', {
        method: 'POST',
        body: formData,
      });
      expect(res.status).toBe(200);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ body: { name: 'test' } }));
    });
  });

  describe('Binary response', () => {
    it('should handle binary response from handler', async () => {
      const app = new Hono();
      const fileContent = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // PDF magic bytes

      app.get(
        '/file',
        ...route(router, {
          summary: 'Download file',
          openapi: {
            binaryResponse: {
              contentType: 'application/pdf',
              description: 'PDF document',
            },
          },
          handler: async () => {
            return new Response(fileContent, {
              headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': 'attachment; filename="doc.pdf"',
              },
            });
          },
        })
      );

      const res = await app.request('/file');
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      const body = await res.arrayBuffer();
      expect(new Uint8Array(body)).toEqual(fileContent);
    });

    it('should create route with binaryResponse config', () => {
      const middlewares = route(router, {
        summary: 'Download route',
        openapi: {
          binaryResponse: {
            contentType: 'application/octet-stream',
            description: 'File download',
          },
        },
        handler: async () => new Response('binary'),
      });

      expect(middlewares).toBeDefined();
      expect(middlewares.length).toBeGreaterThan(0);
    });

    it('should support custom status code for binary response', () => {
      const middlewares = route(router, {
        summary: 'Download with custom status',
        openapi: {
          binaryResponse: {
            contentType: 'image/png',
            description: 'Generated image',
            statusCode: 201,
          },
        },
        handler: async () => new Response('image data'),
      });

      expect(middlewares).toBeDefined();
    });

    it('should work with different content types', async () => {
      const app = new Hono();

      // PDF
      app.get(
        '/pdf',
        ...route(router, {
          summary: 'Download PDF',
          openapi: {
            binaryResponse: { contentType: 'application/pdf' },
          },
          handler: async () =>
            new Response('pdf content', {
              headers: { 'Content-Type': 'application/pdf' },
            }),
        })
      );

      // Image
      app.get(
        '/image',
        ...route(router, {
          summary: 'Download image',
          openapi: {
            binaryResponse: { contentType: 'image/png' },
          },
          handler: async () =>
            new Response('image bytes', {
              headers: { 'Content-Type': 'image/png' },
            }),
        })
      );

      const pdfRes = await app.request('/pdf');
      expect(pdfRes.headers.get('Content-Type')).toBe('application/pdf');

      const imgRes = await app.request('/image');
      expect(imgRes.headers.get('Content-Type')).toBe('image/png');
    });
  });
});
