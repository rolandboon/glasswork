import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import type { DescribeRouteOptions } from 'hono-openapi';
import { describeRoute as honoDescribeRoute } from 'hono-openapi';
import { resolver, validator } from 'hono-openapi/valibot';
import type { BaseIssue, BaseSchema, BaseSchemaAsync, InferOutput } from 'valibot';
import { safeParseAsync } from 'valibot';
import type { OpenAPIResponseHook } from '../core/types.js';
import { getClientIp } from '../utils/get-client-ip.js';
import { createLogger } from '../utils/logger.js';

/**
 * Logger instance for route helpers
 */
const logger = createLogger('Routes');

/**
 * Global storage for OpenAPI response hooks.
 * Set during bootstrap and used when defining routes.
 */
let globalResponseHooks: OpenAPIResponseHook[] = [];

/**
 * Global storage for OpenAPI security scheme names.
 * Set during bootstrap from the documentation's securitySchemes.
 * Used when building route security (public: false routes).
 */
let globalSecuritySchemes: string[] = [];

/**
 * Set the global OpenAPI response hooks.
 * This is called during bootstrap and makes hooks available to route definitions.
 *
 * @internal
 */
export function setGlobalResponseHooks(hooks: OpenAPIResponseHook[]): void {
  globalResponseHooks = hooks;
}

/**
 * Get the current global OpenAPI response hooks.
 *
 * @internal
 */
export function getGlobalResponseHooks(): OpenAPIResponseHook[] {
  return globalResponseHooks;
}

/**
 * Set the global OpenAPI security schemes.
 * This is called during bootstrap and makes security schemes available to route definitions.
 *
 * @internal
 */
export function setGlobalSecuritySchemes(schemes: string[]): void {
  globalSecuritySchemes = schemes;
}

/**
 * Get the current global OpenAPI security schemes.
 *
 * @internal
 */
export function getGlobalSecuritySchemes(): string[] {
  return globalSecuritySchemes;
}

/**
 * Valibot schema type (compatible with both sync and async schemas)
 */
export type ValibotSchema =
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>;

/**
 * Helper type to infer the output type from a Valibot schema
 */
type InferSchemaType<T> = T extends ValibotSchema ? InferOutput<T> : never;

/**
 * Helper type to extract and create a union of all 2xx and 3xx response types
 */
type InferResponseUnion<TResponses> = {
  [K in keyof TResponses]: K extends 200 | 201 | 202 | 204 | 301 | 302 | 307 | 308
    ? TResponses[K] extends ValibotSchema
      ? InferOutput<TResponses[K]>
      : never
    : never;
}[keyof TResponses];

/**
 * Helper type to infer the response type from all 2xx and 3xx status code schemas
 * Returns a union type of all defined success/redirect responses (200, 201, 202, 204, 301, 302, 307, 308)
 * Falls back to unknown if no success/redirect responses are defined
 */
type InferResponseType<TResponses> =
  InferResponseUnion<TResponses> extends never
    ? unknown
    : InferResponseUnion<TResponses>;

/**
 * HTTP status codes with descriptions
 */
