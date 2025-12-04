import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BuildPipeline } from '../../src/cli/build/pipeline.js';
import { loadCliConfig } from '../../src/cli/config.js';

describe('BuildPipeline', () => {
  it('bundles the entrypoint and runs hooks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'glasswork-build-pipeline-'));

    try {
      const srcDir = join(root, 'src');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, 'handler.ts'), 'export const handler = () => "ok";', 'utf8');

      writeFileSync(
        join(root, 'glasswork.config.mjs'),
        `export default {
          build: { entrypoint: './src/handler.ts', outDir: './out', outFile: 'api.mjs', minify: false },
          lambda: { runtime: 'nodejs22.x' }
        };`,
        'utf8'
      );

      const config = await loadCliConfig({ cwd: root });
      const before = vi.fn();
      const after = vi.fn();
      config.hooks = { 'build:before': before, 'build:after': after };

      const pipeline = new BuildPipeline(config);
      const summary = await pipeline.run();

      expect(before).toHaveBeenCalled();
      expect(after).toHaveBeenCalled();
      expect(summary.bundle.outfile.endsWith('api.mjs')).toBe(true);
      expect(existsSync(join(root, 'out', 'api.mjs'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('compiles templates when configured', async () => {
    const root = mkdtempSync(join(tmpdir(), 'glasswork-build-pipeline-'));

    try {
      const srcDir = join(root, 'src');
      const emailDir = join(root, 'emails');
      mkdirSync(srcDir, { recursive: true });
      mkdirSync(emailDir, { recursive: true });

      writeFileSync(join(srcDir, 'handler.ts'), 'export const handler = () => "ok";', 'utf8');
      writeFileSync(
        join(emailDir, 'welcome.mjml'),
        `<mjml><mj-body><mj-section><mj-column><mj-text>Hi</mj-text></mj-column></mj-section></mj-body></mjml>`,
        'utf8'
      );

      writeFileSync(
        join(root, 'glasswork.config.mjs'),
        `export default {
          build: { entrypoint: './src/handler.ts', outDir: './out', outFile: 'api.mjs', minify: false },
          email: { templates: { sourceDir: './emails', outputDir: './emails/compiled' } },
          lambda: { runtime: 'nodejs22.x' }
        };`,
        'utf8'
      );

      const config = await loadCliConfig({ cwd: root });
      const pipeline = new BuildPipeline(config);
      const result = await pipeline.compileTemplates();

      expect(result?.count).toBe(1);
      expect(existsSync(join(root, 'emails/compiled/index.ts'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
