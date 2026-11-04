/**
 * Application-wide settings that route types read at compile time.
 *
 * `bootstrap()` applies the runtime side through its `serialization` option. Declare the same
 * values here so handler return types follow them: with `decimals: 'string'`, response types
 * accept Decimal values on string fields instead of number fields; with `strictTypes: true`,
 * every route is typed as if it set `strictTypes: true`. The `serialization` option's type
 * follows this declaration, so the two cannot drift apart.
 *
 * @example
 * ```typescript
 * // In your application's type declarations
 * declare module 'glasswork' {
 *   interface GlassworkConfig {
 *     decimals: 'string';
 *     strictTypes: true;
 *   }
 * }
 *
 * // bootstrap() then requires the matching option
 * await bootstrap(AppModule, {
 *   serialization: { decimals: 'string', strictTypes: true },
 * });
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: Designed for module augmentation
export interface GlassworkConfig {}

/**
 * How Decimal values (Prisma, Decimal.js) serialize in responses:
 * - `'number'`: `toNumber()`, which rounds to a double
 * - `'string'`: `toFixed()`, which keeps every digit and the stored scale in plain notation
 */
export type DecimalSerialization = 'number' | 'string';

/** The Decimal serialization declared in {@link GlassworkConfig}; `'number'` when not declared. */
export type ConfiguredDecimalSerialization = GlassworkConfig extends { decimals: 'string' }
  ? 'string'
  : 'number';

/** Whether {@link GlassworkConfig} declares `strictTypes: true` for every route. */
export type ConfiguredStrictTypes = GlassworkConfig extends { strictTypes: true } ? true : false;
