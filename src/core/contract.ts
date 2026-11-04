import { bootstrap } from './bootstrap.js';
import type { BootstrapOptions, ModuleConfig, RequiresSerializationOption } from './types.js';

/** Bootstrap options for contract generation; `mode` is always `'contract'`. */
export type GenerateOpenAPIOptions = Omit<BootstrapOptions, 'mode'>;

/**
 * The `options` parameter of `generateOpenAPI()`: required once `GlassworkConfig` requires the
 * `serialization` option, like `bootstrap()`.
 */
export type GenerateOpenAPIArguments = RequiresSerializationOption extends true
  ? [options: GenerateOpenAPIOptions]
  : [options?: GenerateOpenAPIOptions];

/** Generates route contracts without runtime provider initialization or a server. */
export async function generateOpenAPI(module: ModuleConfig, ...args: GenerateOpenAPIArguments) {
  const options: GenerateOpenAPIOptions = args[0] ?? {};
  const result = await bootstrap(module, {
    ...options,
    mode: 'contract',
    logger: { enabled: false, ...options.logger },
    openapi: { ...options.openapi, enabled: true, serveSpecs: false, serveUI: false },
  });
  try {
    if (!result.generateOpenAPI) throw new Error('OpenAPI generation is unavailable');
    return await result.generateOpenAPI();
  } finally {
    await result.container.dispose();
  }
}