const STATUS_DESCRIPTIONS = {
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

/**
 * Route factory function type.
 * Receives a real Hono instance and services from DI container.
 */
export type RouteFactory = (router: Hono, services: Record<string, unknown>) => void;

/**
 * Create routes with typed service injection.
 *
 * @template TServices - The shape of services required by these routes
 *
 * @example
 * ```typescript
 * interface AuthRoutesServices {
 *   authService: AuthService;
 *   userService: UserService;
 * }
 *
 * export const authRoutes = createRoutes<AuthRoutesServices>((router, services) => {
 *   // services.authService is typed as AuthService!
 *   // services.userService is typed as UserService!
 *   router.post('/login', ...);
 * });
 * ```
 */
export function createRoutes<TServices = Record<string, unknown>>(
  factory: (router: Hono, services: TServices) => void
): RouteFactory {
  return factory as unknown as RouteFactory;
}

/**
 * Route configuration with automatic type inference from Valibot schemas
 *
 * @template TBody - The body schema (automatically inferred)
 * @template TResponses - The responses object (automatically inferred)
 */
export interface RouteConfig<
  TBody extends ValibotSchema | undefined = undefined,
  TResponses extends Partial<
    Record<keyof typeof STATUS_DESCRIPTIONS, ValibotSchema | undefined>
  > = Record<never, never>,
  TPublic extends boolean = false,
> {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  /**
   * Whether this is a public route (no authentication required)
   * - false (default): Session is required and typed as non-nullable
   * - true: Session is optional and typed as nullable
   */
  public?: TPublic;
  body?: TBody;
  query?: ValibotSchema;
  params?: ValibotSchema;
  responses?: TResponses;
  openapi?: Partial<
    Omit<DescribeRouteOptions, 'responses' | 'operationId' | 'tags' | 'summary' | 'description'>
  >;
  /**
   * Custom middleware to apply before validation and handler
   */
  middleware?: MiddlewareHandler[];
  /**
   * Enable pagination - adds pagination query params and response headers to OpenAPI spec
   */
  paginate?: boolean;
  /**
   * Route handler - body and return types are automatically inferred from schemas
   * Session is required by default (unless public: true)
   */
  handler: (
    context: RouteContext<
      TBody extends ValibotSchema ? InferSchemaType<TBody> : never,
      TPublic extends true ? false : true
    >
  ) => Promise<InferResponseType<TResponses>> | InferResponseType<TResponses>;
}

/**
 * Route handler context with typed body
 *
 * Automatically includes all context variables from Hono's ContextVariableMap.
 * If your middleware extends ContextVariableMap (e.g., auth middleware adding ability/role),
 * those variables will be automatically typed and available for destructuring.
 *
 * @template TBody - The typed body (inferred from schema)
 * @template TSessionRequired - Whether session is guaranteed to exist (true by default, false for public routes)
 */
export interface RouteContext<TBody = never, TSessionRequired extends boolean = true>
  extends Omit<Context['var'], 'session'> {
  body: TBody;
  query: Record<string, string>;
  params: Record<string, string>;
  services: Record<string, unknown>;
  /**
   * Session from context variables (typed via Hono's ContextVariableMap)
   * - Required by default (for authenticated routes)
   * - Optional only for public routes (public: true)
   */
  session: TSessionRequired extends true
    ? NonNullable<Context['var']['session']>
    : Context['var']['session'];
  /**
   * Client IP address (extracted from headers and connection info)
   */
  ip: string;
  /**
   * User agent string from request headers
   */
  userAgent: string | undefined;
  /**
   * Original Hono context (for advanced use cases)
   */
  context: Context;
}

/**
 * Create a route handler with validation and OpenAPI metadata.
 *
 * Type inference works automatically:
 * - Body type is inferred from the `body` schema
 * - Return type is inferred as a union of all 2xx response schemas (200, 201, etc.)
 * - Response data is automatically validated and extra keys are stripped
 * - HTTP status code is automatically set based on which schema matches
 *
 * Response Validation & Status Code:
 * - Responses are parsed through their corresponding 2xx schema
 * - Extra keys not defined in the schema are automatically stripped
 * - The HTTP status code is automatically set based on which schema validates
 * - If multiple 2xx schemas are defined, each is tried in order (200, 201)
 * - The first schema that successfully validates determines the status code
 *
 * @example
 * ```typescript
 * // Single response type
 * route({
 *   body: StartSessionDto,
 *   responses: { 200: StartSessionResponseDto },
 *   handler: async ({ body }) => {
 *     // body is typed as InferOutput<typeof StartSessionDto>
 *     return { email: body.email }; // Must match StartSessionResponseDto
 *   }
 * })
 *
 * // Union response type (multiple 2xx responses with automatic status)
 * route({
 *   body: LoginDto,
 *   responses: {
 *     200: MfaRequiredDto,  // Returns 200 if data matches this
 *     201: SessionDto       // Returns 201 if data matches this
 *   },
 *   handler: async ({ body }) => {
 *     // Return type is: MfaRequiredDto | SessionDto
 *     // Status code is set automatically based on which schema matches!
 *     if (needsMfa) return { mfaRequired: true, methods: ['totp'] }; // 200
 *     return { sessionId: '123', token: 'abc' }; // 201
 *   }
 * })
 *
 * // Automatic key stripping (useful with Prisma)
 * route({
 *   responses: { 200: UserDto },
 *   handler: async ({ services }) => {
 *     const user = await prisma.user.findUnique({ ... });
 *     // user might have { id, email, password, createdAt, ... }
 *     // But only fields in UserDto will be returned
 *     return user; // Extra keys stripped, returns 200
 *   }
 * })
 * ```
 */
export function route<
  TBody extends ValibotSchema | undefined = undefined,
  TResponses extends Partial<
    Record<keyof typeof STATUS_DESCRIPTIONS, ValibotSchema | undefined>
  > = Record<never, never>,
  TPublic extends boolean = false,
>(config: RouteConfig<TBody, TResponses, TPublic>): MiddlewareHandler[] {
  const middlewares: MiddlewareHandler[] = [];

  // Add OpenAPI metadata
  middlewares.push(buildOpenAPIMiddleware(config));

  // Add custom middleware (e.g., auth) before validation
  if (config.middleware) {
    middlewares.push(...config.middleware);
  }

  // Add validation middleware with custom error handler (returns 422 instead of 400)
  if (config.body) {
    middlewares.push(
      validator('json', config.body, (result, c) => {
        if (!result.success) {
          return c.json({ error: 'Validation failed', issues: result.issues }, 422);
        }
      })
    );
  }
  if (config.query) {
    middlewares.push(
      validator('query', config.query, (result, c) => {
        if (!result.success) {
          return c.json({ error: 'Validation failed', issues: result.issues }, 422);
        }
      })
    );
  }
  if (config.params) {
    middlewares.push(
      validator('param', config.params, (result, c) => {
        if (!result.success) {
          return c.json({ error: 'Validation failed', issues: result.issues }, 422);
        }
      })
    );
  }

  // Add handler wrapper
  middlewares.push(async (c: Context) => {
    const routeContext = buildRouteContext(c);
    const result = await config.handler(
      // @ts-expect-error - Session typing issue to be resolved separately
      routeContext as RouteContext<TBody extends ValibotSchema ? InferSchemaType<TBody> : never>
    );

    // If handler returned a Response, return it directly (for custom responses like text)
    if (result instanceof Response) {
      return result;
    }

    // Return appropriate response
    if (result === null || result === undefined) {
      c.status(204);
      return c.body(null);
    }

    // Parse and validate response through schema (strips extra keys and determines status code)
    const { data: parsedResult, statusCode } = await parseResponse(result, config.responses);

    // Automatically set the status code based on which schema matched
    if (statusCode) {
      c.status(statusCode as StatusCode);
    }

    return c.json(parsedResult);
  });

  return middlewares;
}

/**
 * Parse and validate response data through the appropriate success/redirect schema.
 * Tries each 2xx and 3xx schema in order until one successfully validates.
 * This automatically strips extra keys not defined in the schema and determines
 * the appropriate HTTP status code.
 *
 * @param data - The raw response data from the handler
 * @param responses - The response schemas configuration
 * @returns Object with parsed data and the matching status code
 */
async function parseResponse<
  TResponses extends Partial<Record<keyof typeof STATUS_DESCRIPTIONS, ValibotSchema | undefined>>,
>(
  data: unknown,
  responses?: TResponses
): Promise<{ data: unknown; statusCode?: number }> {
  // If no response schemas defined, return data as-is
  if (!responses) {
    return { data };
  }

  // Try each success/redirect schema in order (2xx and 3xx codes)
  const successCodes: (keyof typeof STATUS_DESCRIPTIONS)[] = [
    200, 201, 202, 204, 301, 302, 307, 308,
  ];

  for (const statusCode of successCodes) {
    const schema = responses[statusCode];
    if (!schema) continue;

    // Try to parse with this schema
    // Use async parse to support both sync and async schemas
    const result = await safeParseAsync(schema, data);

    if (result.success) {
      // Successfully parsed - return the validated data and matching status code
      return { data: result.output, statusCode };
    }
  }

  // No schema matched - return original data without status code
  // In development, we might want to warn about this
  if (process.env.NODE_ENV === 'development') {
    logger.warn(
      'Response data does not match any defined success/redirect schema. ' +
        'Data will be returned as-is without validation or key stripping.'
    );
  }

  return { data };
}

function buildOpenAPIMiddleware<
  TBody extends ValibotSchema | undefined,
  TResponses extends Partial<Record<keyof typeof STATUS_DESCRIPTIONS, ValibotSchema | undefined>>,
  TPublic extends boolean,
>(config: RouteConfig<TBody, TResponses, TPublic>): MiddlewareHandler {
  const responses = buildOpenAPIResponses(config);

  // Build security requirement based on global security schemes
  // Public routes have no security, authenticated routes use all available schemes
  const security = config.public
    ? []
    : getGlobalSecuritySchemes().map((scheme) => ({ [scheme]: [] }));

  const openApiConfig: DescribeRouteOptions = {
    operationId: config.operationId || config.summary,
    tags: config.tags,
    summary: config.summary,
    description: config.description,
    responses: responses as DescribeRouteOptions['responses'],
    security,
    ...(config.paginate && { parameters: buildPaginationParameters() }),
    ...config.openapi,
  };

  return honoDescribeRoute(openApiConfig);
}

/**
 * Build pagination parameters for OpenAPI spec
 */
function buildPaginationParameters(): DescribeRouteOptions['parameters'] {
  return [
    {
      name: 'page',
      in: 'query',
      required: false,
      schema: {
        type: 'integer',
        format: 'int32',
        minimum: 1,
        maximum: 2147483647, // Max int32
        default: 1,
      },
      description: 'Page number',
    },
    {
      name: 'limit',
      in: 'query',
      required: false,
      schema: {
        type: 'integer',
        format: 'int32',
        minimum: 1,
        maximum: 100,
        default: 50,
      },
      description: 'Number of items per page',
    },
  ];
}

function buildOpenAPIResponses<
  TBody extends ValibotSchema | undefined,
  TResponses extends Partial<Record<keyof typeof STATUS_DESCRIPTIONS, ValibotSchema | undefined>>,
  TPublic extends boolean,
>(
  config: RouteConfig<TBody, TResponses, TPublic>
): Record<
  string,
  {
    description: string;
    headers?: Record<string, { $ref: string }>;
    content?: Record<string, unknown>;
  }
> {
  const responses: Record<
    string,
    {
      description: string;
      headers?: Record<string, { $ref: string }>;
      content?: Record<string, unknown>;
    }
  > = {};

  // Add default error responses
  const defaultResponses = config.public
    ? { 400: undefined, 429: undefined, 500: undefined }
    : { 400: undefined, 401: undefined, 429: undefined, 500: undefined };

  const allResponses = { ...defaultResponses, ...(config.responses || {}) };

  // Get global hooks
  const hooks = getGlobalResponseHooks();

  for (const [statusCode, schema] of Object.entries(allResponses)) {
    const code = Number(statusCode) as keyof typeof STATUS_DESCRIPTIONS;
    const description = STATUS_DESCRIPTIONS[code] || 'Response';

    // Determine if this is an error response that should use default error schema
    const isErrorResponse = code >= 400;
    const shouldUseDefaultErrorSchema = isErrorResponse && !schema;

    // Start with base response (no headers)
    let response: {
      description: string;
      headers?: Record<string, { $ref: string }>;
      content?: Record<string, unknown>;
    } = {
      description,
      ...(schema
        ? {
            content: {
              'application/json': {
                // resolver type only supports BaseSchema, but works with BaseSchemaAsync at runtime
                // @ts-expect-error - resolver accepts both BaseSchema and BaseSchemaAsync
                schema: resolver(schema, { errorMode: 'ignore' }),
              },
            },
          }
        : shouldUseDefaultErrorSchema
          ? {
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/ErrorResponse',
                  },
                },
              },
            }
          : {}),
    };

    // Apply hooks to build up headers
    for (const hook of hooks) {
      response = hook(response, {
        statusCode,
        routeConfig: {
          public: config.public,
          paginate: config.paginate,
          tags: config.tags,
          summary: config.summary,
        },
      });
    }

    responses[statusCode] = response;
  }

  return responses;
}

function buildRouteContext(c: Context): RouteContext<unknown> {
  interface ValidatedRequest {
    valid(target: 'json' | 'query' | 'param'): unknown;
  }

  const req = c.req as unknown as ValidatedRequest;

  // Spread all context variables (from ContextVariableMap)
  // This includes session, ability, role, and any other middleware-added variables
  return {
    ...c.var,
    body: req.valid('json'),
    query: req.valid('query') as Record<string, string>,
    params: req.valid('param') as Record<string, string>,
    services: c.get('services') || {},
    // @ts-expect-error - Session typing works at compile time via ContextVariableMap
    session: c.get('session'),
    ip: getClientIp(c),
    userAgent: c.req.header('user-agent'),
    context: c,
  };
}
