import { type Config, createConfig, defineModule, envProvider, toCamelCase } from 'glasswork/core';
import * as v from 'valibot';

/** What the application needs from its environment, validated when it starts. */
export const ConfigSchema = v.object({
  databaseUrl: v.pipe(v.string(), v.minLength(1)),
  databaseSchema: v.optional(v.string(), 'public'),
});

export type AppConfig = Config<typeof ConfigSchema>;

/** Reads the environment when the provider is resolved, so tests can set it first. */
export function loadConfig(): Promise<AppConfig> {
  return createConfig({
    schema: ConfigSchema,
    providers: [envProvider()],
    transformKey: toCamelCase,
  });
}

export const ConfigModule = defineModule({
  name: 'config',
  providers: [{ provide: 'config', useFactory: async () => loadConfig() }],
  exports: ['config'],
});
