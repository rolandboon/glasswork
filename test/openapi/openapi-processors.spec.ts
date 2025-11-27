import { describe, expect, it } from 'vitest';
import type { OpenAPIProcessorContext } from '../../src/core/types.js';
import {
  applyProcessors,
  createCorsHeadersProcessor,
  createRateLimitHeadersProcessor,
  paginationHeadersProcessor,
  responseHeadersProcessor,
} from '../../src/openapi/openapi-processors.js';

const createContext = (
  overrides: Partial<OpenAPIProcessorContext> = {}
): OpenAPIProcessorContext => ({
  statusCode: '200',
  hasPagination: false,
  routeConfig: {},
  ...overrides,
});

describe('createCorsHeadersProcessor', async () => {
  it('should add CORS headers when enabled', async () => {
    const processor = createCorsHeadersProcessor(true);
    const response = {
      description: 'Success',
      content: { 'application/json': { schema: {} } },
    };

    const actualResult = processor(response, createContext());

    expect(actualResult.headers).toEqual({
      'Access-Control-Allow-Origin': {
        $ref: '#/components/headers/Access-Control-Allow-Origin',
      },
    });
  });

  it('should preserve existing headers when adding CORS', async () => {
    const processor = createCorsHeadersProcessor(true);
    const response = {
      description: 'Success',
      headers: {
        'X-Custom-Header': {
          $ref: '#/components/headers/X-Custom-Header',
        },
      },
    };

    const actualResult = processor(response, createContext());

    expect(actualResult.headers).toEqual({
      'X-Custom-Header': {
        $ref: '#/components/headers/X-Custom-Header',
      },
      'Access-Control-Allow-Origin': {
        $ref: '#/components/headers/Access-Control-Allow-Origin',
      },
    });
  });

  it('should return response unchanged when disabled', async () => {
    const processor = createCorsHeadersProcessor(false);
    const response = {
      description: 'Success',
      content: { 'application/json': { schema: {} } },
    };

    const actualResult = processor(response, createContext());

    expect(actualResult).toBe(response);
  });
});

describe('createRateLimitHeadersProcessor', async () => {
  it('should add rate limit headers when enabled', async () => {
    const processor = createRateLimitHeadersProcessor(true);
    const response = {
      description: 'Success',
    };

    const actualResult = processor(response, createContext());

    expect(actualResult.headers).toEqual({
      'RateLimit-Limit': {
        $ref: '#/components/headers/RateLimit-Limit',
      },
      'RateLimit-Remaining': {
        $ref: '#/components/headers/RateLimit-Remaining',
      },
      'RateLimit-Reset': {
        $ref: '#/components/headers/RateLimit-Reset',
      },
    });
  });

  it('should add Retry-After header for 429 responses', async () => {
    const processor = createRateLimitHeadersProcessor(true);
    const response = {
      description: 'Too Many Requests',
    };

    const actualResult = processor(response, createContext({ statusCode: '429' }));

    expect(actualResult.headers).toHaveProperty('Retry-After');
    expect(actualResult.headers?.['Retry-After']).toEqual({
      $ref: '#/components/headers/Retry-After',
    });
  });

  it('should not add Retry-After header for non-429 responses', async () => {
    const processor = createRateLimitHeadersProcessor(true);
    const response = {
      description: 'Success',
    };

    const actualResult = processor(response, createContext());

    expect(actualResult.headers).not.toHaveProperty('Retry-After');
  });

  it('should preserve existing headers when adding rate limit headers', async () => {
    const processor = createRateLimitHeadersProcessor(true);
    const response = {
      description: 'Success',
      headers: {
        'X-Custom-Header': {
          $ref: '#/components/headers/X-Custom-Header',
        },
      },
    };

    const actualResult = processor(response, createContext());

    expect(actualResult.headers).toHaveProperty('X-Custom-Header');
    expect(actualResult.headers).toHaveProperty('RateLimit-Limit');
  });

  it('should return response unchanged when disabled', async () => {
    const processor = createRateLimitHeadersProcessor(false);
    const response = {
      description: 'Success',
    };

    const actualResult = processor(response, createContext());

    expect(actualResult).toBe(response);
  });
});

describe('paginationHeadersProcessor', async () => {
  it('should add pagination headers for 200 responses with hasPagination true', async () => {
    const response = {
      description: 'Success',
    };

    const actualResult = paginationHeadersProcessor(
      response,
      createContext({ hasPagination: true })
    );

    expect(actualResult.headers).toEqual({
      'X-Total-Count': {
        $ref: '#/components/headers/X-Total-Count',
      },
      'X-Total-Pages': {
        $ref: '#/components/headers/X-Total-Pages',
      },
      'X-Current-Page': {
        $ref: '#/components/headers/X-Current-Page',
      },
      'X-Page-Size': {
        $ref: '#/components/headers/X-Page-Size',
      },
    });
  });

  it('should not add headers for non-200 status codes', async () => {
    const response = {
      description: 'Created',
    };

    const actualResult = paginationHeadersProcessor(
      response,
      createContext({ statusCode: '201', hasPagination: true })
    );

    expect(actualResult.headers).toBeUndefined();
  });

  it('should not add headers when hasPagination is false', async () => {
    const response = {
      description: 'Success',
    };

    const actualResult = paginationHeadersProcessor(
      response,
      createContext({ hasPagination: false })
    );

    expect(actualResult.headers).toBeUndefined();
  });

  it('should preserve existing headers when adding pagination headers', async () => {
    const response = {
      description: 'Success',
      headers: {
        'X-Custom-Header': {
          $ref: '#/components/headers/X-Custom-Header',
        },
      },
    };

    const actualResult = paginationHeadersProcessor(
      response,
      createContext({ hasPagination: true })
    );

    expect(actualResult.headers).toHaveProperty('X-Custom-Header');
    expect(actualResult.headers).toHaveProperty('X-Total-Count');
  });
});

