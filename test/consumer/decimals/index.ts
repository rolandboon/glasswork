/**
 * Type checks for an application that declares `decimals: 'string'` and `strictTypes: true`
 * in `GlassworkConfig`. The declaration is global to a program, so this consumer compiles
 * separately from `../index.ts`, which checks the defaults.
 */

import type { PrismaDecimalLike } from 'glasswork';
import { bootstrap, createRoutes, createSerializationConfig, defineModule } from 'glasswork';
import { number, object, string } from 'valibot';

declare module 'glasswork' {
  interface GlassworkConfig {
    decimals: 'string';
    strictTypes: true;
  }
}

declare const price: PrismaDecimalLike;
declare const createdAt: Date;

const routes = createRoutes((_router, _services, route) => {
  route({
    responses: { 200: object({ price: string(), createdAt: string() }) },
    strictTypes: false,
    // Decimals serialize to strings, so string fields accept them; date fields accept Date.
    handler: () => ({ price, createdAt }),
  });

  route({
    responses: { 200: object({ price: string(), count: number() }) },
    strictTypes: false,
    // @ts-expect-error Decimals no longer serialize to numbers, so number fields reject them.
    handler: () => ({ price, count: price }),
  });

  route({
    responses: { 200: object({ price: string(), createdAt: string() }) },
    // @ts-expect-error strictTypes applies to every route, so Prisma types are rejected.
    handler: () => ({ price, createdAt }),
  });

  route({
    responses: { 200: object({ price: string(), createdAt: string() }) },
    // strictTypes requires the schema types exactly
    handler: () => ({ price: '10.50', createdAt: '2025-01-01T00:00:00.000Z' }),
  });
});

const AppModule = defineModule({ name: 'app', basePath: 'app', routes });

export async function start() {
  // The bootstrap option must match the declaration above.
  await bootstrap(AppModule, { serialization: { decimals: 'string', strictTypes: true } });

  // @ts-expect-error The declaration requires the serialization option.
  await bootstrap(AppModule);

  // @ts-expect-error The declaration requires decimals: 'string'.
  await bootstrap(AppModule, { serialization: { decimals: 'number', strictTypes: true } });

  // @ts-expect-error The declaration requires strictTypes: true.
  await bootstrap(AppModule, { serialization: { decimals: 'string' } });
}

// Serialization outside routes follows the configuration it receives.
const config = createSerializationConfig({ decimals: 'string' });
export const serializedPrice: string = (await import('glasswork')).serializePrismaTypes(
  { price },
  config
).price;
