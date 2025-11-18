import { describe, expect, it } from 'vitest';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  GoneException,
  getStatusCodeFromErrorCode,
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
} from '../../src/http/errors.js';

describe('HTTP Exception Classes', () => {
  describe('ValidationException', () => {
    it('should create with default message', () => {
      const error = new ValidationException();
      expect(error.message).toBe('Validation error');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.name).toBe('ValidationException');
    });

    it('should create with custom message', () => {
      const error = new ValidationException('Custom validation error');
      expect(error.message).toBe('Custom validation error');
      expect(error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('UnauthorizedException', () => {
    it('should create with default message', () => {
      const error = new UnauthorizedException();
      expect(error.message).toBe('Unauthorized');
      expect(error.code).toBe('UNAUTHORIZED');
      expect(error.name).toBe('UnauthorizedException');
    });

    it('should create with custom message', () => {
      const error = new UnauthorizedException('Invalid token');
      expect(error.message).toBe('Invalid token');
      expect(error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('NotFoundException', () => {
    it('should create with default message', () => {
      const error = new NotFoundException();
      expect(error.message).toBe('Not found');
      expect(error.code).toBe('NOT_FOUND');
      expect(error.name).toBe('NotFoundException');
    });

    it('should create with custom message', () => {
      const error = new NotFoundException('User not found');
      expect(error.message).toBe('User not found');
      expect(error.code).toBe('NOT_FOUND');
    });
  });

  describe('ConflictException', () => {
    it('should create with default message', () => {
      const error = new ConflictException();
      expect(error.message).toBe('Conflict');
      expect(error.code).toBe('CONFLICT');
      expect(error.name).toBe('ConflictException');
    });

    it('should create with custom message', () => {
      const error = new ConflictException('Email already exists');
      expect(error.message).toBe('Email already exists');
      expect(error.code).toBe('CONFLICT');
    });
  });

  describe('ForbiddenException', () => {
    it('should create with default message', () => {
      const error = new ForbiddenException();
      expect(error.message).toBe('Forbidden');
      expect(error.code).toBe('FORBIDDEN');
      expect(error.name).toBe('ForbiddenException');
    });

    it('should create with custom message', () => {
      const error = new ForbiddenException('Access denied');
      expect(error.message).toBe('Access denied');
      expect(error.code).toBe('FORBIDDEN');
    });
  });

  describe('BadRequestException', () => {
    it('should create with default message', () => {
      const error = new BadRequestException();
      expect(error.message).toBe('Bad request');
      expect(error.code).toBe('BAD_REQUEST');
      expect(error.name).toBe('BadRequestException');
    });

    it('should create with custom message', () => {
      const error = new BadRequestException('Invalid input');
      expect(error.message).toBe('Invalid input');
      expect(error.code).toBe('BAD_REQUEST');
    });
  });

  describe('TooManyRequestsException', () => {
    it('should create with default message', () => {
      const error = new TooManyRequestsException();
      expect(error.message).toBe('Too many requests');
      expect(error.code).toBe('TOO_MANY_REQUESTS');
      expect(error.name).toBe('TooManyRequestsException');
    });

    it('should create with custom message', () => {
      const error = new TooManyRequestsException('Rate limit exceeded');
      expect(error.message).toBe('Rate limit exceeded');
      expect(error.code).toBe('TOO_MANY_REQUESTS');
    });
  });

  describe('MethodNotAllowedException', () => {
    it('should create with default message', () => {
      const error = new MethodNotAllowedException();
      expect(error.message).toBe('Method not allowed');
      expect(error.code).toBe('METHOD_NOT_ALLOWED');
      expect(error.name).toBe('MethodNotAllowedException');
    });

    it('should create with custom message', () => {
      const error = new MethodNotAllowedException('POST not allowed');
      expect(error.message).toBe('POST not allowed');
      expect(error.code).toBe('METHOD_NOT_ALLOWED');
    });
  });

  describe('RequestTimeoutException', () => {
    it('should create with default message', () => {
      const error = new RequestTimeoutException();
      expect(error.message).toBe('Request timeout');
      expect(error.code).toBe('REQUEST_TIMEOUT');
      expect(error.name).toBe('RequestTimeoutException');
    });

    it('should create with custom message', () => {
      const error = new RequestTimeoutException('Request took too long');
      expect(error.message).toBe('Request took too long');
      expect(error.code).toBe('REQUEST_TIMEOUT');
    });
  });

  describe('GoneException', () => {
    it('should create with default message', () => {
      const error = new GoneException();
      expect(error.message).toBe('Gone');
      expect(error.code).toBe('GONE');
      expect(error.name).toBe('GoneException');
    });

    it('should create with custom message', () => {
      const error = new GoneException('Resource no longer available');
      expect(error.message).toBe('Resource no longer available');
      expect(error.code).toBe('GONE');
    });
  });

  describe('PayloadTooLargeException', () => {
    it('should create with default message', () => {
      const error = new PayloadTooLargeException();
      expect(error.message).toBe('Payload too large');
      expect(error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(error.name).toBe('PayloadTooLargeException');
    });

    it('should create with custom message', () => {
      const error = new PayloadTooLargeException('File too large');
      expect(error.message).toBe('File too large');
      expect(error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('UnsupportedMediaTypeException', () => {
    it('should create with default message', () => {
      const error = new UnsupportedMediaTypeException();
      expect(error.message).toBe('Unsupported media type');
      expect(error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      expect(error.name).toBe('UnsupportedMediaTypeException');
    });

    it('should create with custom message', () => {
      const error = new UnsupportedMediaTypeException('Content-Type not supported');
      expect(error.message).toBe('Content-Type not supported');
      expect(error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });
  });

  describe('UnprocessableEntityException', () => {
    it('should create with default message', () => {
      const error = new UnprocessableEntityException();
      expect(error.message).toBe('Unprocessable entity');
      expect(error.code).toBe('UNPROCESSABLE_ENTITY');
      expect(error.name).toBe('UnprocessableEntityException');
    });

    it('should create with custom message', () => {
      const error = new UnprocessableEntityException('Cannot process request');
      expect(error.message).toBe('Cannot process request');
      expect(error.code).toBe('UNPROCESSABLE_ENTITY');
    });
  });

  describe('LockedException', () => {
    it('should create with default message', () => {
      const error = new LockedException();
      expect(error.message).toBe('Locked');
      expect(error.code).toBe('LOCKED');
      expect(error.name).toBe('LockedException');
    });

    it('should create with custom message', () => {
      const error = new LockedException('Resource is locked');
      expect(error.message).toBe('Resource is locked');
      expect(error.code).toBe('LOCKED');
    });
  });

  describe('PreconditionFailedException', () => {
    it('should create with default message', () => {
      const error = new PreconditionFailedException();
      expect(error.message).toBe('Precondition failed');
      expect(error.code).toBe('PRECONDITION_FAILED');
      expect(error.name).toBe('PreconditionFailedException');
    });

    it('should create with custom message', () => {
      const error = new PreconditionFailedException('Precondition not met');
      expect(error.message).toBe('Precondition not met');
      expect(error.code).toBe('PRECONDITION_FAILED');
    });
  });

  describe('InternalServerErrorException', () => {
    it('should create with default message', () => {
      const error = new InternalServerErrorException();
      expect(error.message).toBe('Internal server error');
      expect(error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(error.name).toBe('InternalServerErrorException');
    });

    it('should create with custom message', () => {
      const error = new InternalServerErrorException('Database connection failed');
      expect(error.message).toBe('Database connection failed');
      expect(error.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('NotImplementedException', () => {
    it('should create with default message', () => {
      const error = new NotImplementedException();
      expect(error.message).toBe('Not implemented');
      expect(error.code).toBe('NOT_IMPLEMENTED');
      expect(error.name).toBe('NotImplementedException');
    });

    it('should create with custom message', () => {
      const error = new NotImplementedException('Feature not available');
      expect(error.message).toBe('Feature not available');
      expect(error.code).toBe('NOT_IMPLEMENTED');
    });
  });

  describe('BadGatewayException', () => {
    it('should create with default message', () => {
      const error = new BadGatewayException();
      expect(error.message).toBe('Bad gateway');
      expect(error.code).toBe('BAD_GATEWAY');
      expect(error.name).toBe('BadGatewayException');
    });

    it('should create with custom message', () => {
      const error = new BadGatewayException('Upstream server error');
      expect(error.message).toBe('Upstream server error');
      expect(error.code).toBe('BAD_GATEWAY');
    });
  });

  describe('ServiceUnavailableException', () => {
    it('should create with default message', () => {
      const error = new ServiceUnavailableException();
      expect(error.message).toBe('Service unavailable');
      expect(error.code).toBe('SERVICE_UNAVAILABLE');
      expect(error.name).toBe('ServiceUnavailableException');
    });

    it('should create with custom message', () => {
      const error = new ServiceUnavailableException('Service is down for maintenance');
      expect(error.message).toBe('Service is down for maintenance');
      expect(error.code).toBe('SERVICE_UNAVAILABLE');
    });
  });

  describe('GatewayTimeoutException', () => {
    it('should create with default message', () => {
      const error = new GatewayTimeoutException();
      expect(error.message).toBe('Gateway timeout');
      expect(error.code).toBe('GATEWAY_TIMEOUT');
      expect(error.name).toBe('GatewayTimeoutException');
    });

    it('should create with custom message', () => {
      const error = new GatewayTimeoutException('Upstream timeout');
      expect(error.message).toBe('Upstream timeout');
      expect(error.code).toBe('GATEWAY_TIMEOUT');
    });
  });

  describe('getStatusCodeFromErrorCode', () => {
    it('should map all known error codes correctly', () => {
      expect(getStatusCodeFromErrorCode('BAD_REQUEST')).toBe(400);
      expect(getStatusCodeFromErrorCode('UNAUTHORIZED')).toBe(401);
      expect(getStatusCodeFromErrorCode('FORBIDDEN')).toBe(403);
      expect(getStatusCodeFromErrorCode('NOT_FOUND')).toBe(404);
      expect(getStatusCodeFromErrorCode('METHOD_NOT_ALLOWED')).toBe(405);
      expect(getStatusCodeFromErrorCode('REQUEST_TIMEOUT')).toBe(408);
      expect(getStatusCodeFromErrorCode('CONFLICT')).toBe(409);
      expect(getStatusCodeFromErrorCode('GONE')).toBe(410);
      expect(getStatusCodeFromErrorCode('PRECONDITION_FAILED')).toBe(412);
      expect(getStatusCodeFromErrorCode('PAYLOAD_TOO_LARGE')).toBe(413);
      expect(getStatusCodeFromErrorCode('UNSUPPORTED_MEDIA_TYPE')).toBe(415);
      expect(getStatusCodeFromErrorCode('VALIDATION_ERROR')).toBe(422);
      expect(getStatusCodeFromErrorCode('UNPROCESSABLE_ENTITY')).toBe(422);
      expect(getStatusCodeFromErrorCode('LOCKED')).toBe(423);
      expect(getStatusCodeFromErrorCode('TOO_MANY_REQUESTS')).toBe(429);
      expect(getStatusCodeFromErrorCode('INTERNAL_SERVER_ERROR')).toBe(500);
      expect(getStatusCodeFromErrorCode('NOT_IMPLEMENTED')).toBe(501);
      expect(getStatusCodeFromErrorCode('BAD_GATEWAY')).toBe(502);
      expect(getStatusCodeFromErrorCode('SERVICE_UNAVAILABLE')).toBe(503);
      expect(getStatusCodeFromErrorCode('GATEWAY_TIMEOUT')).toBe(504);
    });

    it('should return 500 for unknown error codes', () => {
      expect(getStatusCodeFromErrorCode('UNKNOWN_ERROR')).toBe(500);
      expect(getStatusCodeFromErrorCode('')).toBe(500);
    });
  });
});
