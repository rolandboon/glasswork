/**
 * Named exports of a dynamically imported module.
 *
 * Node exposes the named exports of a CommonJS package through `import()`, but a bundler that
 * turns the package into an ESM chunk may expose them only as `default`. Optional peers such
 * as the AWS SDK clients are CommonJS packages, so read their exports from either place.
 */
export function namedExports<T extends object>(module: T): T {
  // Check first: module mocks may throw for an export they do not define.
  const fallback = 'default' in module ? module.default : undefined;
  if (fallback === null || (typeof fallback !== 'object' && typeof fallback !== 'function')) {
    return module;
  }
  return { ...fallback, ...module } as T;
}
