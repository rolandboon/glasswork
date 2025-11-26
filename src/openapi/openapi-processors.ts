import type {
  OpenAPIProcessorContext,
  OpenAPIResponseObject,
  OpenAPIResponseProcessor,
} from '../core/types.js';

/**
 * Create a processor that adds CORS headers to responses.
 * Auto-enabled when middleware.cors is configured.
 */
export function createCorsHeadersProcessor(enabled: boolean): OpenAPIResponseProcessor {
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
 * Create a processor that adds rate limiting headers to responses.
 * Auto-enabled when rateLimit.enabled is true.
 */
export function createRateLimitHeadersProcessor(enabled: boolean): OpenAPIResponseProcessor {
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
 * Processor that adds pagination headers to 200 responses.
 * Auto-enabled when the route query schema includes pagination fields (page, pageSize).
 */
export const paginationHeadersProcessor: OpenAPIResponseProcessor = (response, context) => {
  const { statusCode, hasPagination } = context;

  // Only add pagination headers to 200 responses with pagination
  if (statusCode !== '200' || !hasPagination) {
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

/**
 * Processor that adds response headers defined in route config.
 * Supports both simple array format and flexible status-code-specific format.
 *
 * @example
 * ```typescript
 * // Simple: applies to all responses
 * openapi: { responseHeaders: ['Api-Version', 'Server-Timing'] }
 *
 * // Flexible: status-code specific
 * openapi: {
 *   responseHeaders: {
 *     '200': ['X-Total-Count'],
 *     'default': ['Api-Version']
 *   }
 * }
 * ```
 */
export const responseHeadersProcessor: OpenAPIResponseProcessor = (response, context) => {
  const { statusCode, routeConfig } = context;
  const responseHeaders = routeConfig.openapi?.responseHeaders;

  if (!responseHeaders) {
    return response;
  }

  let headersToAdd: string[] = [];

  if (Array.isArray(responseHeaders)) {
    // Simple format: applies to all responses
    headersToAdd = responseHeaders;
  } else {
    // Flexible format: status-code specific
    const statusSpecific = responseHeaders[statusCode];
    const defaultHeaders = responseHeaders.default;

    if (statusSpecific) {
      headersToAdd = [...headersToAdd, ...statusSpecific];
    }
    if (defaultHeaders) {
      headersToAdd = [...headersToAdd, ...defaultHeaders];
    }
  }

  if (headersToAdd.length === 0) {
    return response;
  }

  const newHeaders: Record<string, { $ref: string }> = {};
  for (const header of headersToAdd) {
    newHeaders[header] = {
      $ref: `#/components/headers/${header}`,
    };
  }

  return {
    ...response,
    headers: {
      ...response.headers,
      ...newHeaders,
    },
  };
};

/**
 * Create built-in processors based on bootstrap configuration.
 *
 * @internal
 */
export function createBuiltinProcessors(config: {
  corsEnabled: boolean;
  rateLimitEnabled: boolean;
}): OpenAPIResponseProcessor[] {
  return [
    createCorsHeadersProcessor(config.corsEnabled),
    createRateLimitHeadersProcessor(config.rateLimitEnabled),
    paginationHeadersProcessor,
    responseHeadersProcessor,
  ];
}

/**
 * Apply all processors to a response object.
 *
 * @internal
 */
export function applyProcessors(
  response: OpenAPIResponseObject,
  context: OpenAPIProcessorContext,
  processors: OpenAPIResponseProcessor[]
): OpenAPIResponseObject {
  let result = response;
  for (const processor of processors) {
    result = processor(result, context);
  }
  return result;
}
