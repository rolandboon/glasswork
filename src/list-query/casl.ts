import type { accessibleBy as caslAccessibleBy } from '@casl/prisma';

// Configuration storage
export type CaslAccessibleBy = typeof caslAccessibleBy;

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
export function registerCasl(options: { accessibleBy: CaslAccessibleBy }) {
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
export function withCaslScope(
  ability: Parameters<CaslAccessibleBy>[0],
  action: string,
  subject: string
) {
  const accessibleBy = getAccessibleBy();
  return accessibleBy(ability, action).ofType(subject);
}
