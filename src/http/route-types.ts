import type { Context, MiddlewareHandler } from 'hono';
import type { DescribeRouteOptions } from 'hono-openapi';
import type { BaseIssue, BaseSchema, BaseSchemaAsync, InferOutput } from 'valibot';
import type { RouteConfigExtensions, RouteFactory, RouteHandlers } from '../core/types.js';
import type { AcceptPrismaTypes, SerializationConfig } from '../utils/serialize-prisma-types.js';

/**
 * OpenAPI extensions for route configuration
 */
export interface RouteOpenAPIOptions
  extends Partial<
    Omit<DescribeRouteOptions, 'responses' | 'operationId' | 'tags' | 'summary' | 'description'>
  > {
  responseHeaders?: string[] | Record<string, string[]>;
  exclude?: boolean;
  deprecated?: boolean;
  docs?: {
    description?: string;
    url: string;
  };
  binaryResponse?: {
    contentType: string;
    description?: string;
    statusCode?: number;
  };
}

/**
 * Valibot schema type (compatible with both sync and async schemas)
 */
export type ValibotSchema =
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>;

export type InferSchemaType<T> = T extends ValibotSchema ? InferOutput<T> : never;

type InferResponseUnion<TResponses> = {
  [K in keyof TResponses]: K extends 200 | 201 | 202 | 204 | 301 | 302 | 307 | 308
    ? TResponses[K] extends ValibotSchema
      ? InferOutput<TResponses[K]>
      : never
    : never;
}[keyof TResponses];

type InferResponseType<TResponses> =
  InferResponseUnion<TResponses> extends never ? unknown : InferResponseUnion<TResponses>;

/**
 * HTTP status codes with descriptions
 */
export const STATUS_DESCRIPTIONS = {
  200: 'Success',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
} as const;

export type { RouteFactory };

/**
 * Bound route function type - route() pre-bound to a router's OpenAPI context.
 */
export type BoundRouteFunction<TContextVariables extends object = Context['var']> = <
  TBody extends ValibotSchema | undefined = undefined,
  TQuery extends ValibotSchema | undefined = undefined,
  TParams extends ValibotSchema | undefined = undefined,
  TResponses extends Partial<
    Record<keyof typeof STATUS_DESCRIPTIONS, ValibotSchema | undefined>
  > = Record<never, never>,
  TPublic extends boolean = false,
  TStrictTypes extends boolean = false,
>(
  config: RouteConfig<TBody, TQuery, TParams, TResponses, TPublic, TStrictTypes, TContextVariables>
) => RouteHandlers;

export interface RouteConfig<
  TBody extends ValibotSchema | undefined = undefined,
  TQuery extends ValibotSchema | undefined = undefined,
  TParams extends ValibotSchema | undefined = undefined,
  TResponses extends Partial<
    Record<keyof typeof STATUS_DESCRIPTIONS, ValibotSchema | undefined>
  > = Record<never, never>,
  TPublic extends boolean = false,
  TStrictTypes extends boolean = false,
  TContextVariables extends object = Context['var'],
> extends RouteConfigExtensions {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  public?: TPublic;
  body?: TBody;
  bodyType?: 'json' | 'form';
  query?: TQuery;
  params?: TParams;
  responses?: TResponses;
  openapi?: RouteOpenAPIOptions;
  middleware?: MiddlewareHandler[];
  strictTypes?: TStrictTypes;
  serialization?: Partial<SerializationConfig>;
  authorize?: {
    action: string;
    subject: string | { __caslSubjectType__?: string };
    allowGuest?: boolean;
  };
  handler: (
    context: RouteContext<
      TBody extends ValibotSchema ? InferSchemaType<TBody> : never,
      TQuery extends ValibotSchema ? InferSchemaType<TQuery> : Record<string, string>,
      TParams extends ValibotSchema ? InferSchemaType<TParams> : Record<string, string>,
      TPublic extends true ? false : true,
      TContextVariables
    >
  ) => TStrictTypes extends true
    ? Promise<InferResponseType<TResponses>> | InferResponseType<TResponses>
    :
        | Promise<AcceptPrismaTypes<InferResponseType<TResponses>>>
        | AcceptPrismaTypes<InferResponseType<TResponses>>;
}

type ContextVariable<
  TVariables extends object,
  TKey extends PropertyKey,
> = TKey extends keyof TVariables ? TVariables[TKey] : never;

type RouteAuthContext<TVariables extends object, TSessionRequired extends boolean> = Omit<
  TVariables,
  'session'
> & {
  session: TSessionRequired extends true
    ? NonNullable<ContextVariable<TVariables, 'session'>>
    : ContextVariable<TVariables, 'session'>;
};

export type RouteContext<
  TBody = never,
  TQuery = Record<string, string>,
  TParams = Record<string, string>,
  TSessionRequired extends boolean = true,
  TContextVariables extends object = Context['var'],
> = RouteAuthContext<TContextVariables, TSessionRequired> & {
  body: TBody;
  query: TQuery;
  params: TParams;
  services: Record<string, unknown>;
  ip: string;
  userAgent: string | undefined;
  logger: import('../utils/logger.js').Logger;
  context: Context;
};
