import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { loadCliConfig } from '../../src/cli/config.js';
import { generateSamTemplate } from '../../src/cli/generators/sam.js';

describe('generateSamTemplate', () => {
  it('builds resources for api, queues, tables, and static site', async () => {
    const root = mkdtempSync(join(tmpdir(), 'glasswork-sam-generator-'));
    try {
      writeFileSync(
        join(root, 'glasswork.config.mjs'),
        `export default {
          name: 'sam-test',
          build: { entrypoint: './src/handler.ts', outDir: './dist', outFile: 'api.mjs' },
          lambda: { runtime: 'nodejs22.x' },
          infrastructure: {
            api: { type: 'function-url', cors: true },
            queues: { default: { visibilityTimeout: 100 } },
            tables: { rateLimit: { ttl: 'expiresAt' } },
            staticSite: { distDir: './app/dist', indexDocument: 'index.html' },
            cdn: { enabled: true, domainName: 'example.com' }
          }
        };`,
        'utf8'
      );

      const config = await loadCliConfig({ cwd: root });
      const sam = generateSamTemplate(config);
      const parsed = parse(sam) as {
        Resources: Record<string, unknown>;
        Outputs: Record<string, unknown>;
      };

      expect(parsed.Resources.ApiFunction).toBeDefined();
      expect(parsed.Resources.DefaultQueue).toBeDefined();
      expect(parsed.Resources.DefaultDLQ).toBeDefined();
      expect(parsed.Resources.RateLimitTable).toBeDefined();
      expect(parsed.Resources.StaticSiteBucket).toBeDefined();
      expect(parsed.Resources.CloudFrontDistribution).toBeDefined();
      expect(parsed.Outputs.ApiUrl).toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
