# wandelzeug

wandelzeug records each changelog entry as its own small Markdown file and adds those entries to your `CHANGELOG.md` when you release. It follows the workflow of [changie](https://changie.dev), but it runs on Bun and installs as the `wlz` command. Use it when several branches add changelog entries at the same time and you want to avoid merge conflicts in one shared file.

## Install

wandelzeug needs Bun 1.3 or later. To install the `wlz` command globally, run the following command:

```sh
bun add -g git+REPOSITORY_URL
```

Replace `REPOSITORY_URL` with the HTTPS address of the wandelzeug repository. Bun links `wlz` into `~/.bun/bin`, which must be on your `PATH`.

- To update to the newest commit, run `bun update -g wandelzeug`. Running `bun add -g` again keeps the installed commit.
- To uninstall, run `bun remove -g wandelzeug`.
- To work on wandelzeug itself, run `bun link` in a checkout. `wlz` then runs the code of the checkout until you run `bun unlink`.

To use a single file instead, for example to keep wandelzeug inside another repository, take the bundle `wlz.js`. CI publishes it as the `wlz` artifact, and `just build` writes it to `dist/wlz.js`. The file is executable, so you can copy it onto your `PATH` as `wlz`.

## Get started

1. In your project root, set up wandelzeug:

   ```sh
   wlz init
   ```

   The command creates the `.changes` directory with the configuration `.changes/config.yaml` and the directory `.changes/unreleased/` for change files. It also creates a `CHANGELOG.md` with the release anchor, or adds the anchor to the one you have, see [Onboard an existing changelog](#onboard-an-existing-changelog). Apart from `.changes` and the changelog, wandelzeug adds nothing to your project.

2. Record a change:

   ```sh
   wlz new --kind Added --body "* Support for TOML config" --meta pr=42
   ```

   The output is `created .changes/unreleased/001-added-support-for-toml-config.md`.

3. Add the unreleased changes to the changelog as a release:

   ```sh
   wlz batch auto
   ```

   The output is `updated CHANGELOG.md from 1 change`, and the fragment files are removed.

Run `wlz --help` for every command and option.

## Change files

Each change is a Markdown file with YAML front matter. The `kind` key is required and must match a configured kind, ignoring case. Any other key, such as `pr` or `mr`, is metadata that templates can use. The body is the Markdown that appears in the changelog:

```md
---
kind: Added
pr: 42
---
* Support for TOML config
```

Change files live in `.changes/unreleased/nnn-NAME.md`. The number `nnn` orders the changes in the changelog: `new` takes the highest existing number plus one, padded to three digits, so the numbering starts again at `001` after a release. `NAME` comes from the `fragmentName` template.

## Record a change

`new` takes the kind, the body, and metadata from its options. When stdin is a terminal, it asks for whatever the options leave out: the kind, a one-line body, and each extra field. You pick the kind and the options of `enum` and `enums` fields from a list, and `new` checks each answer before it moves on. A body line without a list marker becomes a `* ` item. To cancel, press Ctrl+C, and nothing gets recorded.

To write a longer change, pass `--edit`. The command writes a draft to `.changes/.draft.md`, filled in from the options, with comments that list the kinds and the open extra fields, and opens it in `$VISUAL` or `$EDITOR`. After the editor closes, `new` checks the draft. When it has problems, the command asks whether to edit it again. An empty body cancels the change.

The draft stays until the change is recorded, so nothing you write in the editor gets lost. After a problem, a declined edit, or a failed editor, run `wlz new --resume` to reopen the draft. `new --edit` refuses to replace a kept draft. `init` adds a `.changes/.gitignore` that keeps the draft out of version control.

## Extra fields

The `extraFields` setting lists front matter entries besides `kind` that `new` asks for and `check` validates. Their values sit at the top level of the front matter, next to `kind`, and templates use them by key, such as `{{pr}}`. Each entry has a `key`, a `prompt` that defaults to the key, a `type` that defaults to `string`, and a `required` flag that defaults to `false`.

The types and their settings follow changie's custom choices:

| Type | Value | Settings |
|------|-------|----------|
| `string` | One line of text | `minLength`, `maxLength` |
| `block` | Several lines of text, written as a literal block | `minLength`, `maxLength` |
| `int` | A whole number. `#42` and `!42` count as `42`, the way GitHub and GitLab write pull and merge request numbers. | `minInt`, `maxInt` |
| `enum` | One of the options, matched without regard to case | `enumOptions` |
| `enums` | Any of the options, stored as one comma-separated string in the order of the options | `enumOptions` |

The following configuration makes every change carry a pull request number and lets it name an area:

```yaml
extraFields:
  - key: pr
    prompt: Pull request number
    type: int
    minInt: 1
    required: true
  - key: area
    type: enum
    enumOptions: [cli, docs, tests]
```

`new` checks the values after the questions or after the editor closes, and `check` checks them again. Without a terminal, `new` fails when a required field is missing. To leave an optional field empty without a question, pass the key with an empty value, such as `--meta area=`.

## Templates

Templates use [Mustache](https://mustache.github.io/mustache.5.html) without HTML escaping, so Markdown such as `&` or `` ` `` passes through unchanged. `{{name}}` inserts a value, and a section such as `{{#pr}}...{{/pr}}` renders only when the value is set. A missing value renders empty. For example, `{{#pr}}{{pr}}-{{/pr}}{{kind}}-{{title}}` yields `001-42-added-support-for-toml-config.md` with a `pr` value and `001-added-support-for-toml-config.md` without one. A boolean front matter entry works as a switch, as in `{{#breaking}}**Breaking:** {{/breaking}}`.

The following settings in `.changes/config.yaml` are templates:

| Setting | Default | Values |
|---------|---------|--------|
| `fragmentName` | `{{kind}}-{{title}}` | `title` (the first body line without its list marker), `kind`, and any front matter key. Every value becomes a lower-case slug, transliterated to ASCII where possible, such as `groesse-aendern` for "Größe ändern", and `titleMaxLength` limits the title. |
| `versionFormat` | ``## [`{{version}}`] ({{date}})`` | `version`, `date`, `tag`, `previousVersion`, and `previousTag` |
| `kindFormat` | `### {{kind}}` | `kind` |
| `changeFormat` | `{{body}}` | `body`, `kind`, and any front matter key, such as `{{body}}{{#pr}} (#{{pr}}){{/pr}}` |
| `releaseTemplate` | See the following example | The values of `versionFormat`, and `kinds`, where each kind has a `kind` and its `changes` |
| `linkFormat` | See [Links](#links) | The values of `versionFormat`, and `repositoryUrl` |

`releaseTemplate` renders a whole release. By default, it places the three formats as the partials `{{> version}}`, `{{> kind}}`, and `{{> change}}`, each as whole lines:

```yaml
releaseTemplate: |
  {{> version}}
  {{#kinds}}

  {{> kind}}

  {{#changes}}
  {{> change}}
  {{/changes}}
  {{/kinds}}
```

To change a detail, such as a link after each change, edit a format. To change the layout, replace `releaseTemplate`. It can still place the formats, or it can write everything itself. wandelzeug rejects unknown values in `versionFormat` and `kindFormat`, partials outside `releaseTemplate`, and unknown partials, because Mustache would otherwise render them as empty without a trace.

The file that `init` writes explains every other setting, including the paths and the list of kinds.

## The changelog

`CHANGELOG.md` is the only record of past releases. wandelzeug finds its way around the file through HTML comments, which Markdown viewers hide:

```md
# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- wlz:releases baseline=1.4.2 -->

<!-- BEGIN wlz:release 1.6.0 -->
## [`1.6.0`] (2026-11-17)

### Added

* Support for TOML config
<!-- END wlz:release 1.6.0 -->

<!-- BEGIN wlz:release 1.5.0 -->
...
<!-- END wlz:release 1.5.0 -->

## 1.4.2 - 2025-03-02

Older history from before wandelzeug.

<!-- wlz:links -->
[`1.6.0`]: https://codeberg.org/owner/repo/compare/v1.5.0...v1.6.0
[`1.5.0`]: https://codeberg.org/owner/repo/compare/v1.4.2...v1.5.0
```

The anchor `<!-- wlz:releases -->` marks where releases go: `batch` inserts each new release directly below it, so the newest release comes first. Each release sits between `BEGIN` and `END` markers that name its version, which is how `latest`, `next`, and `show` find releases without parsing headings. `batch` only ever inserts, so you can fix a typo inside an older release by hand. The changelog changes only when you release, so branches don't conflict over it. The header above the anchor is yours, and `init` writes the one shown here into a new changelog.

To print the notes of one release, for example for the description of a release on GitHub, run the following command:

```sh
wlz show 1.6.0
```

The output is the text between the release's markers, including its heading.

### Links

`batch` also inserts a link definition for each release directly below the anchor `<!-- wlz:links -->`, which turns the version in the heading into a link. The default `linkFormat` compares the release with the previous one, the way [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) does, and links the tag of a first release:

```yaml
linkFormat: "[`{{version}}`]: {{repositoryUrl}}/{{#previousTag}}compare/{{previousTag}}...{{tag}}{{/previousTag}}{{^previousTag}}releases/tag/{{tag}}{{/previousTag}}"
```

The previous release is the highest earlier version in the changelog or its baseline, so a fix release such as 1.4.3 after 1.5.0 compares with 1.4.2. `{{tag}}` and `{{previousTag}}` carry the `tagPrefix`, which defaults to `v`, because git tags usually do, while release names carry the `versionPrefix`, which defaults to none.

`init` takes `repositoryUrl` from the origin remote of the git repository, turned into an https address, and prints what it found. To choose it yourself, pass `--repository URL`. While `repositoryUrl` is empty, the default links stay off. To turn links off for good, set `linkFormat` to an empty string.

### Keep a Changelog

The default settings follow [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html): the six default kinds are its categories in its order, releases come newest first with an ISO 8601 date, and each version links to its comparison. The headings deliberately differ from its example: ``## [`1.1.2`] (2024-09-27)`` instead of `## [1.1.2] - 2024-09-27`, so the version stands out in a monospaced font. wandelzeug keeps unreleased changes as files in `.changes/unreleased/`, so it doesn't maintain an `## [Unreleased]` section.

## Onboard an existing changelog

When a `CHANGELOG.md` exists already, `init` only adds the two anchors and keeps every other line, including your header:

- The release anchor goes above the first heading that names a version, such as `## 1.4.2` or `## [1.4.2] - 2025-03-02`. In a [Keep a Changelog](https://keepachangelog.com) file, an `## [Unreleased]` section stays above it.
- The newest stable version among those headings becomes the `baseline`, which `latest` and `next` use until wandelzeug records its first release. To choose the baseline yourself, pass `--baseline VERSION`.
- The links anchor goes above the first link definition that names a version, so an `[unreleased]: ...` definition stays above it.
- Without such a heading or definition, the anchor goes to the end of the file.

`init` prints the lines of the anchors and the baseline. They are plain text, so if a guess is wrong, move an anchor line or edit the baseline by hand.

## Check changes in CI

`check` validates every unreleased change against the configured kinds and extra fields, and the markers in the changelog. It reports each problem with its file, and for the changelog with its line. With `--since REF`, it also fails when the commits since the current branch forked from `REF` add or modify no change file. Uncommitted files don't count.

To require a changelog entry in every pull request, run the following command in CI:

```sh
wlz check --since origin/main
```

The check needs the history of `REF`. With `actions/checkout`, set `fetch-depth: 0`.

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

## Development

The development tools are pinned in `package.json`, and [just](https://just.systems) runs the same recipes locally and in CI. To install the tools and run every check, run the following commands:

```sh
bun install
just ci
```

`just ci` checks the formatting with Prettier, checks the types with TypeScript, runs the tests, and builds `dist/wlz.js` and runs it once. To format the code, run `just format`.

The source lives in TypeScript modules below `src/`, grouped by concern, with each module's tests next to it:

- `src/cli.ts` is the entry point and holds the commands.
- `src/shared/` holds helpers, templates, slugs, and versions.
- `src/project/` holds the configuration, project roots, `init`, `check`, `release`, and the replacements.
- `src/changes/` holds change files, extra fields, and the input of `new`, including its questions and drafts.
- `src/changelog/` holds the changelog markers and releases.

`just build` bundles the modules with `bun build` into the single file `dist/wlz.js`, which git ignores.
