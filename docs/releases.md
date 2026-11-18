# Releases

This guide covers how wandelzeug picks versions, how `wlz release` commits and tags a release, how version numbers in other files stay in step, and how projects in a monorepo work.

## Versions

`batch` takes either a semantic version, such as `1.4.0`, or a bump: `major`, `minor`, `patch`, or `auto`. The `auto` bump picks the most significant bump among the kinds of the unreleased changes. Bumps start from the latest stable release in the changelog, or from the baseline, and skip prereleases. New releases carry the configured `versionPrefix`, which defaults to none, so a release is named like `1.4.0`.

To see a version without writing anything, use one of the following commands:

- `latest` prints the newest release in the changelog, or the baseline.
- `next BUMP` prints the version that a bump yields.
- `batch VERSION --dry-run` prints the release, with its markers, that `batch` would insert.

## Release and tag

`batch` only changes the changelog. To also commit the release and tag it, use `release`, which takes a bump: `major`, `minor`, `patch`, or `auto`. It hands the tagging to [semverkzeug](https://github.com/0x5a17ed/semverkzeug), which derives versions from git tags and creates annotated, optionally signed tags:

```sh
wlz release auto
```

`release` takes these steps:

1. It asks semverkzeug for a dry run of the bump with the version that the changelog expects. semverkzeug also checks that the working tree is clean. When the tag history and the changelog disagree, `release` stops before it changes anything.
2. It adds the release to the changelog, updates the files of the [replacements](#update-version-numbers-in-other-files), removes the change files, and commits all of them as `release 1.2.0`.
3. It has semverkzeug tag that commit, with the release notes as the tag message.

To check a release without changing anything, pass `--dry-run`. If tagging fails after the commit, for example because signing fails, the error names the untagged commit and the command to tag it.

`release` needs semverkzeug 0.8.0 or later, whose `bump` command has the options `--expect`, `--message-file`, and `--dry-run`. The `tagHelper` setting in `.changes/config.yaml` chooses the command, and defaults to `semverkzeug`. It runs through the shell, so it can carry arguments, as in `nix run nixpkgs#semverkzeug --`. Any other command that accepts `bump PART` with those options works as well.

In a monorepo, semverkzeug scopes the tags of a project by its directory, as in `mod/v1.2.0`. Set `tagPrefix` to `mod/v` so that the compare links use those tags.

## Update version numbers in other files

Some files repeat the version of a release, such as the `version` field in `package.json`. To have `batch` and `release` update them, list them under `replacements` in `.changes/config.yaml`:

```yaml
replacements:
  - path: package.json
    find: '"version": "[^"]*"'
    replace: '"version": "{{version}}"'
```

Each replacement has these settings:

- `path`: the file, relative to the project root.
- `find`: a JavaScript regular expression. `^` and `$` match at line breaks, so a pattern can anchor to a line.
- `replace`: a Mustache template with the values of `versionFormat`, such as `version` and `tag`. The `version` value carries the `versionPrefix`. The rendered text replaces every match as it is, so a `$` in it stays a `$`.

When a pattern matches nothing, `batch` and `release` stop before they change anything, so no file keeps an old version unnoticed. `release` commits these files together with the changelog.

## Projects in a monorepo

Each project keeps its own `.changes` directory with its configuration in `.changes/config.yaml`. wandelzeug looks for `.changes/config.yaml` in the current directory and then in each parent directory, so you can run it anywhere inside a project. To work on another project, pass `-C DIRECTORY`.
