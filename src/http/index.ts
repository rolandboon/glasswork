/**
 * @module glasswork/http
 * Routing, errors, OpenAPI, and HTTP middleware.
 */

import '../hono-context.js';

export type { ErrorHandler, MiddlewareHandler } from 'hono';
export { Hono } from 'hono';
export type { OpenAPIV3 } from 'openapi-types';
export { createRateLimitMiddleware } from '../middleware/rate-limit.js';
export { defaultOpenAPIComponents } from '../openapi/defaults.js';
export { configureOpenAPI } from '../openapi/openapi.js';
export {
  applyProcessors,
  createBuiltinProcessors,
  createCorsHeadersProcessor,
  createRateLimitHeadersProcessor,
  paginationHeadersProcessor,
  responseHeadersProcessor,
} from '../openapi/openapi-processors.js';
export { createErrorHandler, defaultErrorHandler } from './error-handler.js';
export {
  type ErrorResponse,
  ErrorResponseDto,
  type ValidationErrorResponse,
  ValidationErrorResponseDto,
  type ValidationIssue,
  ValidationIssueDto,
} from './error-response.dto.js';
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
} from './errors.js';
export type {
  BoundRouteFunction,
  RouteConfig,
  RouteContext,
  RouteFactory,
  RouteOpenAPIOptions,
  ValibotSchema,
} from './route-helpers.js';
export { createRoutes, route } from './route-helpers.js';
