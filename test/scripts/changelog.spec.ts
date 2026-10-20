import { describe, expect, it } from 'vitest';
import { releaseChangelog, releaseNotes } from '../../scripts/changelog.js';

const repository = 'https://github.com/rolandboon/glasswork';

const changelog = `# Changelog

## [Unreleased]

### Added

- A new feature.

## [1.4.0] - 2026-10-06

### Fixed

- A bug.

[Unreleased]: ${repository}/compare/v1.4.0...HEAD
[1.4.0]: ${repository}/compare/v1.3.0...v1.4.0
`;

describe('releaseChangelog', () => {
  it('should move unreleased entries into a dated version section', () => {
    const result = releaseChangelog(changelog, '1.5.0', '2026-10-20');

    expect(result).toBe(`# Changelog

## [Unreleased]

## [1.5.0] - 2026-10-20

### Added

- A new feature.

## [1.4.0] - 2026-10-06

### Fixed

- A bug.

[Unreleased]: ${repository}/compare/v1.5.0...HEAD
[1.5.0]: ${repository}/compare/v1.4.0...v1.5.0
[1.4.0]: ${repository}/compare/v1.3.0...v1.4.0
`);
  });

  it('should add an empty version section when nothing is unreleased', () => {
    const empty = changelog.replace('### Added\n\n- A new feature.\n\n', '');

    const result = releaseChangelog(empty, '1.4.1', '2026-10-20');

    expect(result).toContain('## [Unreleased]\n\n## [1.4.1] - 2026-10-20\n\n## [1.4.0]');
    expect(releaseNotes(result, '1.4.1')).toBe('');
  });

  it('should reject a version that already has a section', () => {
    expect(() => releaseChangelog(changelog, '1.4.0', '2026-10-20')).toThrow(
      'already has a section for 1.4.0'
    );
  });

  it('should require an unreleased section', () => {
    expect(() =>
      releaseChangelog(changelog.replace('## [Unreleased]', ''), '1.5.0', '2026-10-20')
    ).toThrow('no "## [Unreleased]" section');
  });

  it('should require an unreleased compare link', () => {
    expect(() =>
      releaseChangelog(changelog.replace(/^\[Unreleased\]: .*$/m, ''), '1.5.0', '2026-10-20')
    ).toThrow('no "[Unreleased]: <repo>/compare/<tag>...HEAD" link');
  });
});

describe('releaseNotes', () => {
  it('should return the entries of a version section', () => {
    expect(releaseNotes(changelog, '1.4.0')).toBe('### Fixed\n\n- A bug.');
  });

  it('should return the unreleased entries', () => {
    expect(releaseNotes(changelog, 'Unreleased')).toBe('### Added\n\n- A new feature.');
  });

  it('should not match a version that only shares a prefix', () => {
    expect(() => releaseNotes(changelog, '1.4')).toThrow('no section for 1.4');
  });
});
