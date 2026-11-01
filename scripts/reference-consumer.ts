/**
 * Installs the packed tarball into the reference consumer and runs its checks: Prisma client
 * generation, a TypeScript build against the published declarations, the application tests
 * against PostgreSQL, OpenAPI generation, a generated HeyAPI client and its typecheck.
 *
 * Requires a built dist/ and REFERENCE_DATABASE_URL, a test database administrator connection
 * that may create schemas and roles. Set KEEP_REFERENCE_CONSUMER=1 to keep the temporary copy.
 */
import { type SpawnSyncOptions, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = join(packageRoot, 'fixtures/reference-consumer');
const quickStartRoot = join(packageRoot, 'docs/snippets/quick-start');
const databaseUrl = process.env.REFERENCE_DATABASE_URL ?? process.env.RLS_TEST_DATABASE_URL;

/** Runs a check that must fail, and prints the first line of its error. */
function runExpectingFailure(command: string, args: string[], options: SpawnSyncOptions = {}) {
  console.log(`\n$ ${command} ${args.join(' ')} (expected to fail)`);
  const result = spawnSync(command, args, { ...options, encoding: 'utf8', stdio: 'pipe' });
  if (result.status === 0) throw new Error(`${command} ${args.join(' ')} unexpectedly passed`);
  const reason = `${result.stderr}`.split('\n').find((line) => /Error|!==/.test(line));
  console.log(`Failed as expected: ${reason?.trim() ?? `exit code ${result.status}`}`);
}

function run(command: string, args: string[], options: SpawnSyncOptions = {}) {
  console.log(`\n$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

if (!databaseUrl) {
  throw new Error('Set REFERENCE_DATABASE_URL (or RLS_TEST_DATABASE_URL) to a test database');
}

const packDir = mkdtempSync(join(tmpdir(), 'glasswork-pack-'));
const consumerDir = mkdtempSync(join(tmpdir(), 'glasswork-reference-'));
const inConsumer = { cwd: consumerDir };

try {
  run('npm', ['pack', '--pack-destination', packDir], { cwd: packageRoot });
  const tarball = readdirSync(packDir).find((name) => name.endsWith('.tgz'));
  if (!tarball) throw new Error(`No .tgz found in ${packDir}`);

  cpSync(fixtureRoot, consumerDir, {
    recursive: true,
    filter: (source) =>
      !/[/\\](node_modules|dist|client|bundle[\w-]*|src[/\\]generated)$/.test(source),
  });
  cpSync(quickStartRoot, join(consumerDir, 'quick-start'), { recursive: true });
  run('npm', ['install', '--no-audit', '--no-fund', join(packDir, tarball)], inConsumer);
  run('npx', ['prisma', 'generate'], inConsumer);
  run('npx', ['tsc', '-p', 'tsconfig.json'], inConsumer);
  const withDatabase = {
    ...inConsumer,
    env: { ...process.env, NODE_ENV: 'test', REFERENCE_DATABASE_URL: databaseUrl },
  };
  run(
    'node',
    ['--test', '--test-concurrency=1', '--test-force-exit', 'dist/test/**/*.test.js'],
    withDatabase
  );
  run('node', ['dist/src/openapi.js', '--check'], inConsumer);
  run(
    'npx',
    ['openapi-ts', '--input', './contract/openapi.json', '--output', 'client'],
    inConsumer
  );
  run('npx', ['tsc', '-p', 'tsconfig.client.json'], inConsumer);
  run('node', ['scripts/bundle.mjs', '--outdir=bundle'], inConsumer);
  run('node', ['scripts/check-bundles.mjs', 'bundle'], withDatabase);
  // Class providers derive their token from the class name, which minification shortens.
  run(
    'node',
    ['scripts/bundle.mjs', '--outdir=bundle-no-names', '--without=keepNames'],
    inConsumer
  );
  runExpectingFailure('node', ['scripts/check-bundles.mjs', 'bundle-no-names'], withDatabase);
  // The quick start from the documentation, typechecked and run as written.
  run('npx', ['tsc', '-p', 'quick-start/tsconfig.json'], inConsumer);
  run('node', ['scripts/check-quick-start.mjs'], inConsumer);
  console.log('\nReference consumer passed.');
} finally {
  rmSync(packDir, { recursive: true, force: true });
  if (process.env.KEEP_REFERENCE_CONSUMER) console.log(`Kept ${consumerDir}`);
  else rmSync(consumerDir, { recursive: true, force: true });
}
