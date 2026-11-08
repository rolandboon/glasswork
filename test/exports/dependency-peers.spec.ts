import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { describe, expect, it } from 'vitest';

interface Manifest {
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readManifest(directory: string): Manifest {
  return JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')) as Manifest;
}

describe('dependency peers', () => {
  it('declares shared peers with ranges that every runtime dependency accepts', () => {
    const glasswork = readManifest(root);
    const conflicts: string[] = [];

    for (const name of Object.keys(glasswork.dependencies ?? {})) {
      const dependency = readManifest(path.join(root, 'node_modules', name));
      for (const [peer, accepted] of Object.entries(dependency.peerDependencies ?? {})) {
        const declared = glasswork.peerDependencies?.[peer];
        if (declared && !semver.subset(declared, accepted)) {
          conflicts.push(
            `${name}@${dependency.version} accepts ${peer} ${accepted}, Glasswork declares ${declared}`
          );
        }
      }
    }

    expect(conflicts).toEqual([]);
  });
});
