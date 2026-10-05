import { bootstrap } from './bootstrap.js';
import type { BootstrapOptions, ModuleConfig } from './types.js';

/** Generates route contracts without runtime provider initialization or a server. */
export async function generateOpenAPI(
  module: ModuleConfig,
  options: Omit<BootstrapOptions, 'mode'> = {}
) {
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
