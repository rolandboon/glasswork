import { ServiceUnavailableException } from '../http/errors.js';

/**
 * Thrown by an auth provider when a token is definitely not a valid session, for providers
 * that report invalid sessions with an error instead of returning null. The middleware treats
 * it like null: guest context, and the session cookie is cleared.
 */
export class InvalidSessionError extends Error {
  constructor(message = 'Invalid session', options?: ErrorOptions) {
    super(message, options);
    this.name = 'InvalidSessionError';
  }
}

/**
 * The auth provider failed to validate a session, for example because its database was
 * unreachable. Answers 503 and keeps the session cookie; the provider error is the `cause`.
 */
export class AuthenticationUnavailableException extends ServiceUnavailableException {
  constructor(cause: unknown) {
    super('Authentication is temporarily unavailable');
    this.cause = cause;
  }
}
