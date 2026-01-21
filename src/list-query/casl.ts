// Configuration storage
export type CaslAccessibleBy = (
  // biome-ignore lint/suspicious/noExplicitAny: Must use any to be compatible with @casl/prisma's stricter argument type
  ability: any,
  action?: string
) => Record<string, Record<string, unknown>>;

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
 * import { registerCasl } from 'glasswork';
 *
 * registerCasl({ accessibleBy });
 * ```
 */
export function registerCasl(options: { accessibleBy: CaslAccessibleBy }) {
  config.accessibleBy = options.accessibleBy;
}

function getAccessibleBy(): CaslAccessibleBy {
  if (!config.accessibleBy) {
    throw new Error(
      'CASL integration not configured. You must call registerCasl({ accessibleBy }) at application startup.\n' +
        'Example:\n' +
        "  import { accessibleBy } from '@casl/prisma';\n" +
        "  import { registerCasl } from 'glasswork';\n" +
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
// biome-ignore lint/suspicious/noExplicitAny: Ability type is generic
export function withCaslScope<TAbility = any>(ability: TAbility, action: string, subject: string) {
  const accessibleBy = getAccessibleBy();
  const conditions = accessibleBy(ability, action);

  if (!(subject in conditions)) {
    // Return empty object or undefined? Prisma generally assumes conditions exist if asked.
    // If we assume accessibleBy returns all possible subjects, then missing key might be fine or error.
    // Let's just return what is there, which is undefined if missing. The types expect Record<string, unknown>.
    // Casting to allow potentially undefined access if user made a typo.
    return conditions[subject];
  }
  return conditions[subject];
}
