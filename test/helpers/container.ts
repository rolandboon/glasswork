import type { AwilixContainer } from 'awilix';

/** Typed cradle access in tests (Awilix types `cradle` as `{}` without registration generics). */
export function cradleOf(container: AwilixContainer): Record<string, unknown> {
  return container.cradle as Record<string, unknown>;
}
