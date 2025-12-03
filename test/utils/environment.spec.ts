import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isDevelopment, isLambda, isProduction, isTest } from '../../src/utils/environment';

describe('environment', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isLambda', () => {
    it('should return true when AWS_LAMBDA_FUNCTION_NAME is set', () => {
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'my-function';
      expect(isLambda()).toBe(true);
    });

    it('should return true when LAMBDA_TASK_ROOT is set', () => {
      process.env.LAMBDA_TASK_ROOT = '/var/task';
      expect(isLambda()).toBe(true);
    });

    it('should return false when neither is set', () => {
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      delete process.env.LAMBDA_TASK_ROOT;
      expect(isLambda()).toBe(false);
    });
  });

  describe('isProduction', () => {
    it('should return true when NODE_ENV is production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      delete process.env.LAMBDA_TASK_ROOT;
      expect(isProduction()).toBe(true);
    });

    it('should return true when in Lambda environment', () => {
      process.env.NODE_ENV = 'development';
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'my-function';
      expect(isProduction()).toBe(true);
    });

    it('should return false in development', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      delete process.env.LAMBDA_TASK_ROOT;
      expect(isProduction()).toBe(false);
    });
  });

  describe('isTest', () => {
    it('should return true when NODE_ENV is test', () => {
      process.env.NODE_ENV = 'test';
      expect(isTest()).toBe(true);
    });

    it('should return false when NODE_ENV is not test and not in test runner', () => {
      process.env.NODE_ENV = 'development';
      // Clear test runner env vars to test NODE_ENV-only behavior
      delete process.env.VITEST;
      delete process.env.JEST_WORKER_ID;
      expect(isTest()).toBe(false);
    });

    it('should return true when running in Vitest even if NODE_ENV is not test', () => {
      process.env.NODE_ENV = 'development';
      process.env.VITEST = 'true';
      expect(isTest()).toBe(true);
    });
  });

  describe('isDevelopment', () => {
    it('should return true when NODE_ENV is development', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      delete process.env.LAMBDA_TASK_ROOT;
      // Clear test runner env vars to test NODE_ENV-only behavior
      delete process.env.VITEST;
      delete process.env.JEST_WORKER_ID;
      expect(isDevelopment()).toBe(true);
    });

    it('should return false in production', () => {
      process.env.NODE_ENV = 'production';
      expect(isDevelopment()).toBe(false);
    });

    it('should return false in test', () => {
      process.env.NODE_ENV = 'test';
      expect(isDevelopment()).toBe(false);
    });

    it('should return false in Lambda', () => {
      process.env.NODE_ENV = 'development';
      process.env.AWS_LAMBDA_FUNCTION_NAME = 'my-function';
      expect(isDevelopment()).toBe(false);
    });
  });
});
