/**
 * A provider is not visible in the module that resolves it. `path` lists the module-qualified
 * providers (`module/provider`) that were being created when the lookup failed, outermost
 * first.
 */
export class ProviderNotAvailableError extends Error {
  readonly path: string[] = [];

  constructor(
    readonly module: string,
    readonly provider: string,
    readonly hint: string
  ) {
    super();
    this.name = 'ProviderNotAvailableError';
    this.message = this.#format();
  }

  /** @internal Records the provider whose creation needed the missing one. */
  requiredBy(token: string): void {
    if (this.path[0] === token) return;
    this.path.unshift(token);
    this.message = this.#format();
  }

  #format(): string {
    const requiredBy = this.path.length > 0 ? ` (required by ${this.path.join(' -> ')})` : '';
    return `Provider "${this.provider}" is not available in module "${this.module}"${requiredBy}. ${this.hint}`;
  }
}
