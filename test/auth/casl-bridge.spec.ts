import { createPrismaAbility } from '@casl/prisma';
import { describe, expect, it } from 'vitest';
import { getPrismaAbilityFactory, registerAuthCasl } from '../../src/auth/casl-bridge.js';

describe('registerAuthCasl', () => {
  it('stores createPrismaAbility for auth helpers', () => {
    registerAuthCasl({ createPrismaAbility });
    expect(getPrismaAbilityFactory()).toBe(createPrismaAbility);
  });
});
