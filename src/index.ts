/**
 * Glasswork - A transparent, serverless-optimized web framework for building
 * OpenAPI-compliant REST APIs.
 *
 * The root entry re-exports core and HTTP primitives. Optional subsystems
 * (auth, email, jobs, uploads, list-query, observability) are available
 * via subpath imports: `glasswork/auth`, `glasswork/email`, etc.
 *
 * @packageDocumentation
 */

export type { AwilixContainer } from 'awilix';
export type { ErrorHandler, MiddlewareHandler } from 'hono';
export { Hono } from 'hono';
export type { OpenAPIV3 } from 'openapi-types';

export * from './core/index.js';
export {
  applyProcessors,
  BadGatewayException,
  BadRequestException,
  type BoundRouteFunction,
  ConflictException,
  configureOpenAPI,
  createBuiltinProcessors,
  createCorsHeadersProcessor,
  createErrorHandler,
  createRateLimitHeadersProcessor,
  createRateLimitMiddleware,
  createRoutes,
  DomainException,
  type DomainExceptionOptions,
  defaultErrorHandler,
  defaultOpenAPIComponents,
  type ErrorResponse,
  ErrorResponseDto,
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
  paginationHeadersProcessor,
  RequestTimeoutException,
  type RouteConfig,
  type RouteContext,
  type RouteFactory,
  type RouteOpenAPIOptions,
  responseHeadersProcessor,
  route,
  ServiceUnavailableException,
  TooManyRequestsException,
  UnauthorizedException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
  type ValibotSchema,
  type ValidationErrorResponse,
  ValidationErrorResponseDto,
  ValidationException,
  type ValidationIssue,
  ValidationIssueDto,
} from './http/index.js';
