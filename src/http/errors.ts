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

/**
 * Map error codes to HTTP status codes
 */
export function getStatusCodeFromErrorCode(code: string): number {
  const codeMap: Record<string, number> = {
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    VALIDATION_ERROR: 422,
    TOO_MANY_REQUESTS: 429,
  };

  return codeMap[code] || 500;
}
