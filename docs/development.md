# Development

This guide is for working on wandelzeug itself.

## Set up and check

The development tools are pinned in `package.json`, and [just](https://just.systems) runs the same recipes locally and in CI. To install the tools and run every check, run the following commands:

```sh
bun install
just ci
```

`just ci` checks the formatting with Prettier, checks the types with TypeScript, runs the tests, and builds `dist/wlz.js`. It then runs the bundle as `wlz check` on the change files of wandelzeug. To format the code, run `just format`.

To run `wlz` from a checkout, run `bun link` in it. `wlz` then runs the code of the checkout until you run `bun unlink`.

## Record your changes

wandelzeug keeps its own changelog with wandelzeug. To record a change that users notice, run `bun src/cli.ts new` in the checkout, and commit the change file together with the change.

## Source layout

The source lives in TypeScript modules below `src/`, grouped by concern, with each module's tests next to it:

- `src/cli.ts` is the entry point and runs the commands.
- `src/cli/` holds the command line grammar, its help text and colour theme, and the value parsers for options and arguments, built with [Optique](https://optique.dev).
- `src/shared/` holds helpers, templates, slugs, and versions.
- `src/project/` holds the configuration, project roots, `init`, `check`, `release`, and the replacements.
- `src/changes/` holds change files, extra fields, and the input of `new`, including its questions and drafts.
- `src/changelog/` holds the changelog markers and releases.

`just build` bundles the modules with `bun build` into the single file `dist/wlz.js`, which git ignores.

## Release wandelzeug

wandelzeug tags its own releases with [semverkzeug](https://github.com/0x5a17ed/semverkzeug) 0.8.0 or later, as `tagHelper` in `.changes/config.yaml` says. To release, run the following commands on a clean checkout of `main`:

```sh
bun src/cli.ts release auto
git push --follow-tags
```

Pushing the tag starts the release workflow in `.github/workflows/release.yaml`. It runs every check, builds `wlz.js`, and creates the GitHub release with the notes of the release from the changelog. The release carries `wlz.js`, its checksum in `SHA256SUMS`, and an attestation of the build provenance of `wlz.js`. A version such as `1.0.0-rc.1` becomes a prerelease.

The CI workflow rehearses this process on every push and pull request. In a copy of the checkout, it releases the pending changes with semverkzeug, or a change of its own when none is pending. It then prepares the release assets and prints the command that would create the GitHub release. The job summary shows the release notes and the checksums. To rehearse locally, run `just rehearse-release`, which needs semverkzeug and a clean checkout and leaves the repository as it is.
