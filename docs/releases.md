# Releases

This guide covers how wandelzeug picks versions, how `wlz release` commits and tags a release, how to choose the tagging command, the tag messages, how version numbers in other files stay in step, and how projects in a monorepo work.

## Versions

`batch` takes either a semantic version, such as `1.4.0`, or a bump: `major`, `minor`, `patch`, or `auto`. The `auto` bump picks the most significant bump among the unreleased changes: a breaking change bumps the major version, and any other change bumps as its kind says, see [Breaking changes](changes.md#breaking-changes). Bumps start from the latest stable release in the changelog, or from the baseline, and skip prereleases. New releases carry the configured `versionPrefix`, which defaults to none, so a release is named like `1.4.0`.

To see a version without writing anything, use one of the following commands:

- `latest` prints the newest release in the changelog, or the baseline.
- `next BUMP` prints the version that a bump yields.
- `batch VERSION --dry-run` prints the release, with its markers, that `batch` would insert.

### Initial development

Semantic Versioning reserves versions below 1.0.0 for initial development, where anything may change. While the latest stable release is 0.y.z, or nothing is released yet, the `bumpStrategy` setting decides how `auto` treats the bumps of the changes:

| Strategy | Breaking change | Minor change | Patch change |
|---|---|---|---|
| `minor-capped`, the default | minor | minor | patch |
| `shifted` | minor | patch | patch |
| `literal` | major | minor | patch |

With `minor-capped`, a release with a breaking change goes from 0.3.0 to 0.4.0 instead of 1.0.0. `shifted` follows how Cargo and the caret ranges of npm read 0.y.z versions, where the minor version marks incompatible changes. `literal` applies the bumps as they are, so a breaking change releases 1.0.0.

From 1.0.0 on, every strategy bumps as the changes say. An explicit bump always applies as given, so to release 1.0.0, run `wlz release major` or `wlz batch 1.0.0`. The `{{bump}}` value of the tag helper holds the bump after the strategy, see [Choose how releases get tagged](#choose-how-releases-get-tagged).

## Release and tag

`batch` only changes the changelog. To also commit the release and tag it, use `release`, which takes a bump: `major`, `minor`, `patch`, or `auto`:

```sh
wlz release auto
```

`release` takes these steps:

1. It checks that the files of the release, such as the changelog, hold no uncommitted changes, and that the tag doesn't exist yet. Then it runs the `check` command of the tag helper, if there is one. When a check fails, `release` stops before it changes anything.
2. It adds the release to the changelog, updates the files of the [replacements](#update-version-numbers-in-other-files), removes the change files, and commits all of them as `release 1.2.0`.
3. It runs the `create` command of the tag helper, which tags that commit with a message that `tagTemplate` renders, see [Tag messages](#tag-messages).

To check a release without changing anything, pass `--dry-run`. If tagging fails after the commit, for example because signing fails, the error names the untagged commit, keeps the tag message in a file, and shows the command to tag the commit.

## Choose how releases get tagged

The `tagHelper` setting in `.changes/config.yaml` holds the commands that tag a release. By default, git creates an annotated tag, which it signs when the git setting `tag.gpgSign` is on:

```yaml
tagHelper:
  create: [git, tag, --annotate, --cleanup=whitespace, --file, "{{messageFile}}", "{{tag}}", "{{commit}}"]
```

The setting has these entries:

- `create`: the command that creates the tag.
- `check`: an optional command that runs before anything changes. When it fails, the release stops.
- `env`: environment variables for both commands, on top of those of wandelzeug, such as `GIT_COMMITTER_EMAIL: "release@example.com"`.

The commands run in the project root without a shell. Each argument and each variable value is a Mustache template with the following values:

| Value | Meaning |
|-------|---------|
| `version`, `date`, `tag`, `previousVersion`, `previousTag` | The values of `versionFormat` |
| `bump` | The part of the version that the release bumps: `major`, `minor`, or `patch`, after the `bumpStrategy` for `auto` |
| `root` | The project root |
| `message` | The tag message that `tagTemplate` renders |
| `messageFile` | A file that holds the tag message |
| `commit` | The release commit, which only `create` sees, because it exists only after the checks |

To tag with [semverkzeug](https://github.com/0x5a17ed/semverkzeug) 0.8.0 or later, which derives versions from git tags and also checks that the version of the changelog follows from them, use the following setting:

```yaml
tagHelper:
  check: [semverkzeug, -C, "{{root}}", bump, "{{bump}}", --expect, "{{version}}", --dry-run]
  create: [semverkzeug, -C, "{{root}}", bump, "{{bump}}", --expect, "{{version}}", --message-file, "{{messageFile}}"]
```

In a monorepo, semverkzeug scopes the tags of a project by its directory, as in `mod/v1.2.0`. Set `tagPrefix` to `mod/v` so that the compare links and the check for an existing tag use those tags.

## Tag messages

Git hosts such as GitHub show tag messages as plain text, without rendering Markdown. So the tag message has a template of its own, `tagTemplate`, which starts with a subject line and lists the kinds without Markdown headings. By default, a tag message looks like this:

```
release v1.0.0

Added:
* [FOO-1234] Added the thing. ([!19])

[FOO-1234]: <https://jira.corp.com/browse/FOO-1234>
[!19]: <https://gitlab.corp.com/project-url/-/merge_requests/19>
```

`tagTemplate` sees the values of `releaseTemplate`, including `kinds` and the partials `{{> version}}`, `{{> kind}}`, and `{{> change}}`. It also sees `references`, which holds the `label` and the `url` of each reference in the notes, see [Link issues and pull requests](changes.md#link-issues-and-pull-requests). Blank lines at the end of the message disappear, so a blank line before the references only shows when there are some. To list the entries without the kinds, set the template as follows:

```yaml
tagTemplate: |
  release {{tag}}

  {{#kinds}}
  {{#changes}}
  {{> change}}
  {{/changes}}
  {{/kinds}}

  {{#references}}
  [{{label}}]: <{{url}}>
  {{/references}}
```

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
