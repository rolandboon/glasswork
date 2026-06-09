import { ForbiddenException, UnauthorizedException } from './errors.js';
import type { RouteContext } from './route-types.js';

export function enforceRouteAuthorization(
  authorize: {
    action: string;
    subject: string | { __caslSubjectType__?: string };
    allowGuest?: boolean;
  },
  routeContext: RouteContext<unknown, unknown, unknown, false>
): void {
  const ability = (routeContext as { ability?: { can?: (a: string, s: unknown) => boolean } })
    .ability;
  const user = (routeContext as { user?: unknown | null }).user;
  const isAuthenticated =
    (routeContext as { isAuthenticated?: boolean }).isAuthenticated ?? Boolean(user);
  const allowGuest = authorize.allowGuest ?? false;

  if (!isAuthenticated && !allowGuest) {
    throw new UnauthorizedException('Authentication required');
  }

  const canAccess = ability?.can?.(authorize.action, authorize.subject as never);

  if (!canAccess) {
    if (!isAuthenticated) {
      throw new UnauthorizedException('Authentication required');
    }

    throw new ForbiddenException(
      `You don't have permission to ${authorize.action} ${authorize.subject}`
    );
  }
}
