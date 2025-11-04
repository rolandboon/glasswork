import type { OpenAPIResponseHook } from '../core/types.js';

/**
 * Create a hook that adds CORS headers to responses
 */
export function createCorsHeadersHook(enabled: boolean): OpenAPIResponseHook {
  return (response, _context) => {
    if (!enabled) return response;

    return {
      ...response,
      headers: {
        ...response.headers,
        'Access-Control-Allow-Origin': {
          $ref: '#/components/headers/Access-Control-Allow-Origin',
        },
      },
    };
  };
}

/**
 * Create a hook that adds rate limiting headers to responses
 */
export function createRateLimitHeadersHook(enabled: boolean): OpenAPIResponseHook {
  return (response, context) => {
    if (!enabled) return response;

    const { statusCode } = context;
    const headers: Record<string, { $ref: string }> = {
      'RateLimit-Limit': {
        $ref: '#/components/headers/RateLimit-Limit',
      },
      'RateLimit-Remaining': {
        $ref: '#/components/headers/RateLimit-Remaining',
      },
      'RateLimit-Reset': {
        $ref: '#/components/headers/RateLimit-Reset',
      },
    };

    // Add Retry-After header for 429 responses
    if (statusCode === '429') {
      headers['Retry-After'] = {
        $ref: '#/components/headers/Retry-After',
      };
    }

    return {
      ...response,
      headers: {
        ...response.headers,
        ...headers,
      },
    };
  };
}

/**
 * Create a hook that adds pagination headers to 200 responses
 */
export function createPaginationHeadersHook(): OpenAPIResponseHook {
  return (response, context) => {
    const { statusCode, routeConfig } = context;

    // Only add pagination headers to 200 responses with paginate flag
    if (statusCode !== '200' || !routeConfig.paginate) {
      return response;
    }

    return {
      ...response,
      headers: {
        ...response.headers,
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
      },
    };
  };
}
