import type { Context, Hono, MiddlewareHandler } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import {
  type DescribeRouteOptions,
  describeRoute as honoDescribeRoute,
  resolver,
  validator,
} from 'hono-openapi';
import type { BaseIssue, BaseSchema, BaseSchemaAsync, InferOutput } from 'valibot';
import { safeParseAsync } from 'valibot';
import type {
  OpenAPIProcessorContext,
  OpenAPIResponseObject,
  OpenAPIResponseProcessor,
  RouteConfigExtensions,
} from '../core/types.js';
import { applyProcessors } from '../openapi/openapi-processors.js';
import { getClientIp } from '../utils/get-client-ip.js';
import { createLogger } from '../utils/logger.js';
import {
  type AcceptPrismaTypes,
  defaultConfig as defaultSerializationConfig,
  type SerializationConfig,
  serializePrismaTypes,
} from '../utils/serialize-prisma-types.js';

/**
 * Logger instance for route helpers
 */
const logger = createLogger('Routes');

/**
 * OpenAPI context stored in Hono app context.
 * Set during bootstrap and used when defining routes.
 */
export interface OpenAPIContext {
  processors: OpenAPIResponseProcessor[];
  securitySchemes: string[];
}

/**
 * Storage for OpenAPI context per Hono app instance.
 * Uses WeakMap to avoid memory leaks and support multiple app instances.
 */
const openAPIContextMap = new WeakMap<Hono, OpenAPIContext>();

/**
 * Set the OpenAPI context for a Hono app instance.
 * This is called during bootstrap and makes processors/schemes available to route definitions.
 *
 * @internal
 */
export function setOpenAPIContext(app: Hono, context: OpenAPIContext): void {
  openAPIContextMap.set(app, context);
}

/**
 * Get the OpenAPI context for a Hono app instance.
 *
 * @internal
 */
