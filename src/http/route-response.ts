import type { Context } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import { safeParseAsync } from 'valibot';
import type { Environment } from '../core/types.js';
import { createLogger, type Logger } from '../utils/logger.js';
import {
  defaultConfig as defaultSerializationConfig,
  type SerializationConfig,
  serializePrismaTypes,
} from '../utils/serialize-prisma-types.js';
import type { STATUS_DESCRIPTIONS, ValibotSchema } from './route-types.js';

function serializeResponseData<T>(
  data: T,
  serializationConfig?: Partial<SerializationConfig>
): unknown {
  const config: SerializationConfig = serializationConfig
    ? {
        transformers: [
          ...(serializationConfig.transformers || []),
          ...defaultSerializationConfig.transformers,
        ],
      }
    : defaultSerializationConfig;

  return serializePrismaTypes(data, config);
}

/**
 * Picks the response status and schema. A status the handler set explicitly wins when the
 * route declares a schema for it; otherwise the first declared success or redirect schema
 * that accepts the data decides the status.
 */
async function parseResponse<
  TResponses extends Partial<Record<keyof typeof STATUS_DESCRIPTIONS, ValibotSchema | undefined>>,
>(
  data: unknown,
  responses: TResponses | undefined,
  logger: Logger,
  environment: Environment,
  explicitStatus?: number
): Promise<{ data: unknown; statusCode?: number }> {
  if (!responses) {
    return { data };
  }

  const explicitSchema =
    explicitStatus === undefined
      ? undefined
      : responses[explicitStatus as keyof typeof STATUS_DESCRIPTIONS];
  if (explicitSchema) {
    const result = await safeParseAsync(explicitSchema, data);
    if (result.success) {
      return { data: result.output, statusCode: explicitStatus };
    }
    return rejectUnmatchedResponse(data, logger, environment, `the ${explicitStatus} schema`);
  }

  const successCodes: (keyof typeof STATUS_DESCRIPTIONS)[] = [
    200, 201, 202, 204, 301, 302, 307, 308,
  ];

  for (const statusCode of successCodes) {
    const schema = responses[statusCode];
    if (!schema) continue;

    const result = await safeParseAsync(schema, data);

    if (result.success) {
      return { data: result.output, statusCode };
    }
  }

  return rejectUnmatchedResponse(data, logger, environment, 'any defined success/redirect schema');
}

function rejectUnmatchedResponse(
  data: unknown,
  logger: Logger,
  environment: Environment,
  expected: string
): { data: unknown } {
  if (environment === 'production') {
    logger.error(
      `Response data does not match ${expected}. ` +
        'Refusing to return unvalidated data in production.'
    );
    throw new Error(
      'Response validation failed: Data does not match any defined response schema. ' +
        'This prevents potentially sensitive data from being leaked.'
    );
  }

  logger.warn(
    `Response data does not match ${expected}. ` +
      'Data will be returned as-is without validation or key stripping. ' +
      'This would throw an error in production.'
  );

  return { data };
}

export async function handleResponse<
  TResponses extends Partial<Record<keyof typeof STATUS_DESCRIPTIONS, ValibotSchema | undefined>>,
>(
  result: unknown,
  responses: TResponses | undefined,
  serializationConfig: Partial<SerializationConfig> | undefined,
  strictTypes: boolean | undefined,
  routeSummary: string | undefined,
  context: Context,
  environment: Environment,
  logger: Logger = createLogger('Routes'),
  explicitStatus?: number
): Promise<Response | undefined> {
  if (result instanceof Response) {
    return result;
  }

  if (result === null || result === undefined) {
    context.status(204);
    return context.body(null);
  }

  let serializedResult: unknown;
  try {
    if (!strictTypes) {
      serializedResult = serializeResponseData(result, serializationConfig);
    } else {
      serializedResult = result;
    }
  } catch (error) {
    logger.error('Failed to serialize response data', {
      error: error instanceof Error ? error.message : String(error),
      route: routeSummary || 'unknown',
    });

    const errorMessage =
      environment === 'production'
        ? 'Failed to serialize response data'
        : error instanceof Error
          ? error.message
          : String(error);

    return context.json({ error: 'Internal Server Error', message: errorMessage }, 500);
  }

  const { data: parsedResult, statusCode } = await parseResponse(
    serializedResult,
    responses,
    logger,
    environment,
    explicitStatus
  );

  if (statusCode) {
    context.status(statusCode as StatusCode);
  }

  return context.json(parsedResult);
}
