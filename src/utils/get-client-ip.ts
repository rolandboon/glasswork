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

  // Try to get connection info (Node.js server)
  try {
    // Dynamic import to avoid bundling @hono/node-server in Lambda
    // This will throw in non-Node environments
    const { getConnInfo } = require('@hono/node-server/conninfo');
    const info = getConnInfo(c);
    if (info?.remote?.address) {
      return info.remote.address;
    }
  } catch {
    // Not in Node.js environment or module not available
  }

  return 'unknown';
}
