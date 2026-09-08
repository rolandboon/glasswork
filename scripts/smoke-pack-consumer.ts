/**
 * Install the packed tarball in a temp project and verify subpath imports.
 * Uses npm (Glasswork is published/consumed as a plain npm package).
 * Run after `npm run build` (dist/ must exist for pack contents).
 */
import { type SpawnSyncOptionsWithStringEncoding, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packDir = mkdtempSync(join(tmpdir(), 'glasswork-pack-'));
const consumerDir = mkdtempSync(join(tmpdir(), 'glasswork-consumer-'));

function run(
  command: string,
  args: string[],
  options: Omit<SpawnSyncOptionsWithStringEncoding, 'encoding'> & { inherit?: boolean } = {}
) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    ...options,
  });
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    throw new Error(`${command} ${args.join(' ')} failed: ${detail}`);
  }
  return result;
}

function cleanup() {
  rmSync(packDir, { recursive: true, force: true });
  rmSync(consumerDir, { recursive: true, force: true });
}

try {
  console.log('Packing glasswork…');
  run('npm', ['pack', '--pack-destination', packDir], { cwd: packageRoot, inherit: true });

  const tarball = readdirSync(packDir).find((name) => name.endsWith('.tgz'));
  if (!tarball) {
    throw new Error(`No .tgz found in ${packDir}`);
  }
  const tarballPath = join(packDir, tarball);

  writeFileSync(
    join(consumerDir, 'package.json'),
    JSON.stringify({ name: 'glasswork-smoke-consumer', type: 'module', private: true }, null, 2)
  );

  const typescriptVersion = process.env.TYPESCRIPT_VERSION ?? '7.0.2';
  console.log(`Installing tarball with documented peers and TypeScript ${typescriptVersion}…`);
  run(
    'npm',
    [
      'install',
      tarballPath,
      'hono',
      'awilix',
      'valibot',
      'hono-openapi',
      '@hono/swagger-ui',
      '@casl/ability',
      '@casl/prisma',
      '@prisma/client@7.10.0',
      '@types/node@20',
      `typescript@${typescriptVersion}`,
    ],
    { cwd: consumerDir, inherit: true }
  );

  cpSync(join(packageRoot, 'test/consumer'), consumerDir, { recursive: true });
  console.log('Checking published declarations and route inference…');
  run(
    'node',
    [join(consumerDir, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.json'],
    { cwd: consumerDir, inherit: true }
  );

  const smokeFile = join(consumerDir, 'smoke.mjs');
  writeFileSync(
    smokeFile,
    `import { createRequire } from 'node:module';
import { bootstrap, defineModule } from 'glasswork/core';
import { createRoutes, route, Hono } from 'glasswork/http';
import { registerAuthCasl } from 'glasswork/auth';
import { registerCasl } from 'glasswork/list-query';
import { createConsoleTracker } from 'glasswork/observability';
import { createRLSExtension, runWithTenant } from 'glasswork/rls';
import { accessibleBy, createPrismaAbility } from '@casl/prisma';
import pkg from 'glasswork/package.json' with { type: 'json' };

registerCasl({ accessibleBy });
registerAuthCasl({ createPrismaAbility });

const checks = [
  ['glasswork/core bootstrap', typeof bootstrap],
  ['glasswork/core defineModule', typeof defineModule],
  ['glasswork/http createRoutes', typeof createRoutes],
  ['glasswork/http route', typeof route],
  ['glasswork/http Hono', typeof Hono],
  ['glasswork/auth registerAuthCasl', typeof registerAuthCasl],
  ['glasswork/list-query registerCasl', typeof registerCasl],
  ['glasswork/observability createConsoleTracker', typeof createConsoleTracker],
  ['glasswork/rls createRLSExtension', typeof createRLSExtension],
  ['glasswork/rls runWithTenant', typeof runWithTenant],
];

for (const [label, type] of checks) {
  if (type !== 'function') {
    throw new Error(\`Expected function export for \${label}, got \${type}\`);
  }
}

const require = createRequire(import.meta.url);
const subpaths = [
  'glasswork/jobs',
  'glasswork/email',
  'glasswork/uploads',
];
for (const subpath of subpaths) {
  require.resolve(subpath);
}

const exportKeys = ['./core', './http', './auth', './list-query', './jobs', './email', './uploads', './observability', './rls'];
for (const key of exportKeys) {
  if (!pkg.exports[key]) {
    throw new Error(\`Missing export map entry: \${key}\`);
  }
}

const root = await import('glasswork');
if (typeof root.bootstrap !== 'function' || typeof root.createRoutes !== 'function') {
  throw new Error('Root glasswork entry must export core + http');
}
if ('registerAuthCasl' in root || 'bootstrapWorker' in root) {
  throw new Error('Root glasswork entry must not export optional subsystems');
}

console.log('Pack consumer smoke test passed.');
`
  );

  console.log('Running import smoke test…');
  run('node', [smokeFile], { cwd: consumerDir, inherit: true });
} finally {
  cleanup();
}