describe('responseHeadersProcessor', async () => {
  it('should add headers from simple array format to all responses', async () => {
    const response = {
      description: 'Success',
    };

    const actualResult = responseHeadersProcessor(
      response,
      createContext({
        routeConfig: {
          openapi: {
            responseHeaders: ['Api-Version', 'Server-Timing'],
          },
        },
      })
    );

    expect(actualResult.headers).toEqual({
      'Api-Version': {
        $ref: '#/components/headers/Api-Version',
      },
      'Server-Timing': {
        $ref: '#/components/headers/Server-Timing',
      },
    });
  });

  it('should add status-specific headers from object format', async () => {
    const response = {
      description: 'Success',
    };

    const actualResult = responseHeadersProcessor(
      response,
      createContext({
        statusCode: '200',
        routeConfig: {
          openapi: {
            responseHeaders: {
              '200': ['X-Total-Count'],
              '201': ['Location'],
            },
          },
        },
      })
    );

    expect(actualResult.headers).toEqual({
      'X-Total-Count': {
        $ref: '#/components/headers/X-Total-Count',
      },
    });
  });

  it('should include default headers for all status codes', async () => {
    const response = {
      description: 'Success',
    };

    const actualResult = responseHeadersProcessor(
      response,
      createContext({
        statusCode: '201',
        routeConfig: {
          openapi: {
            responseHeaders: {
              '200': ['X-Total-Count'],
              default: ['Api-Version'],
            },
          },
        },
      })
    );

    expect(actualResult.headers).toEqual({
      'Api-Version': {
        $ref: '#/components/headers/Api-Version',
      },
    });
  });

  it('should combine status-specific and default headers', async () => {
    const response = {
      description: 'Success',
    };

    const actualResult = responseHeadersProcessor(
      response,
      createContext({
        statusCode: '200',
        routeConfig: {
          openapi: {
            responseHeaders: {
              '200': ['X-Total-Count'],
              default: ['Api-Version'],
            },
          },
        },
      })
    );

    expect(actualResult.headers).toEqual({
      'X-Total-Count': {
        $ref: '#/components/headers/X-Total-Count',
      },
      'Api-Version': {
        $ref: '#/components/headers/Api-Version',
      },
    });
  });

  it('should preserve existing headers', async () => {
    const response = {
      description: 'Success',
      headers: {
        'X-Existing': {
          $ref: '#/components/headers/X-Existing',
        },
      },
    };

    const actualResult = responseHeadersProcessor(
      response,
      createContext({
        routeConfig: {
          openapi: {
            responseHeaders: ['Api-Version'],
          },
        },
      })
    );

    expect(actualResult.headers).toHaveProperty('X-Existing');
    expect(actualResult.headers).toHaveProperty('Api-Version');
  });

  it('should return response unchanged when no responseHeaders configured', async () => {
    const response = {
      description: 'Success',
    };

    const actualResult = responseHeadersProcessor(response, createContext());

    expect(actualResult).toBe(response);
  });
});

describe('applyProcessors', async () => {
  it('should apply multiple processors in order', async () => {
    const corsProcessor = createCorsHeadersProcessor(true);
    const rateLimitProcessor = createRateLimitHeadersProcessor(true);
    const response = {
      description: 'Success',
    };

    const actualResult = applyProcessors(response, createContext(), [
      corsProcessor,
      rateLimitProcessor,
    ]);

    expect(actualResult.headers).toHaveProperty('Access-Control-Allow-Origin');
    expect(actualResult.headers).toHaveProperty('RateLimit-Limit');
  });

  it('should pass the same context to all processors', async () => {
    const response = {
      description: 'Success',
    };

    const actualResult = applyProcessors(
      response,
      createContext({
        statusCode: '429',
        hasPagination: true,
      }),
      [createRateLimitHeadersProcessor(true), paginationHeadersProcessor]
    );

    // Rate limit should have Retry-After (429 response)
    expect(actualResult.headers).toHaveProperty('Retry-After');
    // Pagination should NOT have headers (not 200)
    expect(actualResult.headers).not.toHaveProperty('X-Total-Count');
  });

  it('should work with empty processor array', async () => {
    const response = {
      description: 'Success',
    };

    const actualResult = applyProcessors(response, createContext(), []);

    expect(actualResult).toBe(response);
  });
});
