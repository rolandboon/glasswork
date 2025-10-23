/**
 * Glasswork - A transparent, serverless-optimized web framework for building
 * OpenAPI-compliant REST APIs.
 *
 * Built on Hono, Awilix, and Valibot.
 *
 * @packageDocumentation
 */

// Re-export commonly used types from dependencies
export type { AwilixContainer } from 'awilix';
export type { ErrorHandler, Hono } from 'hono';
export type { OpenAPIV3 } from 'openapi-types';

// Configuration
export {
  type Config,
  type ConfigOptions,
  type ConfigProvider,
  ConfigValidationException,
  createConfig,
  type DotenvProviderOptions,
  dotenvProvider,
  type EnvProviderOptions,
  envProvider,
  objectProvider,
  parseArray,
  parseBoolean,
  parseJson,
  type SsmProviderOptions,
  ssmProvider,
  toCamelCase,
  toSnakeCase,
  validateConfig,
} from './config/index.js';

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

// HTTP/Routing
export { createErrorHandler, defaultErrorHandler } from './http/error-handler.js';
export {
  type ErrorResponse,
  ErrorResponseDto,
  type ValidationErrorResponse,
  ValidationErrorResponseDto,
  type ValidationIssue,
  ValidationIssueDto,
} from './http/error-response.dto.js';
export {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  DomainException,
  ForbiddenException,
  GatewayTimeoutException,
  GoneException,
  InternalServerErrorException,
  LockedException,
  MethodNotAllowedException,
  NotFoundException,
  NotImplementedException,
  PayloadTooLargeException,
  PreconditionFailedException,
  RequestTimeoutException,
  ServiceUnavailableException,
  TooManyRequestsException,
  UnauthorizedException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
  ValidationException,
} from './http/errors.js';
export type {
  RouteConfig,
  RouteContext,
  RouteFactory,
  ValibotSchema,
} from './http/route-helpers.js';
export { createRoutes, route } from './http/route-helpers.js';

// Middleware
export { createRateLimitMiddleware } from './middleware/rate-limit.js';

// OpenAPI
export { defaultOpenAPIComponents } from './openapi/defaults.js';
export {
  createCorsHeadersHook,
  createPaginationHeadersHook,
  createRateLimitHeadersHook,
} from './openapi/hooks.js';
export { configureOpenAPI } from './openapi/openapi.js';
export { transformOpenAPIDocument } from './openapi/openapi-transformer.js';

// Utilities
export { deepMerge } from './utils/deep-merge.js';
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
