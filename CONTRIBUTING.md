# Contributing to Glasswork

Setup and verification commands are in the [README](README.md#contributing). This guide
describes how changes are classified, because the classification decides the release,
the changelog entry and the evidence a pull request needs.

## Classifying changes

Every pull request states how it affects the public contract: runtime behavior, exported
types, and installation (entry points, peer dependencies and supported runtimes).

| Class | Meaning | Release | Changelog |
| --- | --- | --- | --- |
| Contract repair | Behavior deviates from what the documentation or types promise, or from an evident safety guarantee | Patch | `### Fixed`, with an upgrade note when applications may rely on the old behavior |
| Additive | A new export, entry point, option or variant; existing imports and behavior keep working | Minor | `### Added` |
| New policy | A deliberate behavior change within the existing API, such as a stricter default | Minor while opt-in, major once it becomes the default | `### Changed`, marked `**Breaking:**` when it changes a default |
| Incompatible | A removed export, or a changed type or behavior that applications rely on | Major | `### Changed` or `### Removed`, marked `**Breaking:**`, with a migration guide |

A release can combine classes; it gets the largest bump any of its entries requires.

## Evidence per class

- **Contract repair**: a test that fails before the change and passes after it, covering
  both the rejected and the accepted case.
- **Additive**: the existing import paths and behavior still pass their tests, and the
  addition works with its minimal set of peer dependencies (`npm run smoke:pack`).
- **New policy**: tests for the old and the new behavior while both exist, and
  documentation of how to opt in or out.
- **Incompatible**: a migration guide with before and after code, and a consumer that
  has been migrated to the new contract.

## Rules

- Do not delay a correctness fix to fit it into a larger release.
- Do not keep an unsafe default only to avoid a major version.
- Add a temporary compatibility option only when it enables a concrete migration. Mark it
  deprecated and name the version that removes it.
- Do not rewrite published versions. Corrections get a new entry.
- Upgrade notes say who has to change what.

## Changelog

Add entries under `## [Unreleased]` in `CHANGELOG.md`, using the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) sections. Start an entry with
`**Breaking:**` when it needs a major release.

`node scripts/changelog.ts bump` prints the smallest release the unreleased entries
require. The release workflow refuses a version below it.
