/**
 * Options for configuring exception behavior
 */
export interface DomainExceptionOptions {
  /**
   * Whether to track this exception in exception tracking services (Sentry, AppSignal, etc.)
   * If undefined, tracking is determined by status code rules (default: 5xx only)
   * Set to true to force tracking, false to never track
   */
  track?: boolean;
}

/**
 * Base domain exception class for business logic errors.
 *
 * Supports optional exception tracking configuration via the `track` option.
 *
 * @example
 * ```typescript
 * // Normal exception - tracking determined by status code rules
 * throw new NotFoundException('User not found');
 *
 * // Explicitly track this 404
 * throw new NotFoundException('Critical user lookup failed', { track: true });
 *
 * // Never track this 500
 * throw new InternalServerErrorException('Known cache issue', { track: false });
 * ```
 */
export class DomainException extends Error {
  /**
   * Explicit tracking flag.
   * If set, overrides default tracking rules based on status codes.
   */
  public readonly track?: boolean;

  constructor(
    message: string,
    public readonly code: string,
    options?: DomainExceptionOptions
  ) {
    super(message);
    this.name = this.constructor.name;
    this.track = options?.track;
  }
}

/**
 * Standard HTTP exception classes
 */
export class ValidationException extends DomainException {
  constructor(message = 'Validation error', options?: DomainExceptionOptions) {
    super(message, 'VALIDATION_ERROR', options);
  }
}

export class UnauthorizedException extends DomainException {
  constructor(message = 'Unauthorized', options?: DomainExceptionOptions) {
    super(message, 'UNAUTHORIZED', options);
  }
}

export class NotFoundException extends DomainException {
  constructor(message = 'Not found', options?: DomainExceptionOptions) {
    super(message, 'NOT_FOUND', options);
  }
}

export class ConflictException extends DomainException {
  constructor(message = 'Conflict', options?: DomainExceptionOptions) {
    super(message, 'CONFLICT', options);
  }
}

export class ForbiddenException extends DomainException {
  constructor(message = 'Forbidden', options?: DomainExceptionOptions) {
    super(message, 'FORBIDDEN', options);
  }
}

export class BadRequestException extends DomainException {
  constructor(message = 'Bad request', options?: DomainExceptionOptions) {
    super(message, 'BAD_REQUEST', options);
  }
}

export class TooManyRequestsException extends DomainException {
  constructor(message = 'Too many requests', options?: DomainExceptionOptions) {
    super(message, 'TOO_MANY_REQUESTS', options);
  }
}

export class MethodNotAllowedException extends DomainException {
  constructor(message = 'Method not allowed', options?: DomainExceptionOptions) {
    super(message, 'METHOD_NOT_ALLOWED', options);
  }
}

export class RequestTimeoutException extends DomainException {
  constructor(message = 'Request timeout', options?: DomainExceptionOptions) {
    super(message, 'REQUEST_TIMEOUT', options);
  }
}

export class GoneException extends DomainException {
  constructor(message = 'Gone', options?: DomainExceptionOptions) {
    super(message, 'GONE', options);
  }
}

export class PayloadTooLargeException extends DomainException {
  constructor(message = 'Payload too large', options?: DomainExceptionOptions) {
    super(message, 'PAYLOAD_TOO_LARGE', options);
  }
}

export class UnsupportedMediaTypeException extends DomainException {
  constructor(message = 'Unsupported media type', options?: DomainExceptionOptions) {
    super(message, 'UNSUPPORTED_MEDIA_TYPE', options);
  }
}

export class UnprocessableEntityException extends DomainException {
  constructor(message = 'Unprocessable entity', options?: DomainExceptionOptions) {
    super(message, 'UNPROCESSABLE_ENTITY', options);
  }
}

export class LockedException extends DomainException {
  constructor(message = 'Locked', options?: DomainExceptionOptions) {
    super(message, 'LOCKED', options);
  }
}

export class PreconditionFailedException extends DomainException {
  constructor(message = 'Precondition failed', options?: DomainExceptionOptions) {
    super(message, 'PRECONDITION_FAILED', options);
  }
}

export class InternalServerErrorException extends DomainException {
  constructor(message = 'Internal server error', options?: DomainExceptionOptions) {
    super(message, 'INTERNAL_SERVER_ERROR', options);
  }
}

export class NotImplementedException extends DomainException {
  constructor(message = 'Not implemented', options?: DomainExceptionOptions) {
    super(message, 'NOT_IMPLEMENTED', options);
  }
}

export class BadGatewayException extends DomainException {
  constructor(message = 'Bad gateway', options?: DomainExceptionOptions) {
    super(message, 'BAD_GATEWAY', options);
  }
}

export class ServiceUnavailableException extends DomainException {
  constructor(message = 'Service unavailable', options?: DomainExceptionOptions) {
    super(message, 'SERVICE_UNAVAILABLE', options);
  }
}

export class GatewayTimeoutException extends DomainException {
  constructor(message = 'Gateway timeout', options?: DomainExceptionOptions) {
    super(message, 'GATEWAY_TIMEOUT', options);
  }
}

/**
 * Map error codes to HTTP status codes
 */
export function getStatusCodeFromErrorCode(code: string): number {
  const codeMap: Record<string, number> = {
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    REQUEST_TIMEOUT: 408,
    CONFLICT: 409,
    GONE: 410,
    PRECONDITION_FAILED: 412,
    PAYLOAD_TOO_LARGE: 413,
    UNSUPPORTED_MEDIA_TYPE: 415,
    VALIDATION_ERROR: 422,
    UNPROCESSABLE_ENTITY: 422,
    LOCKED: 423,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
    NOT_IMPLEMENTED: 501,
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
    GATEWAY_TIMEOUT: 504,
  };

  return codeMap[code] || 500;
}
