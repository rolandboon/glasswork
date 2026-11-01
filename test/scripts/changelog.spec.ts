import { describe, expect, it } from 'vitest';
import {
  assertBump,
  releaseChangelog,
  releaseNotes,
  requiredBump,
  versionBump,
} from '../../scripts/changelog.js';

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

function withUnreleased(entries: string): string {
  return changelog.replace('### Added\n\n- A new feature.\n', entries);
}

describe('requiredBump', () => {
  it('should require a minor release for additions', () => {
    expect(requiredBump(changelog)).toBe('minor');
  });

  it('should require a patch release for fixes only', () => {
    expect(requiredBump(withUnreleased('### Fixed\n\n- A bug.\n'))).toBe('patch');
    expect(requiredBump(withUnreleased('### Security\n\n- A leak.\n'))).toBe('patch');
  });

  it('should require a minor release for changes and deprecations', () => {
    expect(requiredBump(withUnreleased('### Changed\n\n- A default.\n'))).toBe('minor');
    expect(requiredBump(withUnreleased('### Deprecated\n\n- An option.\n'))).toBe('minor');
  });

  it('should require a major release for breaking entries and removals', () => {
    expect(requiredBump(withUnreleased('### Fixed\n\n- **Breaking:** a stricter check.\n'))).toBe(
      'major'
    );
    expect(requiredBump(withUnreleased('### Removed\n\n- An export.\n'))).toBe('major');
  });

  it('should ignore released sections', () => {
    expect(requiredBump(withUnreleased(''))).toBeNull();
  });
});

describe('versionBump', () => {
  it.each([
    ['1.5.0', '1.5.1', 'patch'],
    ['1.5.0', '1.6.0', 'minor'],
    ['1.5.0', '2.0.0', 'major'],
    ['1.5.0', '2.0.0-beta.1', 'major'],
    ['2.0.0-beta.1', '2.0.0', null],
    ['1.5.0', '1.4.9', null],
  ])('should classify %s -> %s as %s', (from, to, bump) => {
    expect(versionBump(from, to)).toBe(bump);
  });

  it('should reject a version that is not semantic', () => {
    expect(() => versionBump('1.5', '1.6.0')).toThrow('"1.5" is not a semantic version');
  });
});

describe('assertBump', () => {
  it('should accept a release at least as large as required', () => {
    expect(() => assertBump(changelog, '1.4.0', '1.5.0')).not.toThrow();
    expect(() => assertBump(changelog, '1.4.0', '2.0.0')).not.toThrow();
  });

  it('should reject a release smaller than required', () => {
    expect(() => assertBump(changelog, '1.4.0', '1.4.1')).toThrow(
      'requires a minor release, but 1.4.0 -> 1.4.1 is a patch release'
    );
  });

  it('should accept any release without unreleased entries', () => {
    expect(() => assertBump(withUnreleased(''), '1.4.0', '1.4.1')).not.toThrow();
  });
});
