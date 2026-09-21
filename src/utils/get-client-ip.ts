import type { Context } from 'hono';

/**
 * Extract the client IP address from Hono context.
 *
 * Checks headers in order:
 * 1. x-forwarded-for (proxy/load balancer)
 * 2. x-real-ip (nginx)
 * 3. Direct connection info (if available)
 *
 * @param c - Hono context
 * @returns Client IP address or 'unknown' if not determinable
 *
 * @example
 * ```typescript
 * router.post('/login', route({
 *   handler: async ({ ip }) => {
 *     // ip is automatically populated
 *     await authService.logLoginAttempt(email, ip);
 *   }
 * }));
 * ```
 */
export function getClientIp(c: Context): string {
  const lambdaIp = getLambdaClientIp(c.env);
  if (lambdaIp) return lambdaIp;

  const trustProxy = c.get('trustProxy') === true;

  // Only honor proxy headers when explicitly trusted
  if (trustProxy) {
    const xForwardedFor = c.req.header('x-forwarded-for');
    if (xForwardedFor) {
      const ip = xForwardedFor.split(',')[0]?.trim();
      if (ip) return ip;
    }

    const xRealIp = c.req.header('x-real-ip');
    if (xRealIp) {
      const trimmed = xRealIp.trim();
      if (trimmed) return trimmed;
    }
  }

  const nodeIp = getNodeClientIp(c.env);
  if (nodeIp) return nodeIp;

  return 'unknown';
}

function getLambdaClientIp(environment: unknown): string | undefined {
  if (!environment || typeof environment !== 'object') return undefined;

  const env = environment as {
    requestContext?: {
      http?: { sourceIp?: unknown };
      identity?: { sourceIp?: unknown };
    };
  };
  const sourceIp = env.requestContext?.http?.sourceIp ?? env.requestContext?.identity?.sourceIp;
  return typeof sourceIp === 'string' && sourceIp.trim() ? sourceIp.trim() : undefined;
}

function getNodeClientIp(environment: unknown): string | undefined {
  if (!environment || typeof environment !== 'object') return undefined;

  const remoteAddress = (environment as { incoming?: { socket?: { remoteAddress?: unknown } } })
    .incoming?.socket?.remoteAddress;
  return typeof remoteAddress === 'string' && remoteAddress.trim()
    ? remoteAddress.trim()
    : undefined;
}
