/** Minimal CASL ability surface used by {@link withCaslScope}. */
export interface CaslAbilityLike {
  readonly rules: readonly unknown[];
  can(action: string, subject: unknown): boolean;
}

/** Stored integration function type. */
export type CaslAccessibleBy = {
  bivarianceHack(
    ability: CaslAbilityLike,
    action?: string
  ): {
    ofType: (subject: string) => Record<string, unknown>;
  };
}['bivarianceHack'];

/** Consumer registration type (bivariant so `accessibleBy` from any `@casl/prisma` install fits). */
export type CaslAccessibleByRegistration = {
  bivarianceHack(
    ability: CaslAbilityLike,
    action?: string
  ): {
    ofType: (subject: string) => Record<string, unknown>;
  };
}['bivarianceHack'];

interface CaslConfig {
  accessibleBy: CaslAccessibleBy | null;
}

const config: CaslConfig = {
  accessibleBy: null,
};

/**
 * Register CASL integration dependencies.
 * This must be called at application startup if you use CASL features.
 *
 * @example
 * ```typescript
 * import { accessibleBy } from '@casl/prisma';
 * import { registerCasl } from 'glasswork/list-query';
 *
 * registerCasl({ accessibleBy });
 * ```
 */
export function registerCasl(options: { accessibleBy: CaslAccessibleByRegistration }): void {
  config.accessibleBy = options.accessibleBy;
}

function getAccessibleBy(): CaslAccessibleBy {
  if (!config.accessibleBy) {
    throw new Error(
      'CASL integration not configured. You must call registerCasl({ accessibleBy }) at application startup.\n' +
        'Example:\n' +
        "  import { accessibleBy } from '@casl/prisma';\n" +
        "  import { registerCasl } from 'glasswork/list-query';\n" +
        '  registerCasl({ accessibleBy });'
    );
  }
  return config.accessibleBy;
}

/**
 * Create a CASL scope helper that extracts ability from context
 *
 * @param ability - The CASL ability instance
 * @param action - The action to check ('read', 'update', etc.)
 * @param subject - The Prisma model name (e.g., 'User', 'Organization')
 * @returns The CASL conditions object (Prisma where clause)
 *
 * @example
 * ```typescript
 * import { accessibleBy } from '@casl/prisma';
 *
 * const params = createListQuery({ filter: UserFilterSchema })
 *   .parse(query)
 *   .scope(withCaslScope(ability, 'read', 'User'))
 *   .build();
 * ```
 */
export function withCaslScope(ability: CaslAbilityLike, action: string, subject: string) {
  const accessibleBy = getAccessibleBy();
  return accessibleBy(ability, action).ofType(subject);
}
