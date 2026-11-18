# The changelog

This guide covers how wandelzeug finds its way around `CHANGELOG.md`, how it renders past releases again, the links of releases, the templates that render a release, and how `wlz init` and `wlz import` adopt an existing changelog.

## Markers

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

<!-- wlz:data date=2026-11-17 hash=h1:wohGM1AA3aJY2u5jLXV2KA
Added:
  - pr: 42
    body: "* Support for TOML config"
-->
<!-- END wlz:release 1.6.0 -->

<!-- BEGIN wlz:release 1.5.0 -->
...
<!-- END wlz:release 1.5.0 -->

## 1.4.2 - 2025-03-02

Older history from before wandelzeug.

<!-- BEGIN wlz:links -->
[`1.6.0`]: https://codeberg.org/owner/repo/compare/v1.5.0...v1.6.0
[`1.5.0`]: https://codeberg.org/owner/repo/compare/v1.4.2...v1.5.0
<!-- END wlz:links -->
```

The anchor `<!-- wlz:releases -->` marks where releases go: `batch` inserts each new release directly below it, so the newest release comes first. Each release sits between `BEGIN` and `END` markers that name its version, which is how `latest`, `next`, and `show` find releases without parsing headings. The changelog changes only when you release, so branches don't conflict over it. The header above the anchor is yours, and `init` writes the one shown here into a new changelog.

The `wlz:data` comment at the bottom of a release is its data block. Its first line holds the date and a hash of the notes as wandelzeug rendered them. Below that come the changes as their change files had them, grouped by kind. It lets `wlz render` render the release again. To leave it out of new releases, set `releaseData` to `false` in `.changes/config.yaml`. The `wlz:links` markers enclose the link definitions that wandelzeug manages. Definitions outside them belong to you.

## Render past releases again

After you change a template or a kind label, render every release again from its data block:

```sh
wlz render
```

The command renders the notes of each release and the link definitions with the current settings, and leaves everything outside the markers alone. To preview the result, pass `--dry-run`, which prints the changelog instead of writing it.

The hash in the data block shows whether someone edited the notes of a release by hand. `wlz check` reports such releases, and `wlz render` refuses to overwrite them. To keep an edit, such as a typo fix, make the same edit in the data block of the release, then run `wlz render --force`, which renders over the edited notes. When a release has changes of a kind that the configuration no longer lists, both commands name the release and the kind.

Releases without a data block keep their notes, and [`wlz import`](#import-existing-releases) can give them one. While any release lacks a data block, `wlz render` also keeps the link definitions as they are, because a link can use the date of its release. It keeps them as well while `repositoryUrl` is empty, so links that are off by accident don't wipe out the definitions.

## Show the notes of a release

To print the notes of one release, for example for the description of a release on GitHub, run the following command:

```sh
wlz show 1.6.0
```

The output is the text between the release's markers, including its heading, followed by the link definitions that the notes use. These include the link of the version in the heading, so the links also work in the description of a GitHub release.

## Links

`batch` also inserts a link definition for each release directly below the marker `<!-- BEGIN wlz:links -->`, which turns the version in the heading into a link. The default `linkFormat` compares the release with the previous one, the way [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) does, and links the tag of a first release:

```yaml
linkFormat: "[`{{version}}`]: {{repositoryUrl}}/{{#previousTag}}compare/{{previousTag}}...{{tag}}{{/previousTag}}{{^previousTag}}releases/tag/{{tag}}{{/previousTag}}"
```

The same markers hold the definitions of references to issues and pull requests, see [Link issues and pull requests](changes.md#link-issues-and-pull-requests). Each release brings its own link and the definitions of the references that it was the first to use, newest release first.

The previous release is the highest earlier version in the changelog or its baseline, so a fix release such as 1.4.3 after 1.5.0 compares with 1.4.2. `{{tag}}` and `{{previousTag}}` carry the `tagPrefix`, which defaults to `v`, because git tags usually do, while release names carry the `versionPrefix`, which defaults to none.

`init` takes `repositoryUrl` from the origin remote of the git repository, turned into an https address, and prints what it found. To choose it yourself, pass `--repository URL`. While `repositoryUrl` is empty, the default links stay off. To turn links off for good, set `linkFormat` to an empty string.

## Keep a Changelog

The default settings follow [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html): the six default kinds are its categories in its order, releases come newest first with an ISO 8601 date, and each version links to its comparison. The headings deliberately differ from its example: ``## [`1.1.2`] (2024-09-27)`` instead of `## [1.1.2] - 2024-09-27`, so the version stands out in a monospaced font. wandelzeug keeps unreleased changes as files in `.changes/unreleased/`, so it doesn't maintain an `## [Unreleased]` section.

## Templates

