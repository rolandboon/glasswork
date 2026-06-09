import type { MiddlewareHandler } from 'hono';
import {
  type DescribeRouteOptions,
  describeRoute as honoDescribeRoute,
  resolver,
} from 'hono-openapi';
import type { BaseIssue, BaseSchema } from 'valibot';
import type { OpenAPIProcessorContext, OpenAPIResponseObject } from '../core/types.js';
import { applyProcessors } from '../openapi/openapi-processors.js';
import type { OpenAPIContext } from './route-openapi-context.js';
import {
  type RouteConfig,
  type RouteOpenAPIOptions,
  STATUS_DESCRIPTIONS,
  type ValibotSchema,
} from './route-types.js';

function buildDefaultErrorResponses(config: {
  public?: boolean;
  body?: unknown;
  query?: unknown;
  params?: unknown;
}): Record<number, undefined> {
  const hasValidation = !!(config.body || config.query || config.params);
  if (config.public) {
    return {
      400: undefined,
      ...(hasValidation && { 422: undefined }),
      429: undefined,
      500: undefined,
    };
  }
  return {
    400: undefined,
    401: undefined,
    ...(hasValidation && { 422: undefined }),
    429: undefined,
    500: undefined,
  };
}

function buildResponseContent(
  schema: ValibotSchema | undefined,
  isErrorResponse: boolean
): { content?: Record<string, unknown> } {
  if (schema) {
    return {
      content: {
        'application/json': {
          schema: resolver(schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>, {
            errorMode: 'ignore',
          }),
        },
      },
    };
  }
  if (isErrorResponse) {
    return {
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ErrorResponse' },
        },
      },
    };
  }
  return {};
}

function buildBinaryResponse(
  binaryConfig: NonNullable<RouteOpenAPIOptions['binaryResponse']>
): OpenAPIResponseObject {
  const description =
    binaryConfig.description ??
    STATUS_DESCRIPTIONS[(binaryConfig.statusCode ?? 200) as keyof typeof STATUS_DESCRIPTIONS] ??
    'File download';
  return {
    description,
    content: {
      [binaryConfig.contentType]: {
        schema: { type: 'string', format: 'binary' },
      },
    },
  };
}

function buildOpenAPIResponses<
  TBody extends ValibotSchema | undefined,
  TQuery extends ValibotSchema | undefined,
  TParams extends ValibotSchema | undefined,
  TResponses extends Partial<Record<keyof typeof STATUS_DESCRIPTIONS, ValibotSchema | undefined>>,
  TPublic extends boolean,
  TStrictTypes extends boolean,
>(
  config: RouteConfig<TBody, TQuery, TParams, TResponses, TPublic, TStrictTypes>,
  openAPIContext: OpenAPIContext,
  hasPagination: boolean
): Record<string, OpenAPIResponseObject> {
  const responses: Record<string, OpenAPIResponseObject> = {};
  const defaultResponses = buildDefaultErrorResponses(config);
  const allResponses = { ...defaultResponses, ...(config.responses || {}) };
  const binaryResponse = config.openapi?.binaryResponse;
  const binaryStatusCode = String(binaryResponse?.statusCode ?? 200);
  if (binaryResponse) {
    responses[binaryStatusCode] = buildBinaryResponse(binaryResponse);
  }
  for (const [statusCode, schema] of Object.entries(allResponses)) {
    if (binaryResponse && statusCode === binaryStatusCode) {
      continue;
    }
    const code = Number(statusCode) as keyof typeof STATUS_DESCRIPTIONS;
    const description = STATUS_DESCRIPTIONS[code] || 'Response';
    const isErrorResponse = code >= 400;
    let response: OpenAPIResponseObject = {
      description,
      ...buildResponseContent(schema, isErrorResponse && !schema),
    };
    const processorContext: OpenAPIProcessorContext = {
      statusCode,
      hasPagination,
      routeConfig: {
        ...config,
        public: config.public,
        tags: config.tags,
        summary: config.summary,
        openapi: config.openapi,
      },
    };
    response = applyProcessors(response, processorContext, openAPIContext.processors);
    responses[statusCode] = response;
  }
  return responses;
}

export function buildOpenAPIMiddleware<
  TBody extends ValibotSchema | undefined,
  TQuery extends ValibotSchema | undefined,
  TParams extends ValibotSchema | undefined,
  TResponses extends Partial<Record<keyof typeof STATUS_DESCRIPTIONS, ValibotSchema | undefined>>,
  TPublic extends boolean,
  TStrictTypes extends boolean,
>(
  config: RouteConfig<TBody, TQuery, TParams, TResponses, TPublic, TStrictTypes>,
  openAPIContext: OpenAPIContext,
  hasPagination: boolean
): MiddlewareHandler {
  const responses = buildOpenAPIResponses(config, openAPIContext, hasPagination);

  const security = config.public
    ? []
    : openAPIContext.securitySchemes.map((scheme) => ({ [scheme]: [] }));

  const {
    responseHeaders: _responseHeaders,
    exclude: _exclude,
    docs,
    ...restOpenapi
  } = config.openapi ?? {};

  const openApiConfig: DescribeRouteOptions = {
    operationId: config.operationId || config.summary,
    tags: config.tags,
    summary: config.summary,
    description: config.description,
    externalDocs: docs,
    responses: responses as DescribeRouteOptions['responses'],
    security,
    ...restOpenapi,
  };

  return honoDescribeRoute(openApiConfig);
}
