/**
 * @module glasswork/core
 * Bootstrap, modules, configuration, and shared utilities.
 */

export type { AwilixContainer } from 'awilix';
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
} from '../config/index.js';
export { deepMerge } from '../utils/deep-merge.js';
export { isDevelopment, isLambda, isProduction, isTest } from '../utils/environment.js';
export { getClientIp } from '../utils/get-client-ip.js';
export type { Logger } from '../utils/logger.js';
export { createLogger, createPlainLogger, defaultLogger } from '../utils/logger.js';
export { omit } from '../utils/omit.js';
export { pick } from '../utils/pick.js';
export type {
  AcceptPrismaTypes,
  PrismaDecimalLike,
  SerializationConfig,
  SerializedTypes,
  TypeTransformer,
} from '../utils/serialize-prisma-types.js';
export { defaultConfig, serializePrismaTypes } from '../utils/serialize-prisma-types.js';
export { bootstrap } from './bootstrap.js';
export { defineModule } from './module.js';
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
  RouteHandlers,
  ServiceScope,
} from './types.js';
