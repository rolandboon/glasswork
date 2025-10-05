import { describe, expect, it } from 'vitest';
import {
  createCorsHeadersHook,
  createPaginationHeadersHook,
  createRateLimitHeadersHook,
} from '../../src/openapi/hooks.js';

describe('createCorsHeadersHook', () => {
  it('should add CORS headers when enabled', () => {
    const hook = createCorsHeadersHook(true);
    const response = {
      description: 'Success',
      content: { 'application/json': { schema: {} } },
    };
    const context = {
      statusCode: '200',
      routeConfig: {},
    };

    const actualResult = hook(response, context);

    expect(actualResult.headers).toEqual({
      'Access-Control-Allow-Origin': {
        $ref: '#/components/headers/Access-Control-Allow-Origin',
      },
    });
  });

  it('should preserve existing headers when adding CORS', () => {
    const hook = createCorsHeadersHook(true);
    const response = {
      description: 'Success',
      headers: {
        'X-Custom-Header': {
          $ref: '#/components/headers/X-Custom-Header',
        },
      },
    };
    const context = {
      statusCode: '200',
      routeConfig: {},
    };

    const actualResult = hook(response, context);

    expect(actualResult.headers).toEqual({
      'X-Custom-Header': {
        $ref: '#/components/headers/X-Custom-Header',
      },
      'Access-Control-Allow-Origin': {
        $ref: '#/components/headers/Access-Control-Allow-Origin',
      },
    });
  });

  it('should return response unchanged when disabled', () => {
    const hook = createCorsHeadersHook(false);
    const response = {
      description: 'Success',
      content: { 'application/json': { schema: {} } },
    };
    const context = {
      statusCode: '200',
      routeConfig: {},
    };

    const actualResult = hook(response, context);

    expect(actualResult).toBe(response);
  });
});

describe('createRateLimitHeadersHook', () => {
  it('should add rate limit headers when enabled', () => {
    const hook = createRateLimitHeadersHook(true);
    const response = {
      description: 'Success',
    };
    const context = {
      statusCode: '200',
      routeConfig: {},
    };

    const actualResult = hook(response, context);

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

  it('should add Retry-After header for 429 responses', () => {
    const hook = createRateLimitHeadersHook(true);
    const response = {
      description: 'Too Many Requests',
    };
    const context = {
      statusCode: '429',
      routeConfig: {},
    };

    const actualResult = hook(response, context);

    expect(actualResult.headers).toHaveProperty('Retry-After');
    expect(actualResult.headers!['Retry-After']).toEqual({
      $ref: '#/components/headers/Retry-After',
    });
  });

  it('should not add Retry-After header for non-429 responses', () => {
    const hook = createRateLimitHeadersHook(true);
    const response = {
      description: 'Success',
    };
    const context = {
      statusCode: '200',
      routeConfig: {},
    };

    const actualResult = hook(response, context);

    expect(actualResult.headers).not.toHaveProperty('Retry-After');
  });

  it('should preserve existing headers when adding rate limit headers', () => {
    const hook = createRateLimitHeadersHook(true);
    const response = {
      description: 'Success',
      headers: {
        'X-Custom-Header': {
          $ref: '#/components/headers/X-Custom-Header',
        },
      },
    };
    const context = {
      statusCode: '200',
      routeConfig: {},
    };

    const actualResult = hook(response, context);

    expect(actualResult.headers).toHaveProperty('X-Custom-Header');
    expect(actualResult.headers).toHaveProperty('RateLimit-Limit');
  });

  it('should return response unchanged when disabled', () => {
    const hook = createRateLimitHeadersHook(false);
    const response = {
      description: 'Success',
    };
    const context = {
      statusCode: '200',
      routeConfig: {},
    };

    const actualResult = hook(response, context);

    expect(actualResult).toBe(response);
  });
});

describe('createPaginationHeadersHook', () => {
  it('should add pagination headers for 200 responses with paginate flag', () => {
    const hook = createPaginationHeadersHook();
    const response = {
      description: 'Success',
    };
    const context = {
      statusCode: '200',
      routeConfig: {
        paginate: true,
      },
    };

    const actualResult = hook(response, context);

    expect(actualResult.headers).toEqual({
      'X-Total-Count': {
        $ref: '#/components/headers/X-Total-Count',
      },
      'X-Page': {
        $ref: '#/components/headers/X-Page',
      },
      'X-Limit': {
        $ref: '#/components/headers/X-Limit',
      },
    });
  });

  it('should not add headers for non-200 status codes', () => {
    const hook = createPaginationHeadersHook();
    const response = {
      description: 'Created',
    };
    const context = {
      statusCode: '201',
      routeConfig: {
        paginate: true,
      },
    };

    const actualResult = hook(response, context);

    expect(actualResult.headers).toBeUndefined();
  });

  it('should not add headers when paginate flag is false', () => {
    const hook = createPaginationHeadersHook();
    const response = {
      description: 'Success',
    };
    const context = {
      statusCode: '200',
      routeConfig: {
        paginate: false,
      },
    };

    const actualResult = hook(response, context);

    expect(actualResult.headers).toBeUndefined();
  });

  it('should not add headers when paginate flag is missing', () => {
    const hook = createPaginationHeadersHook();
    const response = {
      description: 'Success',
    };
    const context = {
      statusCode: '200',
      routeConfig: {},
    };

    const actualResult = hook(response, context);

    expect(actualResult.headers).toBeUndefined();
  });

  it('should preserve existing headers when adding pagination headers', () => {
    const hook = createPaginationHeadersHook();
    const response = {
      description: 'Success',
      headers: {
        'X-Custom-Header': {
          $ref: '#/components/headers/X-Custom-Header',
        },
      },
    };
    const context = {
      statusCode: '200',
      routeConfig: {
        paginate: true,
      },
    };

    const actualResult = hook(response, context);

    expect(actualResult.headers).toHaveProperty('X-Custom-Header');
    expect(actualResult.headers).toHaveProperty('X-Total-Count');
  });
});
