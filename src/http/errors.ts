/**
 * Base domain exception class for business logic errors
 */
export class DomainException extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Standard HTTP exception classes
 */
export class ValidationException extends DomainException {
  constructor(message = 'Validation error') {
    super(message, 'VALIDATION_ERROR');
  }
}

export class UnauthorizedException extends DomainException {
  constructor(message = 'Unauthorized') {
    super(message, 'UNAUTHORIZED');
  }
}

export class NotFoundException extends DomainException {
  constructor(message = 'Not found') {
    super(message, 'NOT_FOUND');
  }
}

export class ConflictException extends DomainException {
  constructor(message = 'Conflict') {
    super(message, 'CONFLICT');
  }
}

export class ForbiddenException extends DomainException {
  constructor(message = 'Forbidden') {
    super(message, 'FORBIDDEN');
  }
}

export class BadRequestException extends DomainException {
  constructor(message = 'Bad request') {
    super(message, 'BAD_REQUEST');
  }
}

export class TooManyRequestsException extends DomainException {
  constructor(message = 'Too many requests') {
    super(message, 'TOO_MANY_REQUESTS');
  }
}

export class MethodNotAllowedException extends DomainException {
  constructor(message = 'Method not allowed') {
    super(message, 'METHOD_NOT_ALLOWED');
  }
}

export class RequestTimeoutException extends DomainException {
  constructor(message = 'Request timeout') {
    super(message, 'REQUEST_TIMEOUT');
  }
}

export class GoneException extends DomainException {
  constructor(message = 'Gone') {
    super(message, 'GONE');
  }
}

export class PayloadTooLargeException extends DomainException {
  constructor(message = 'Payload too large') {
    super(message, 'PAYLOAD_TOO_LARGE');
  }
}

export class UnsupportedMediaTypeException extends DomainException {
  constructor(message = 'Unsupported media type') {
    super(message, 'UNSUPPORTED_MEDIA_TYPE');
  }
}

export class UnprocessableEntityException extends DomainException {
  constructor(message = 'Unprocessable entity') {
    super(message, 'UNPROCESSABLE_ENTITY');
  }
}

export class LockedException extends DomainException {
  constructor(message = 'Locked') {
    super(message, 'LOCKED');
  }
}

export class PreconditionFailedException extends DomainException {
  constructor(message = 'Precondition failed') {
    super(message, 'PRECONDITION_FAILED');
  }
}

export class InternalServerErrorException extends DomainException {
  constructor(message = 'Internal server error') {
    super(message, 'INTERNAL_SERVER_ERROR');
  }
}

export class NotImplementedException extends DomainException {
  constructor(message = 'Not implemented') {
    super(message, 'NOT_IMPLEMENTED');
  }
}

export class BadGatewayException extends DomainException {
  constructor(message = 'Bad gateway') {
    super(message, 'BAD_GATEWAY');
  }
}

export class ServiceUnavailableException extends DomainException {
  constructor(message = 'Service unavailable') {
    super(message, 'SERVICE_UNAVAILABLE');
  }
}

export class GatewayTimeoutException extends DomainException {
  constructor(message = 'Gateway timeout') {
    super(message, 'GATEWAY_TIMEOUT');
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
