import type { createPrismaAbility } from '@casl/prisma';

export type PrismaAbilityFactory = typeof createPrismaAbility;

const config: { createPrismaAbility: PrismaAbilityFactory | null } = {
  createPrismaAbility: null,
};

/**
 * Register CASL Prisma ability factory for auth helpers.
 * Must be called at application startup (mirrors {@link registerCasl} in list-query).
 *
 * @example
 * ```typescript
 * import { createPrismaAbility } from '@casl/prisma';
 * import { registerAuthCasl } from 'glasswork/auth';
 *
 * registerAuthCasl({ createPrismaAbility });
 * ```
 */
export function registerAuthCasl(options: {
  createPrismaAbility: PrismaAbilityFactory | ((...args: never[]) => unknown);
}) {
  config.createPrismaAbility = options.createPrismaAbility as PrismaAbilityFactory;
}

export function getPrismaAbilityFactory(): PrismaAbilityFactory {
  if (!config.createPrismaAbility) {
    throw new Error(
      'Auth CASL integration not configured. Call registerAuthCasl({ createPrismaAbility }) at application startup.\n' +
        'Example:\n' +
        "  import { createPrismaAbility } from '@casl/prisma';\n" +
        "  import { registerAuthCasl } from 'glasswork/auth';\n" +
        '  registerAuthCasl({ createPrismaAbility });'
    );
  }
  return config.createPrismaAbility;
}
