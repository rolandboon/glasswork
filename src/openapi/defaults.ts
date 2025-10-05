import type { OpenAPIV3 } from 'openapi-types';

/**
 * Default OpenAPI components provided by Glasswork.
 * These include headers for features implemented by the framework:
 * - Rate limiting headers
 * - Pagination headers
 * - CORS headers
 * - Error response schemas
 */
export const defaultOpenAPIComponents: OpenAPIV3.ComponentsObject = {
  schemas: {
    // Error response schemas
    ErrorResponse: {
      type: 'object',
      required: ['error'],
      properties: {
        error: {
          type: 'string',
          maxLength: 1000,
          pattern: '^[\\s\\S]*$', // Any characters including whitespace
          description: 'Error message',
        },
        issues: {
          type: 'array',
          maxItems: 100,
          items: {
            type: 'object',
            required: ['message'],
            properties: {
              message: {
                type: 'string',
                maxLength: 500,
              },
              path: {
                type: 'array',
                maxItems: 20,
                items: {
                  oneOf: [
                    { type: 'string', maxLength: 200 },
                    { type: 'number', format: 'int32' },
                  ],
                },
              },
            },
          },
          description: 'Validation error details',
        },
      },
    },
  },
  headers: {
    // CORS headers
    'Access-Control-Allow-Origin': {
      description: 'Allowed origin for CORS requests',
      schema: {
        type: 'string',
        maxLength: 2048,
        pattern: '^https?://[a-zA-Z0-9.-]+(:[0-9]+)?$',
      },
    },

    // Rate limiting headers (from rate-limit.ts)
    'RateLimit-Limit': {
      description: 'Total requests allowed in the current time window',
      schema: {
        type: 'integer',
        format: 'int32',
        minimum: 0,
        maximum: 10000,
      },
    },
    'RateLimit-Remaining': {
      description: 'Remaining requests in the current window',
      schema: {
        type: 'integer',
        format: 'int32',
        minimum: 0,
        maximum: 10000,
      },
    },
    'RateLimit-Reset': {
      description: 'Seconds until the rate limit window resets',
      schema: {
        type: 'integer',
        format: 'int32',
        minimum: 0,
        maximum: 3600,
      },
    },
    'Retry-After': {
      description: 'Seconds to wait before retrying the request (429 response)',
      schema: {
        type: 'integer',
        format: 'int32',
        minimum: 1,
        maximum: 3600,
      },
    },

    // Pagination headers (from pagination.ts)
    'X-Total-Count': {
      description: 'Total number of items available',
      schema: {
        type: 'integer',
        format: 'int32',
        minimum: 0,
        maximum: 2147483647, // Max int32
      },
    },
    'X-Page': {
      description: 'Current page number',
      schema: {
        type: 'integer',
        format: 'int32',
        minimum: 1,
        maximum: 2147483647, // Max int32
      },
    },
    'X-Limit': {
      description: 'Number of items per page',
      schema: {
        type: 'integer',
        format: 'int32',
        minimum: 1,
        maximum: 100,
      },
    },
  },
};
