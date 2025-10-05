import { array, type InferOutput, maxLength, number, object, pipe, string, union } from 'valibot';

/**
 * Standard error response for all non-validation errors
 * Used for: 4xx and 5xx errors (except 422)
 *
 * @example
 * ```typescript
 * router.get('/users/:id', route({
 *   responses: {
 *     200: UserDto,
 *     404: ErrorResponseDto, // Not found
 *   },
 *   handler: async ({ params }) => {
 *     const user = await userService.findById(params.id);
 *     if (!user) throw new NotFoundException('User not found');
 *     return user;
 *   },
 * }));
 * ```
 */
export const ErrorResponseDto = object({
  error: pipe(string(), maxLength(1000)),
});

export type ErrorResponse = InferOutput<typeof ErrorResponseDto>;

/**
 * Validation issue - simplified version of Valibot's internal structure
 * Only includes the fields typically needed for client-side error handling
 */
export const ValidationIssueDto = object({
  message: pipe(string(), maxLength(500)),
  path: pipe(array(union([string(), number()])), maxLength(20)),
});

export type ValidationIssue = InferOutput<typeof ValidationIssueDto>;

/**
 * Validation error response (422 Unprocessable Entity)
 * Returned when request body, query params, or path params fail validation
 *
 * @example
 * ```typescript
 * router.post('/users', route({
 *   body: CreateUserDto,
 *   responses: {
 *     201: UserDto,
 *     422: ValidationErrorResponseDto, // Validation failed
 *   },
 *   handler: async ({ body }) => {
 *     return userService.create(body);
 *   },
 * }));
 * ```
 *
 * Response format:
 * ```json
 * {
 *   "error": "Validation failed",
 *   "issues": [
 *     {
 *       "message": "Invalid email",
 *       "path": ["email"]
 *     }
 *   ]
 * }
 * ```
 */
export const ValidationErrorResponseDto = object({
  error: pipe(string(), maxLength(1000)),
  issues: pipe(array(ValidationIssueDto), maxLength(100)),
});

export type ValidationErrorResponse = InferOutput<typeof ValidationErrorResponseDto>;
