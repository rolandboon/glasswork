/**
 * Keep a Changelog helpers for the release workflows.
 *
 *   node scripts/changelog.ts release <version> [date]   Move [Unreleased] into a version section
 *   node scripts/changelog.ts notes <version>            Print the entries of a version section
 *   node scripts/changelog.ts bump                       Print the smallest release [Unreleased] allows
 *   node scripts/changelog.ts check-bump <from> <to>     Fail when <to> is a smaller release than required
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const changelogPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md');
const unreleasedLink = /^\[Unreleased\]: (\S+)\/compare\/(\S+)\.\.\.HEAD$/m;

function findHeading(lines: string[], name: string): number {
  const heading = `## [${name}]`;
  return lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
}

/** Turns the [Unreleased] entries into a dated `version` section and updates the compare links. */
export function releaseChangelog(changelog: string, version: string, date: string): string {
  const lines = changelog.split('\n');
  const unreleased = findHeading(lines, 'Unreleased');
  if (unreleased === -1) {
    throw new Error('CHANGELOG.md has no "## [Unreleased]" section');
  }
  if (findHeading(lines, version) !== -1) {
    throw new Error(`CHANGELOG.md already has a section for ${version}`);
  }
  const link = unreleasedLink.exec(changelog);
  if (!link) {
    throw new Error('CHANGELOG.md has no "[Unreleased]: <repo>/compare/<tag>...HEAD" link');
  }

  lines.splice(unreleased + 1, 0, '', `## [${version}] - ${date}`);
  const [, repository, previousTag] = link;
  return lines
    .join('\n')
    .replace(
      unreleasedLink,
      `[Unreleased]: ${repository}/compare/v${version}...HEAD\n` +
        `[${version}]: ${repository}/compare/${previousTag}...v${version}`
    );
}

/** Returns the entries of a version section without its heading. */
export function releaseNotes(changelog: string, version: string): string {
  const lines = changelog.split('\n');
  const start = findHeading(lines, version);
  if (start === -1) {
    throw new Error(`CHANGELOG.md has no section for ${version}`);
  }
  const end = lines.findIndex(
    (line, index) => index > start && (line.startsWith('## ') || /^\[[^\]]+\]: /.test(line))
  );
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
}

export type Bump = 'major' | 'minor' | 'patch';

const bumpOrder: Bump[] = ['patch', 'minor', 'major'];

/**
 * Returns the smallest release the [Unreleased] entries allow: major for `**Breaking:**`
 * entries or a `### Removed` section, minor for additions, changes and deprecations, and
 * patch for fixes. Returns null when there are no entries.
 */
export function requiredBump(changelog: string): Bump | null {
  const notes = releaseNotes(changelog, 'Unreleased');
  const sections = new Set(
    [...notes.matchAll(/^### (.+)$/gm)].map(([, name]) => name.trim().toLowerCase())
  );
  if (/\*\*Breaking:?\*\*/i.test(notes) || sections.has('removed')) return 'major';
  if (sections.has('added') || sections.has('changed') || sections.has('deprecated')) {
    return 'minor';
  }
  if (sections.has('fixed') || sections.has('security')) return 'patch';
  return null;
}

function parseVersion(version: string): [number, number, number] {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match) throw new Error(`"${version}" is not a semantic version`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Classifies the step from one version to the next, ignoring prerelease suffixes. */
export function versionBump(from: string, to: string): Bump | null {
  const [fromMajor, fromMinor, fromPatch] = parseVersion(from);
  const [toMajor, toMinor, toPatch] = parseVersion(to);
  if (toMajor !== fromMajor) return toMajor > fromMajor ? 'major' : null;
  if (toMinor !== fromMinor) return toMinor > fromMinor ? 'minor' : null;
  if (toPatch !== fromPatch) return toPatch > fromPatch ? 'patch' : null;
  return null;
}

/** Throws when releasing `to` after `from` is a smaller bump than the entries require. */
export function assertBump(changelog: string, from: string, to: string): void {
  const required = requiredBump(changelog);
  if (!required) return;
  const actual = versionBump(from, to);
  if (!actual || bumpOrder.indexOf(actual) < bumpOrder.indexOf(required)) {
    throw new Error(
      `CHANGELOG.md [Unreleased] requires a ${required} release, but ${from} -> ${to} is ${
        actual ? `a ${actual} release` : 'not an increase'
      }`
    );
  }
}

function main([command, ...args]: string[]) {
  const changelog = readFileSync(changelogPath, 'utf8');
  if (command === 'release' && args[0]) {
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(changelogPath, releaseChangelog(changelog, args[0], args[1] ?? today));
  } else if (command === 'notes' && args[0]) {
    const notes = releaseNotes(changelog, args[0]);
    if (notes) process.stdout.write(`${notes}\n`);
  } else if (command === 'bump') {
    process.stdout.write(`${requiredBump(changelog) ?? 'none'}\n`);
  } else if (command === 'check-bump' && args[0] && args[1]) {
    assertBump(changelog, args[0], args[1]);
  } else {
    throw new Error(
      'Usage: changelog.ts release <version> [date] | notes <version> | bump | check-bump <from> <to>'
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
