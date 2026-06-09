import type { Context } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import { safeParseAsync } from 'valibot';
import { createLogger } from '../utils/logger.js';
import {
  defaultConfig as defaultSerializationConfig,
  type SerializationConfig,
  serializePrismaTypes,
} from '../utils/serialize-prisma-types.js';
import type { STATUS_DESCRIPTIONS, ValibotSchema } from './route-types.js';

const logger = createLogger('Routes');

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

async function parseResponse<
  TResponses extends Partial<Record<keyof typeof STATUS_DESCRIPTIONS, ValibotSchema | undefined>>,
>(data: unknown, responses?: TResponses): Promise<{ data: unknown; statusCode?: number }> {
  if (!responses) {
    return { data };
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

  if (process.env.NODE_ENV === 'production') {
    logger.error(
      'Response data does not match any defined success/redirect schema. ' +
        'Refusing to return unvalidated data in production.'
    );
    throw new Error(
      'Response validation failed: Data does not match any defined response schema. ' +
        'This prevents potentially sensitive data from being leaked.'
    );
  }

  logger.warn(
    'Response data does not match any defined success/redirect schema. ' +
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
  context: Context
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
      process.env.NODE_ENV === 'production'
        ? 'Failed to serialize response data'
        : error instanceof Error
          ? error.message
          : String(error);

    return context.json({ error: 'Internal Server Error', message: errorMessage }, 500);
  }

  const { data: parsedResult, statusCode } = await parseResponse(serializedResult, responses);

  if (statusCode) {
    context.status(statusCode as StatusCode);
  }

  return context.json(parsedResult);
}