export function getOpenAPIContext(app: Hono): OpenAPIContext {
  return openAPIContextMap.get(app) ?? { processors: [], securitySchemes: [] };
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
type InferResponseType<TResponses> = InferResponseUnion<TResponses> extends never
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
 * Bound route function type - route() pre-bound to a router's OpenAPI context.
 */
export type BoundRouteFunction = <
  TBody extends ValibotSchema | undefined = undefined,
  TResponses extends Partial<
    Record<keyof typeof STATUS_DESCRIPTIONS, ValibotSchema | undefined>
  > = Record<never, never>,
  TPublic extends boolean = false,
  TStrictTypes extends boolean = false,
>(
  config: RouteConfig<TBody, TResponses, TPublic, TStrictTypes>
) => MiddlewareHandler[];

/**
 * Create routes with typed service injection and pre-bound route function.
 *
 * The `route` function passed to your factory is pre-bound to the router's
 * OpenAPI context, so you don't need to pass the router to every route call.
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
 * export const authRoutes = createRoutes<AuthRoutesServices>((router, services, route) => {
 *   // services.authService is typed as AuthService!
 *   // route is pre-bound to this router's OpenAPI context
 *   router.post('/login', ...route({
 *     body: LoginDto,
 *     responses: { 200: SessionDto },
 *     handler: async ({ body }) => {
 *       return services.authService.login(body);
 *     }
 *   }));
 * });
 * ```
 */
export function createRoutes<TServices = Record<string, unknown>>(
  factory: (router: Hono, services: TServices, route: BoundRouteFunction) => void
): RouteFactory {
  return (router: Hono, services: Record<string, unknown>) => {
    // Create a bound route function for this router
    const boundRoute: BoundRouteFunction = (config) => route(router, config);
    factory(router, services as TServices, boundRoute);
  };
}

/**
 * OpenAPI extensions for route configuration
 */
export interface RouteOpenAPIOptions
  extends Partial<
    Omit<DescribeRouteOptions, 'responses' | 'operationId' | 'tags' | 'summary' | 'description'>
  > {
  /**
   * Response headers to document in OpenAPI spec.
   *
   * Headers reference components defined in your OpenAPI documentation.
   * Use array format for headers on all responses, or object format for status-specific headers.
   *
   * @example
   * ```typescript
   * // Simple: applies to all responses
   * responseHeaders: ['Api-Version', 'Server-Timing']
   *
   * // Flexible: status-code specific
   * responseHeaders: {
   *   '200': ['X-Total-Count', 'X-Total-Pages'],
   *   'default': ['Api-Version']
   * }
   * ```
   */
  responseHeaders?: string[] | Record<string, string[]>;
}

/**
 * Route configuration with automatic type inference from Valibot schemas.
 *
 * Extends `RouteConfigExtensions` which can be augmented by framework users
 * to add custom properties processed by custom OpenAPI response processors.
 *
 * @template TBody - The body schema (automatically inferred)
 * @template TResponses - The responses object (automatically inferred)
 * @template TPublic - Whether the route is public (affects session typing)
 * @template TStrictTypes - Whether to enforce strict return types (no automatic Prisma type acceptance)
 *
 * @example
 * ```typescript
 * // Extend RouteConfigExtensions for custom properties
 * declare module 'glasswork' {
 *   interface RouteConfigExtensions {
 *     serverTiming?: boolean;
 *   }
 * }
 *
 * // Use in routes
 * route({
 *   serverTiming: true,
 *   handler: ...
 * });
 * ```
 */
export interface RouteConfig<
  TBody extends ValibotSchema | undefined = undefined,
  TResponses extends Partial<
    Record<keyof typeof STATUS_DESCRIPTIONS, ValibotSchema | undefined>
  > = Record<never, never>,
  TPublic extends boolean = false,
  TStrictTypes extends boolean = false,
> extends RouteConfigExtensions {
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
  /**
   * OpenAPI documentation options for this route
   */
  openapi?: RouteOpenAPIOptions;
  /**
   * Custom middleware to apply before validation and handler
   */
  middleware?: MiddlewareHandler[];
  /**
   * Enforce strict return types (requires explicit type assertions for Prisma objects)
   *
   * - false (default): Handler can return Prisma types (Date/Decimal) which are auto-serialized
   * - true: Handler must return exact schema types (requires explicit casting)
   *
   * @default false
   *
   * @example
   * ```typescript
   * // strictTypes: false (default) - Prisma types accepted
   * handler: async () => {
   *   const user = await prisma.user.findUnique({ where: { id } });
   *   return user; // ✅ Works - Date/Decimal auto-serialized
   * }
   *
   * // strictTypes: true - Exact types required
   * handler: async () => {
   *   const user = await prisma.user.findUnique({ where: { id } });
   *   return user as UserResponse; // Type assertion needed
   * }
   * ```
   */
  strictTypes?: TStrictTypes;
  /**
   * Custom serialization configuration for response data
   *
   * Allows you to add custom type transformers in addition to the default Date/Decimal handling.
   * Your custom transformers are prepended to the default transformers, so they take precedence.
   *
   * @example
   * ```typescript
   * // Define custom transformer for Money class
   * const moneyTransformer = (value: unknown) => {
   *   if (value instanceof Money) {
   *     return { amount: value.amount, currency: value.currency };
   *   }
   *   return undefined;
   * };
   *
   * route({
   *   responses: { 200: ProductSchema },
   *   serialization: {
   *     transformers: [moneyTransformer]
   *   },
   *   handler: async () => {
   *     return {
   *       price: new Money(99.99, 'USD'), // Auto-serialized
   *       createdAt: new Date(), // Still handled by default transformer
   *     };
   *   }
   * })
   * ```
   */
  serialization?: Partial<SerializationConfig>;
  /**
   * Route handler - body and return types are automatically inferred from schemas
   * Session is required by default (unless public: true)
   *
   * **Return type behavior (controlled by strictTypes option):**
   *
   * When strictTypes is false (default):
   * - Uses `AcceptPrismaTypes<T>` which allows Date/Decimal objects
   * - Date objects are automatically converted to ISO strings
   * - Decimal objects are automatically converted to numbers
   * - ALL string fields accept Date, ALL number fields accept Decimal
   * - Pragmatic for Prisma integration, but permissive typing
   *
   * When strictTypes is true:
   * - Requires exact schema types (no automatic Prisma type acceptance)
   * - Provides stricter type safety
   * - Requires explicit type assertions when returning Prisma objects
   * - Serialization still works at runtime, but types are enforced
   */
  handler: (
    context: RouteContext<
      TBody extends ValibotSchema ? InferSchemaType<TBody> : never,
      TPublic extends true ? false : true
    >
  ) => TStrictTypes extends true
    ? Promise<InferResponseType<TResponses>> | InferResponseType<TResponses>
    :
        | Promise<AcceptPrismaTypes<InferResponseType<TResponses>>>
        | AcceptPrismaTypes<InferResponseType<TResponses>>;
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
 * Detect if a query schema includes pagination fields (page, pageSize).
 * Used to auto-detect pagination for OpenAPI documentation.
 */
function hasPaginationFields(schema: ValibotSchema | undefined): boolean {
  if (!schema) return false;

  // Check if schema has page or pageSize entries
  // This works for Valibot object schemas
  const schemaAny = schema as { entries?: Record<string, unknown> };
  if (schemaAny.entries) {
    return 'page' in schemaAny.entries || 'pageSize' in schemaAny.entries;
  }

  return false;
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
 * @param router - The Hono router instance (needed for OpenAPI context)
 * @param config - Route configuration
 *
 * @example
 * ```typescript
 * // Single response type
 * router.post('/session', ...route(router, {
 *   body: StartSessionDto,
 *   responses: { 200: StartSessionResponseDto },
 *   handler: async ({ body }) => {
 *     // body is typed as InferOutput<typeof StartSessionDto>
 *     return { email: body.email }; // Must match StartSessionResponseDto
 *   }
 * }))
 *
 * // Union response type (multiple 2xx responses with automatic status)
 * router.post('/login', ...route(router, {
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
 * }))
 *
 * // With pagination (auto-detected from ListQuerySchema)
 * router.get('/users', ...route(router, {
 *   query: ListQuerySchema,  // Contains page, pageSize - pagination headers auto-added
 *   responses: { 200: UsersResponseDto },
 *   handler: async ({ query }) => { ... }
 * }))
 *
 * // With custom response headers
 * router.get('/data', ...route(router, {
 *   openapi: {
 *     responseHeaders: ['Api-Version', 'Server-Timing']
 *   },
 *   responses: { 200: DataDto },
 *   handler: async () => { ... }
 * }))
 * ```
 */
export function route<
  TBody extends ValibotSchema | undefined = undefined,
  TResponses extends Partial<
    Record<keyof typeof STATUS_DESCRIPTIONS, ValibotSchema | undefined>
  > = Record<never, never>,
  TPublic extends boolean = false,
  TStrictTypes extends boolean = false,
>(
  router: Hono,
  config: RouteConfig<TBody, TResponses, TPublic, TStrictTypes>
): MiddlewareHandler[] {
  const middlewares: MiddlewareHandler[] = [];

  // Get OpenAPI context from the router
  const openAPIContext = getOpenAPIContext(router);

  // Detect pagination from query schema
  const hasPagination = hasPaginationFields(config.query);

  // Add OpenAPI metadata
  middlewares.push(buildOpenAPIMiddleware(config, openAPIContext, hasPagination));

  // Add custom middleware (e.g., auth) before validation
  if (config.middleware) {
    middlewares.push(...config.middleware);
  }

  // Add validation middleware with custom error handler (returns 422 instead of 400)
  if (config.body) {
    middlewares.push(
      validator('json', config.body, (result, c) => {
        if (!result.success) {
          return c.json({ error: 'Validation failed', issues: result.error }, 422);
        }
      })
    );
  }
  if (config.query) {
    middlewares.push(
      validator('query', config.query, (result, c) => {
        if (!result.success) {
          return c.json({ error: 'Validation failed', issues: result.error }, 422);
        }
      })
    );
  }
  if (config.params) {
    middlewares.push(
      validator('param', config.params, (result, c) => {
        if (!result.success) {
          return c.json({ error: 'Validation failed', issues: result.error }, 422);
        }
      })
    );
  }

  // Add handler wrapper
  middlewares.push(async (c: Context) => {
    const routeContext = buildRouteContext(c);
    const result = await config.handler(
      routeContext as RouteContext<
        TBody extends ValibotSchema ? InferSchemaType<TBody> : never,
        TPublic extends true ? false : true
      >
    );

    return handleResponse(result, config.responses, config.serialization, config.summary, c);
  });

  return middlewares;
}

/**
 * Serialize response data with custom transformers and default Prisma type handling.
 *
 * @param data - The raw response data from the handler
 * @param serializationConfig - Optional custom serialization configuration
 * @returns Serialized data with Prisma types converted to JSON-safe types
 * @throws Error if circular reference or max depth is exceeded
 */
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
 * Handle response serialization and validation, including error handling.
 *
 * @param result - The raw result from the handler
 * @param responses - The response schemas configuration
 * @param serializationConfig - Optional custom serialization configuration
 * @param routeSummary - Route summary for logging
 * @param context - Hono context
 * @returns Response object or undefined if handled
 */
async function handleResponse<
  TResponses extends Partial<Record<keyof typeof STATUS_DESCRIPTIONS, ValibotSchema | undefined>>,
>(
  result: unknown,
  responses: TResponses | undefined,
  serializationConfig: Partial<SerializationConfig> | undefined,
  routeSummary: string | undefined,
  context: Context
): Promise<Response | undefined> {
  // If handler returned a Response, return it directly (for custom responses like text)
  if (result instanceof Response) {
    return result;
  }

  // Handle empty responses
  if (result === null || result === undefined) {
    context.status(204);
    return context.body(null);
  }

  // Serialize Prisma types and custom transformers
  let serializedResult: unknown;
  try {
    serializedResult = serializeResponseData(result, serializationConfig);
  } catch (error) {
    // Handle serialization errors (circular references, max depth exceeded)
    logger.error('Failed to serialize response data', {
      error: error instanceof Error ? error.message : String(error),
      route: routeSummary || 'unknown',
    });

    // In production, don't leak error details
    const errorMessage =
      process.env.NODE_ENV === 'production'
        ? 'Failed to serialize response data'
        : error instanceof Error
          ? error.message
          : String(error);

    return context.json({ error: 'Internal Server Error', message: errorMessage }, 500);
  }

  // Parse and validate response through schema
  const { data: parsedResult, statusCode } = await parseResponse(serializedResult, responses);

  // Set status code if determined by schema matching
  if (statusCode) {
    context.status(statusCode as StatusCode);
  }

  return context.json(parsedResult);
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
>(data: unknown, responses?: TResponses): Promise<{ data: unknown; statusCode?: number }> {
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

  // No schema matched - this is a potential security issue in production
  if (process.env.NODE_ENV === 'production') {
    // In production, throw an error to prevent leaking unvalidated data
    // This could expose sensitive fields that should have been stripped
    logger.error(
      'Response data does not match any defined success/redirect schema. ' +
        'Refusing to return unvalidated data in production.'
    );
    throw new Error(
      'Response validation failed: Data does not match any defined response schema. ' +
        'This prevents potentially sensitive data from being leaked.'
    );
  }

  // In development, log a warning and return data as-is for debugging
  logger.warn(
    'Response data does not match any defined success/redirect schema. ' +
      'Data will be returned as-is without validation or key stripping. ' +
      'This would throw an error in production.'
  );

  return { data };
}

function buildOpenAPIMiddleware<
  TBody extends ValibotSchema | undefined,
  TResponses extends Partial<Record<keyof typeof STATUS_DESCRIPTIONS, ValibotSchema | undefined>>,
  TPublic extends boolean,
  TStrictTypes extends boolean,
>(
  config: RouteConfig<TBody, TResponses, TPublic, TStrictTypes>,
  openAPIContext: OpenAPIContext,
  hasPagination: boolean
): MiddlewareHandler {
  const responses = buildOpenAPIResponses(config, openAPIContext, hasPagination);

  // Build security requirement based on security schemes from context
  // Public routes have no security, authenticated routes use all available schemes
  const security = config.public
    ? []
    : openAPIContext.securitySchemes.map((scheme) => ({ [scheme]: [] }));

  // Extract responseHeaders from openapi config to avoid passing it to hono-openapi
  const { responseHeaders: _responseHeaders, ...restOpenapi } = config.openapi ?? {};

  const openApiConfig: DescribeRouteOptions = {
    operationId: config.operationId || config.summary,
    tags: config.tags,
    summary: config.summary,
    description: config.description,
    responses: responses as DescribeRouteOptions['responses'],
    security,
    ...restOpenapi,
  };

  return honoDescribeRoute(openApiConfig);
}

function buildOpenAPIResponses<
  TBody extends ValibotSchema | undefined,
  TResponses extends Partial<Record<keyof typeof STATUS_DESCRIPTIONS, ValibotSchema | undefined>>,
  TPublic extends boolean,
  TStrictTypes extends boolean,
>(
  config: RouteConfig<TBody, TResponses, TPublic, TStrictTypes>,
  openAPIContext: OpenAPIContext,
  hasPagination: boolean
): Record<string, OpenAPIResponseObject> {
  const responses: Record<string, OpenAPIResponseObject> = {};

  // Add default error responses
  // Include 422 when body, query, or params validation is configured
  const hasValidation = !!(config.body || config.query || config.params);
  const defaultResponses = config.public
    ? {
        400: undefined,
        ...(hasValidation && { 422: undefined }),
        429: undefined,
        500: undefined,
      }
    : {
        400: undefined,
        401: undefined,
        ...(hasValidation && { 422: undefined }),
        429: undefined,
        500: undefined,
      };

  const allResponses = { ...defaultResponses, ...(config.responses || {}) };

  for (const [statusCode, schema] of Object.entries(allResponses)) {
    const code = Number(statusCode) as keyof typeof STATUS_DESCRIPTIONS;
    const description = STATUS_DESCRIPTIONS[code] || 'Response';

    // Determine if this is an error response that should use default error schema
    const isErrorResponse = code >= 400;
    const shouldUseDefaultErrorSchema = isErrorResponse && !schema;

    // Start with base response (no headers)
    let response: OpenAPIResponseObject = {
      description,
      ...(schema
        ? {
            content: {
              'application/json': {
                // resolver type only supports BaseSchema, but works with BaseSchemaAsync at runtime
                schema: resolver(schema as BaseSchema<unknown, unknown, BaseIssue<unknown>>, {
                  errorMode: 'ignore',
                }),
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

    // Build processor context
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

    // Apply processors to build up headers
    response = applyProcessors(response, processorContext, openAPIContext.processors);

    responses[statusCode] = response;
  }

  return responses;
}

function buildRouteContext(c: Context): RouteContext<unknown, false> {
  interface ValidatedRequest {
    valid(target: 'json' | 'query' | 'param'): unknown;
  }

  const req = c.req as unknown as ValidatedRequest;

  // Spread all context variables (from ContextVariableMap)
  // This includes session, ability, role, and any other middleware-added variables
  // Return with TSessionRequired=false to allow undefined session
  // The type will be narrowed at the call site based on the route's public setting
  return {
    ...c.var,
    body: req.valid('json'),
    query: req.valid('query') as Record<string, string>,
    params: req.valid('param') as Record<string, string>,
    services: c.get('services') || {},
    session: c.get('session'),
    ip: getClientIp(c),
    userAgent: c.req.header('user-agent'),
    context: c,
  };
}
