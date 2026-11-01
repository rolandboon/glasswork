import { namedExports } from './module-interop.js';

/**
 * Loads an optional peer the first time an adapter needs it, so importing the adapter's entry
 * point works without the peer installed. A missing peer fails with an install hint.
 */
export function optionalDependency<T extends object>(
  name: string,
  user: string,
  load: () => Promise<T>
): () => Promise<T> {
  let loading: Promise<T> | undefined;
  return () => {
    loading ??= load().then(namedExports, (cause: unknown) => {
      loading = undefined;
      throw new Error(`${user} requires ${name}. Install it with: npm install ${name}`, { cause });
    });
    return loading;
  };
}
