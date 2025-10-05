/**
 * Glasswork - A transparent, Lambda-optimized web framework
 *
 * Built on Hono, Awilix, and Prisma with the principle of "Enhance, Don't Replace"
 *
 * @packageDocumentation
 */

// Re-export commonly used types from dependencies
export type { AwilixContainer } from 'awilix';
export type { ErrorHandler, Hono } from 'hono';
export type { OpenAPIV3 } from 'openapi-types';

// Core framework
export { bootstrap } from './core/bootstrap.js';
export { defineModule } from './core/module.js';
export type {
  BootstrapOptions,
  BootstrapResult,
  Constructor,
  Environment,
  LoggerOptions,
  MiddlewareOptions,
  ModuleConfig,
  OpenAPIDocumentation,
  OpenAPIOptions,
  OpenAPIResponseHook,
  ProviderConfig,
  RateLimitOptions,
  RateLimitStorage,
  ServiceScope,
} from './core/types.js';
export { createErrorHandler, defaultErrorHandler } from './http/error-handler.js';
export {
  BadRequestException,
  ConflictException,
  DomainException,
  ForbiddenException,
  NotFoundException,
  TooManyRequestsException,
  UnauthorizedException,
  ValidationException,
} from './http/errors.js';
// HTTP/Routing
export type {
  RouteConfig,
  RouteContext,
  RouteFactory,
  ValibotSchema,
} from './http/route-helpers.js';
export { createRoutes, route } from './http/route-helpers.js';
// Middleware
export { createRateLimitMiddleware } from './middleware/rate-limit.js';
export { defaultOpenAPIComponents } from './openapi/defaults.js';
export {
  createCorsHeadersHook,
  createPaginationHeadersHook,
  createRateLimitHeadersHook,
} from './openapi/hooks.js';
// OpenAPI
export { configureOpenAPI } from './openapi/openapi.js';
export { deepMerge } from './utils/deep-merge.js';
// Utilities
export { isDevelopment, isLambda, isProduction, isTest } from './utils/environment.js';
export { getClientIp } from './utils/get-client-ip.js';
export type { Logger } from './utils/logger.js';
export { createLogger, createPlainLogger, defaultLogger } from './utils/logger.js';
export { omit } from './utils/omit.js';
export type { PaginatedOutput, PaginationInput } from './utils/pagination.js';
export { paginate, paginationInput } from './utils/pagination.js';
export { pick } from './utils/pick.js';
export type { SerializedDates } from './utils/serialize-dates.js';
export { serializeDates } from './utils/serialize-dates.js';
