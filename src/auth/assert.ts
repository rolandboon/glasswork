import type { PureAbility } from '@casl/ability';
import { subject as caslSubject } from '@casl/ability';
import { ForbiddenException, UnauthorizedException } from '../http/errors.js';

type AuthorizableSubject = string | { __caslSubjectType__?: string };

/**
 * Assert that an action can be performed on a subject.
 * Throws ForbiddenException (or Unauthorized when user missing) if not allowed.
 */
export function assertCan<TAbility extends PureAbility>(
  ability: TAbility | undefined,
  action: string,
  subject: AuthorizableSubject,
  opts?: { unauthorizedMessage?: string; forbiddenMessage?: string; isAuthenticated?: boolean }
): void {
  if (!ability) {
    throw new UnauthorizedException(opts?.unauthorizedMessage ?? 'Authentication required');
  }

  const canPerform = ability.can(action, subject as never);

  if (!canPerform) {
    if (opts?.isAuthenticated === false) {
      throw new UnauthorizedException(opts?.unauthorizedMessage ?? 'Authentication required');
    }

    throw new ForbiddenException(
      opts?.forbiddenMessage ?? `You don't have permission to ${action} this resource`
    );
  }
}

/**
 * Check if an action can be performed (without throwing).
 */
export function can<TAbility extends PureAbility>(
  ability: TAbility | undefined,
  action: string,
  subject: AuthorizableSubject
): boolean {
  if (!ability) return false;
  return ability.can(action, subject as never);
}

export { caslSubject as subject };
