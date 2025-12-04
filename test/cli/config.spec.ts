import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCliConfig } from '../../src/cli/config.js';

function createConfig(root: string, contents: string) {
  writeFileSync(join(root, 'glasswork.config.mjs'), contents, 'utf8');
}

describe('loadCliConfig', () => {
  it('loads config file and applies defaults', async () => {
    const root = mkdtempSync(join(tmpdir(), 'glasswork-cli-config-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });

      createConfig(
        root,
        `export default {
          name: 'demo',
          build: { entrypoint: './src/index.ts' },
          email: {
            templates: {
              sourceDir: './emails',
              outputDir: './emails/.compiled'
            }
          }
        };`
      );

      const config = await loadCliConfig({ cwd: root });

      expect(config.build.entrypoint).toBe(join(root, 'src/index.ts'));
      expect(config.build.outFile).toBe('api.mjs'); // default
      expect(config.lambda.runtime).toBe('nodejs22.x'); // default
      expect(config.email?.templates?.outputDir).toBe(join(root, 'emails/.compiled'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('merges overrides and resolves paths', async () => {
    const root = mkdtempSync(join(tmpdir(), 'glasswork-cli-config-'));
    try {
      mkdirSync(join(root, 'src'), { recursive: true });

      createConfig(
        root,
        `export default {
          build: { entrypoint: './src/server.ts', outDir: './build' }
        };`
      );

      const config = await loadCliConfig({
        cwd: root,
        overrides: {
          build: {
            sourcemap: true,
            minify: false,
          },
        },
      });

      expect(config.build.outDir).toBe(join(root, 'build'));
      expect(config.build.sourcemap).toBe(true);
      expect(config.build.minify).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
