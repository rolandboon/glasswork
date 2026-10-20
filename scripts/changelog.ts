/**
 * Keep a Changelog helpers for the release workflows.
 *
 *   node scripts/changelog.ts release <version> [date]   Move [Unreleased] into a version section
 *   node scripts/changelog.ts notes <version>            Print the entries of a version section
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

function main([command, version, date]: string[]) {
  const changelog = readFileSync(changelogPath, 'utf8');
  if (command === 'release' && version) {
    const today = new Date().toISOString().slice(0, 10);
    writeFileSync(changelogPath, releaseChangelog(changelog, version, date ?? today));
  } else if (command === 'notes' && version) {
    const notes = releaseNotes(changelog, version);
    if (notes) process.stdout.write(`${notes}\n`);
  } else {
    throw new Error('Usage: changelog.ts release <version> [date] | notes <version>');
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
