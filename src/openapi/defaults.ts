import { toJsonSchema } from '@valibot/to-json-schema';
import type { OpenAPIV3 } from 'openapi-types';
import {
  ErrorResponseDto,
  ValidationErrorResponseDto,
  ValidationIssueDto,
} from '../http/error-response.dto.js';

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
    // Error response schemas - converted from Valibot DTOs
    ErrorResponse: toJsonSchema(ErrorResponseDto) as OpenAPIV3.SchemaObject,
    ValidationErrorResponse: toJsonSchema(ValidationErrorResponseDto) as OpenAPIV3.SchemaObject,
    ValidationIssue: toJsonSchema(ValidationIssueDto) as OpenAPIV3.SchemaObject,
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

    // Pagination headers (from list-query)
    'X-Total-Count': {
      description: 'Total number of items available',
      schema: {
        type: 'integer',
        format: 'int32',
        minimum: 0,
        maximum: 2147483647, // Max int32
      },
    },
    'X-Total-Pages': {
      description: 'Total number of pages',
      schema: {
        type: 'integer',
        format: 'int32',
        minimum: 0,
        maximum: 2147483647, // Max int32
      },
    },
    'X-Current-Page': {
      description: 'Current page number',
      schema: {
        type: 'integer',
        format: 'int32',
        minimum: 1,
        maximum: 2147483647, // Max int32
      },
    },
    'X-Page-Size': {
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
