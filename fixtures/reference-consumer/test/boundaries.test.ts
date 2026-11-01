import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Module DI boundaries do not stop a TypeScript import of another module's internals, or a
 * query on another module's tables through a shared Prisma client. These checks catch the
 * common cases; they are not a security boundary and do not see dynamic access.
 */
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');

/** Which top-level folder owns each Prisma model. */
const modelOwners: Record<string, string> = {
  project: 'projects',
  invitation: 'invitations',
  order: 'orders',
  pendingNotification: 'orders',
  stockItem: 'inventory',
  reservation: 'inventory',
  auditLog: 'platform',
};

/** Deliberate reads of another module's data. Writes are never allowed. */
const readExceptions = [
  {
    folder: 'invitations',
    model: 'project',
    reason: 'checks that the project exists in the same transaction as the invitation',
  },
  { folder: 'reporting', model: 'order', reason: 'the order report reads across modules' },
  { folder: 'reporting', model: 'reservation', reason: 'the order report reads across modules' },
];

const readMethods = new Set(['findUnique', 'findFirst', 'findMany', 'count', 'aggregate']);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** The top-level folder below src, or undefined for files directly in src. */
function folderOf(path: string): string | undefined {
  const parts = relative(sourceRoot, path).split(sep);
  return parts.length > 1 ? parts[0] : undefined;
}

function importSpecifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  // `from '…'`, `import('…')` and side-effect `import '…'`.
  return [...source.matchAll(/(?:\bfrom|\bimport\s*\(?)\s*['"]([^'"]+)['"]/g)].map(
    ([, specifier]) => specifier as string
  );
}

function relativeImports(file: string): string[] {
  return importSpecifiers(file)
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) => resolve(dirname(file), specifier));
}

const files = sourceFiles(sourceRoot);
const modelAccess = new RegExp(`\\.(${Object.keys(modelOwners).join('|')})\\.(\\w+)\\(`, 'g');

describe('module boundaries in code', () => {
  it('imports another module folder only through its *.module.ts files', () => {
    const violations = files.flatMap((file) =>
      relativeImports(file)
        .filter((target) => {
          const targetFolder = folderOf(target);
          return (
            targetFolder !== undefined &&
            targetFolder !== folderOf(file) &&
            targetFolder !== 'generated' &&
            !target.endsWith('.module.js')
          );
        })
        .map((target) => `${relative(sourceRoot, file)} -> ${relative(sourceRoot, target)}`)
    );

    assert.deepEqual(violations, []);
  });

  it('keeps platform code independent of feature modules', () => {
    const violations = files
      .filter((file) => folderOf(file) === 'platform')
      .flatMap((file) =>
        relativeImports(file)
          .filter((target) => !['platform', 'generated', undefined].includes(folderOf(target)))
          .map((target) => `${relative(sourceRoot, file)} -> ${relative(sourceRoot, target)}`)
      );

    assert.deepEqual(violations, []);
  });

  it('keeps domain files free of Prisma, Glasswork and other packages', () => {
    const violations = files
      .filter((file) => file.endsWith('.domain.ts'))
      .flatMap((file) =>
        importSpecifiers(file)
          .filter((specifier) => !/^\.{1,2}\/.*\.domain\.js$/.test(specifier))
          .map((specifier) => `${relative(sourceRoot, file)} -> ${specifier}`)
      );

    assert.deepEqual(violations, []);
  });

  it('writes each table only from the module that owns it', () => {
    const violations = files.flatMap((file) => {
      const folder = folderOf(file);
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(modelAccess)]
        .filter(([, model, method]) => {
          const owner = modelOwners[model as string];
          if (owner === folder) return false;
          const isRead = readMethods.has(method as string);
          return !(
            isRead && readExceptions.some((rule) => rule.folder === folder && rule.model === model)
          );
        })
        .map(([access]) => `${relative(sourceRoot, file)}: ${access}`);
    });

    assert.deepEqual(violations, []);
  });
});
