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
  OnModuleDestroy,
  OnModuleInit,
  OpenAPIDocumentation,
  OpenAPIOptions,
  OpenAPIProcessorContext,
  OpenAPIResponseObject,
  OpenAPIResponseProcessor,
  ProviderConfig,
  RateLimitOptions,
  RateLimitStorage,
  RouteConfigExtensions,
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
  BoundRouteFunction,
  RouteConfig,
  RouteContext,
  RouteFactory,
  RouteOpenAPIOptions,
  ValibotSchema,
} from './http/route-helpers.js';
export { createRoutes, route } from './http/route-helpers.js';
// Optional CASL integration
export { createCaslScope, withCaslScope } from './list-query/casl.js';
export type {
  AggregationConfig,
  AggregationResult,
  AggregationType,
  FieldPath,
  FilterOperator,
  ParsedFilter,
  ParsedQueryParams,
  ParsedSort,
  PrismaAggregationParams,
  PrismaListParams,
  RawQueryParams,
  SchemaValidationConfig,
  SearchFieldInput,
  SortDirection,
  ValidatedListParams,
} from './list-query/index.js';
// List Query (Prisma filtering/sorting/pagination)
export {
  booleanFilterSchema,
  createFilterSchema,
  createListQuery,
  createSortSchema,
  dateFilterSchema,
  enumFilterSchema,
  type ListQueryBuilder,
  type ListQueryConfig,
  ListQuerySchema,
  numberFilterSchema,
  type PaginatedResult,
  relationFilterSchema,
  sortDirectionSchema,
  stringFilterSchema,
} from './list-query/index.js';
// Middleware
export { createRateLimitMiddleware } from './middleware/rate-limit.js';
// OpenAPI
export { defaultOpenAPIComponents } from './openapi/defaults.js';
export { configureOpenAPI } from './openapi/openapi.js';
export {
  applyProcessors,
  createBuiltinProcessors,
  createCorsHeadersProcessor,
  createRateLimitHeadersProcessor,
  paginationHeadersProcessor,
  responseHeadersProcessor,
} from './openapi/openapi-processors.js';

// Utilities
export { deepMerge } from './utils/deep-merge.js';
export { isDevelopment, isLambda, isProduction, isTest } from './utils/environment.js';
export { getClientIp } from './utils/get-client-ip.js';
export type { Logger } from './utils/logger.js';
export { createLogger, createPlainLogger, defaultLogger } from './utils/logger.js';
export { omit } from './utils/omit.js';
export { pick } from './utils/pick.js';
export type {
  AcceptPrismaTypes,
  PrismaDecimalLike,
  SerializationConfig,
  SerializedTypes,
  TypeTransformer,
} from './utils/serialize-prisma-types.js';
export { defaultConfig, serializePrismaTypes } from './utils/serialize-prisma-types.js';
