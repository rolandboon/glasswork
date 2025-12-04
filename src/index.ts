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
export type {
  AuthContext,
  AuthProvider,
  AuthSession,
  AuthUser,
  BetterAuthClient,
  BetterAuthProviderConfig,
  DynamoDBSessionConfig,
  DynamoDBSessionRecord,
  InferAbility,
} from './auth/index.js';
// Auth
export {
  assertCan,
  can,
  createAbilityFactory,
  createAuthMiddleware,
  createBetterAuthProvider,
  createDynamoDBSessionAdapter,
  defineRoleAbilities,
  subject,
} from './auth/index.js';
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
  ExceptionTrackingOptions,
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
  type DomainExceptionOptions,
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

// ============================================================================
// Observability
// ============================================================================

// Exception Tracking
export {
  type CloudWatchClientLike,
  type CloudWatchTrackerOptions,
  createCloudWatchTracker,
  createConsoleTracker,
  createExceptionTrackingMiddleware,
  defaultTrackStatusCodes,
  type ExceptionTracker,
  type ExceptionTrackingConfig,
  shouldTrackException,
} from './observability/exception-tracking.js';

// Pino Logger Integration
export {
  type ContextAwarePinoOptions,
  createContextAwarePinoLogger,
  createPinoHttpMiddleware,
  lambdaPinoConfig,
  type PinoLogger,
} from './observability/pino-logger.js';
// Request Context (AsyncLocalStorage-based)
export {
  getRequestContext,
  getRequestId,
  type RequestContext,
  setRequestContextValue,
  setRequestUser,
} from './observability/request-context.js';

// ============================================================================
// Email
// ============================================================================

// Template compiler (for build-time usage)
export {
  type CompiledTemplate,
  type CompileOptions,
  type CompileResult,
  type CompilerOptions,
  compile as compileEmailTemplate,
  compileTemplates,
  extractTypes as extractTemplateTypes,
  generateInterface as generateTemplateInterface,
  type InferredType as TemplateInferredType,
  type Token as TemplateToken,
  tokenize as tokenizeTemplate,
} from './email/compiler/index.js';
// Configuration schemas
export {
  type EmailConfigInput,
  EmailConfigSchema,
  type MockTransportConfigInput,
  MockTransportConfigSchema,
  type SESTransportConfigInput,
  SESTransportConfigSchema,
  type SMTPTransportConfigInput,
  SMTPTransportConfigSchema,
  type TransportConfigInput,
  TransportConfigSchema,
  validateEmailConfig,
} from './email/config.js';
export { EmailService, type SendOptions } from './email/email-service.js';

// Template registry
export {
  createTemplateRegistry,
  type TemplateDefinition,
  TemplateRegistry,
  type TemplateRenderFn,
} from './email/template-registry.js';
export {
  type SendTemplateOptions,
  TemplatedEmailService,
} from './email/templated-email-service.js';
export { MockTransport, type StoredEmail } from './email/transports/mock-transport.js';
// Transports
export { SESTransport } from './email/transports/ses-transport.js';
// Core email types and services
export type {
  EmailAttachment,
  EmailConfig,
  EmailMessage,
  EmailModuleOptions,
  EmailResult,
  EmailTransport,
  OnSentHook,
  SESTransportConfig,
  SMTPTransportConfig,
} from './email/types.js';

// Webhook handlers for SES delivery tracking
export {
  type BouncedEvent,
  type ComplaintEvent,
  type CreateWebhookHandlerOptions,
  clearCertCache,
  // Handler factory
  createSESWebhookHandler,
  type DeliveredEvent,
  type HandleSubscriptionOptions,
  handleSNSSubscription,
  // Parsers
  parseSESNotification,
  parseSNSMessage,
  type SESBounceNotification,
  type SESComplaintNotification,
  type SESDeliveryNotification,
  // Types
  type SESEvent,
  type SESNotification,
  type SESWebhookHandlers,
  type SNSMessage,
  type VerifySignatureOptions,
  // Middleware
  verifySNSSignature,
} from './email/webhooks/index.js';