Templates use [Mustache](https://mustache.github.io/mustache.5.html) without HTML escaping, so Markdown such as `&` or `` ` `` passes through unchanged. `{{name}}` inserts a value, and a section such as `{{#pr}}...{{/pr}}` renders only when the value is set. A missing value renders empty. For example, `{{#pr}}{{pr}}-{{/pr}}{{kind}}-{{title}}` yields `001-42-added-support-for-toml-config.md` with a `pr` value and `001-added-support-for-toml-config.md` without one. A boolean front matter entry works as a switch, as in `{{#breaking}}**Breaking:** {{/breaking}}`.

The following settings in `.changes/config.yaml` are templates:

| Setting | Default | Values |
|---------|---------|--------|
| `fragmentName` | `{{kind}}-{{title}}` | `title` (the first body line without its list marker), `kind`, and any front matter key. Every value becomes a lower-case slug, transliterated to ASCII where possible, such as `groesse-aendern` for "Größe ändern", and `titleMaxLength` limits the title. |
| `versionFormat` | ``## [`{{version}}`] ({{date}})`` | `version`, `date`, `tag`, `previousVersion`, and `previousTag` |
| `kindFormat` | `### {{kind}}` | `kind` |
| `changeFormat` | `{{body}}` | `body`, `marker`, `text`, `kind`, and any front matter key, such as `{{body}}{{#pr}} (#{{pr}}){{/pr}}` |
| `releaseTemplate` | See the following example | The values of `versionFormat`, and `kinds`, where each kind has a `kind` and its `changes` |
| `linkFormat` | See [Links](#links) | The values of `versionFormat`, and `repositoryUrl` |
| `tagTemplate` | See [Tag messages](releases.md#tag-messages) | The values of `releaseTemplate`, and `references` |

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

`changeFormat` renders one entry for each item of a change whose body is a list. `body` is the item, `marker` its list marker, such as `* `, and `text` the item after its marker. So `{{marker}}{{#issue}}[{{issue}}] {{/issue}}{{text}}` puts the issue in front of every item, as in `* [FOO-1234] Added the thing.` A body that holds anything besides a list renders as one entry, with the whole body as `body` and `text` and an empty `marker`.

To change a detail, such as a link after each change, edit a format. To change the layout, replace `releaseTemplate`. It can still place the formats, or it can write everything itself. wandelzeug rejects unknown values in `versionFormat` and `kindFormat`, partials outside `releaseTemplate`, and unknown partials, because Mustache would otherwise render them as empty without a trace.

The file that `init` writes explains every other setting, including the paths and the list of kinds.

## Onboard an existing changelog

When a `CHANGELOG.md` exists already, `init` only adds the release anchor and the link markers, and keeps every other line, including your header:

- The release anchor goes above the first heading that names a version, such as `## 1.4.2` or `## [1.4.2] - 2025-03-02`. In a [Keep a Changelog](https://keepachangelog.com) file, an `## [Unreleased]` section stays above it.
- The newest stable version among those headings becomes the `baseline`, which `latest` and `next` use until wandelzeug records its first release. To choose the baseline yourself, pass `--baseline VERSION`.
- The link markers go above the first link definition that names a version, so an `[unreleased]: ...` definition stays above them.
- Without such a heading or definition, the anchor and the markers go to the end of the file.

`init` prints the lines of the anchor and the markers, and the baseline. They are plain text, so if a guess is wrong, move a marker line or edit the baseline by hand.

The releases from before wandelzeug stay as they are, without data blocks, so `wlz render` leaves them alone. To give them data blocks as well, pass `--import`, which works like [`wlz import`](#import-existing-releases). The import picks the baseline itself, so `--import` doesn't go with `--baseline`.

## Import existing releases

To give data blocks to the releases of a changelog that you onboarded before, run the following command:

```sh
wlz import
```

The import needs `releaseData`, which is on by default. It goes through the marked releases without a data block, newest first, and then through the releases from before wandelzeug, in the order of the file. A release fits when it has the shape that wandelzeug renders:

- Its heading names the version and a date as `YYYY-MM-DD`, such as `## [1.4.2] - 2025-03-02`.
- Below the heading, each section heading names a configured kind, such as `### Added`.
- Each section holds only lists, and each list item becomes a change.

A fitting release keeps its notes exactly as they are, and the hash in its data block covers that text. Its link definition moves inside the `wlz:links` markers, so `wlz render` manages it. Other link definitions stay where they are.

The import stops at the first release that doesn't fit, and names the release, its line, and the reason, such as a section heading that matches no configured kind, or a paragraph next to the lists. A release from before wandelzeug that stops the import becomes the baseline, and it and the releases below it stay as they are. To import them too, fix what the message names, for example by adding the kind to the configuration or by moving a summary into a list item, then run `wlz import` again. When every release has a data block, the import removes the baseline, because the changelog no longer needs it.

After the import, set `repositoryUrl` if it's empty, then run `wlz render` to give the imported releases the layout of your templates.
