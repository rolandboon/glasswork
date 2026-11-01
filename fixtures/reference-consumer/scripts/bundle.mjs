/**
 * Bundles the Lambda and Node entry points with the build options the deployment guide
 * documents. `--without=<workaround>` drops one of them, to check whether it is still needed.
 */
import { writeFile } from 'node:fs/promises';
import * as esbuild from 'esbuild';

const without = new Set(
  process.argv
    .filter((arg) => arg.startsWith('--without='))
    .flatMap((arg) => arg.slice(10).split(','))
);
const outdir = process.argv.find((arg) => arg.startsWith('--outdir='))?.slice(9) ?? 'bundle';

/** hono-openapi can convert schemas of libraries this application does not install. */
const optionalSchemaVendors = {
  name: 'optional-schema-vendors',
  setup(build) {
    build.onResolve(
      {
        filter:
          /^(effect|zod(?:\/.*)?|zod-openapi|zod-to-json-schema|arktype|sury|@sinclair\/typebox)$/,
      },
      ({ path, importer }) =>
        importer.includes('/node_modules/@standard-community/')
          ? { path, external: true }
          : undefined
    );
  },
};

const result = await esbuild.build({
  entryPoints: { lambda: 'src/lambda.ts', server: 'src/server.ts' },
  outdir,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  bundle: true,
  splitting: true,
  minify: true,
  keepNames: !without.has('keepNames'),
  metafile: true,
  // Glasswork loads optional AWS clients on demand; Lambda provides them, containers install
  // the ones they use.
  external: ['@aws-sdk/*'],
  outExtension: { '.js': '.mjs' },
  plugins: without.has('schemaVendors') ? [] : [optionalSchemaVendors],
  banner: without.has('createRequire')
    ? {}
    : {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
  logLevel: 'warning',
});

await writeFile(`${outdir}/meta.json`, JSON.stringify(result.metafile));
