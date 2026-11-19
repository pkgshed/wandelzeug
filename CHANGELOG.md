# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- wlz:releases -->

<!-- BEGIN wlz:release 0.4.0 -->
## [`0.4.0`] (2026-11-19)

### Added

* Breaking changes: each kind sets `breaking` to `yes`, `no` or `ask`. A breaking change bumps the major version, gets `breaking: true` in its file and in the data block, and the default `changeFormat` labels it as **Breaking:**, unless its kind always breaks. For a kind that asks, `wlz new` asks "Breaking change?". `--breaking` and `--no-breaking` answer without a question, and without a terminal, such a kind needs one of them.
* `wlz offboard` removes wandelzeug from a project: it deletes the `.changes` directory and keeps the changelog. With `--strip-markers`, it also removes the markers and data blocks from the changelog, and keeps the notes and link definitions. Unreleased changes and a kept draft stop it unless you pass `--force`, and `--dry-run` lists what it would do.
* Empty changes: `wlz new --empty`, with an optional `--reason`, records that a branch has nothing notable for the changelog, so `wlz check --since` passes. In a terminal, the list of kinds ends with "No notable change". The reason never shows in the changelog, and the next release deletes empty changes along with the changes that it releases.
* A skill for coding agents such as Claude Code, Codex, OpenCode, and pi, which records change files with `wlz` and words their entries. The repository is a Claude Code plugin marketplace, and aska installs the skill from `github.com/pkgshed/wandelzeug/plugins/wandelzeug/skills/wandelzeug`.

### Changed

* Change files get five random characters after their number, as in `001-k7m2q-added-support-for-toml-config.md`, so branches that pick the same number at the same time merge without a conflict. The characters come from Crockford's base32 alphabet in lower case. wlz reads file names with and without them.
* `auto` no longer leaves 0.y.z on its own. The new `bumpStrategy` setting decides how it bumps while the latest release is 0.y.z: `minor-capped`, the default, turns a major change into a minor bump, `shifted` moves every bump one level lower, and `literal` keeps the bumps of the kinds as they are. An explicit bump, as in `wlz release major`, always applies as given.
* **Breaking:** The default kinds: `Changed` bumps the minor version and asks whether a change breaks, and so does `Fixed` with a patch bump. `Removed` always breaks. A kind with `bump: major` keeps working and always breaks. `breaking` and `kindBreaks` are now reserved front matter keys, so extra fields with these names need new names.

### Fixed

* A bare `wlz new`, and `wlz new -C DIR` without other options, failed with "No matching option found" since wandelzeug 0.2.0. Both ask for the change again.

<!-- wlz:data date=2026-11-19 hash=h1:RzHPCfMLl/jLz/h2N9wOmA
Added:
  - body: "* Breaking changes: each kind sets `breaking` to `yes`, `no` or `ask`. A breaking change bumps the major version, gets `breaking: true` in its file and in the data block, and the default `changeFormat` labels it as **Breaking:**, unless its kind always breaks. For a kind that asks, `wlz new` asks \"Breaking change?\". `--breaking` and `--no-breaking` answer without a question, and without a terminal, such a kind needs one of them."
  - body: "* `wlz offboard` removes wandelzeug from a project: it deletes the `.changes` directory and keeps the changelog. With `--strip-markers`, it also removes the markers and data blocks from the changelog, and keeps the notes and link definitions. Unreleased changes and a kept draft stop it unless you pass `--force`, and `--dry-run` lists what it would do."
  - body: "* Empty changes: `wlz new --empty`, with an optional `--reason`, records that a branch has nothing notable for the changelog, so `wlz check --since` passes. In a terminal, the list of kinds ends with \"No notable change\". The reason never shows in the changelog, and the next release deletes empty changes along with the changes that it releases."
  - body: "* A skill for coding agents such as Claude Code, Codex, OpenCode, and pi, which records change files with `wlz` and words their entries. The repository is a Claude Code plugin marketplace, and aska installs the skill from `github.com/pkgshed/wandelzeug/plugins/wandelzeug/skills/wandelzeug`."
Changed:
  - body: "* Change files get five random characters after their number, as in `001-k7m2q-added-support-for-toml-config.md`, so branches that pick the same number at the same time merge without a conflict. The characters come from Crockford's base32 alphabet in lower case. wlz reads file names with and without them."
  - body: "* `auto` no longer leaves 0.y.z on its own. The new `bumpStrategy` setting decides how it bumps while the latest release is 0.y.z: `minor-capped`, the default, turns a major change into a minor bump, `shifted` moves every bump one level lower, and `literal` keeps the bumps of the kinds as they are. An explicit bump, as in `wlz release major`, always applies as given."
  - breaking: true
    body: "* The default kinds: `Changed` bumps the minor version and asks whether a change breaks, and so does `Fixed` with a patch bump. `Removed` always breaks. A kind with `bump: major` keeps working and always breaks. `breaking` and `kindBreaks` are now reserved front matter keys, so extra fields with these names need new names."
Fixed:
  - body: "* A bare `wlz new`, and `wlz new -C DIR` without other options, failed with \"No matching option found\" since wandelzeug 0.2.0. Both ask for the change again."
-->
<!-- END wlz:release 0.4.0 -->

<!-- BEGIN wlz:release 0.3.0 -->
## [`0.3.0`] (2026-11-18)

### Changed

* Data blocks write their hash without the `==` padding, as `hash=h1:` and 22 characters. Hashes with the padding stay valid, and `wlz render` shortens them. wlz 0.2.1 and older cannot read the short form.

<!-- wlz:data date=2026-11-18 hash=h1:ga5Lje/UlWxiVFC9wzlM2g
Changed:
  - body: "* Data blocks write their hash without the `==` padding, as `hash=h1:` and 22 characters. Hashes with the padding stay valid, and `wlz render` shortens them. wlz 0.2.1 and older cannot read the short form."
-->
<!-- END wlz:release 0.3.0 -->

<!-- BEGIN wlz:release 0.2.1 -->
## [`0.2.1`] (2026-11-18)

### Fixed

* `wlz show` also ends with the link definition of the release itself, so the version in the heading of a GitHub release description links to its comparison.

<!-- wlz:data date=2026-11-18 hash=h1:X7IlqXywNOaCw/OSmJTSoQ
Fixed:
  - body: "* `wlz show` also ends with the link definition of the release itself, so the version in the heading of a GitHub release description links to its comparison."
-->
<!-- END wlz:release 0.2.1 -->

<!-- BEGIN wlz:release 0.2.0 -->
## [`0.2.0`] (2026-11-18)

### Added

* `wlz COMMAND --help` and `wlz help COMMAND` show the help of one command, with its options and arguments.
* The help uses colours on a terminal. `NO_COLOR` turns them off, and `FORCE_COLOR` keeps them in a pipe.
* `wlz completion SHELL` prints a completion script for bash, zsh, fish, PowerShell, and Nushell, so Tab completes commands, options, bumps, and directories.
* `wlz render` renders every release again from a data block at the bottom of the release, so a changed template applies to past releases too. `wlz check` reports releases whose notes were edited by hand, and `wlz render --force` renders over them. To leave the data blocks out of new releases, set `releaseData` to `false`.
* `wlz init --import` and `wlz import` give data blocks to the releases of an existing changelog, so `wlz render` renders them too. The import stops at the first release that does not fit, makes it the baseline, and explains why it stopped.
* String fields take a `pattern`, a regular expression that the whole value must match. `wlz new` and `wlz check` enforce it.
* String and int fields take a `url` and a `label`, which turn references such as `[FOO-1234]` or `[#42]` into links. wandelzeug finds them in the notes, whether the front matter or the text of a change holds them, and keeps their definitions between the `wlz:links` markers. `wlz show` and tag messages end with the definitions that their notes use.
* Each GitHub release of wandelzeug carries the single-file bundle `wlz.js`, its checksum, and an attestation of its build provenance.

### Changed

* The link definitions now sit between `<!-- BEGIN wlz:links -->` and `<!-- END wlz:links -->` instead of below `<!-- wlz:links -->`. wlz names the old anchor and explains how to replace it.
* `changeFormat` renders one entry for each item of a change whose body is a list, with the new values `marker` and `text`, so a format can put a reference in front of every item. The front matter keys `marker` and `text` are now reserved.
* The message of the tag that `wlz release` creates comes from the new `tagTemplate` setting. Its default is plain text with a subject line such as `release v1.0.0`, because git hosts show tag messages without rendering Markdown.
* `tagHelper` holds a `create` command, an optional `check` command, and `env` variables. Each argument is a Mustache template, and the commands run without a shell. `wlz release` tags with `git tag` by default instead of semverkzeug, and checks by itself that the release files hold no uncommitted changes and that the tag is new.

<!-- wlz:data date=2026-11-18 hash=h1:RaXhxDqvHNbgRQZZQ5dv8A
Added:
  - body: "* `wlz COMMAND --help` and `wlz help COMMAND` show the help of one command, with its options and arguments."
  - body: "* The help uses colours on a terminal. `NO_COLOR` turns them off, and `FORCE_COLOR` keeps them in a pipe."
  - body: "* `wlz completion SHELL` prints a completion script for bash, zsh, fish, PowerShell, and Nushell, so Tab completes commands, options, bumps, and directories."
  - body: "* `wlz render` renders every release again from a data block at the bottom of the release, so a changed template applies to past releases too. `wlz check` reports releases whose notes were edited by hand, and `wlz render --force` renders over them. To leave the data blocks out of new releases, set `releaseData` to `false`."
  - body: "* `wlz init --import` and `wlz import` give data blocks to the releases of an existing changelog, so `wlz render` renders them too. The import stops at the first release that does not fit, makes it the baseline, and explains why it stopped."
  - body: "* String fields take a `pattern`, a regular expression that the whole value must match. `wlz new` and `wlz check` enforce it."
  - body: "* String and int fields take a `url` and a `label`, which turn references such as `[FOO-1234]` or `[#42]` into links. wandelzeug finds them in the notes, whether the front matter or the text of a change holds them, and keeps their definitions between the `wlz:links` markers. `wlz show` and tag messages end with the definitions that their notes use."
  - body: "* Each GitHub release of wandelzeug carries the single-file bundle `wlz.js`, its checksum, and an attestation of its build provenance."
Changed:
  - body: "* The link definitions now sit between `<!-- BEGIN wlz:links -\x2D>` and `<!-- END wlz:links -\x2D>` instead of below `<!-- wlz:links -\x2D>`. wlz names the old anchor and explains how to replace it."
  - body: "* `changeFormat` renders one entry for each item of a change whose body is a list, with the new values `marker` and `text`, so a format can put a reference in front of every item. The front matter keys `marker` and `text` are now reserved."
  - body: "* The message of the tag that `wlz release` creates comes from the new `tagTemplate` setting. Its default is plain text with a subject line such as `release v1.0.0`, because git hosts show tag messages without rendering Markdown."
  - body: "* `tagHelper` holds a `create` command, an optional `check` command, and `env` variables. Each argument is a Mustache template, and the commands run without a shell. `wlz release` tags with `git tag` by default instead of semverkzeug, and checks by itself that the release files hold no uncommitted changes and that the tag is new."
-->
<!-- END wlz:release 0.2.0 -->

<!-- BEGIN wlz:release 0.1.0 -->
## [`0.1.0`] (2026-11-17)

### Added

* `wlz init` sets up `.changes/config.yaml` and a changelog in the Keep a Changelog format, and onboards an existing changelog with a baseline version.
* `wlz new` records a change as a Markdown file with YAML front matter, from options, from questions in the terminal, or in your editor. `wlz new --resume` recovers a draft that had problems.
* Extra fields add typed front matter entries, such as a pull request number, that `wlz new` asks for and `wlz check` validates.
* `wlz check` validates the change files and the changelog markers. With `--since`, it also requires a change file on the current branch.
* `wlz batch` adds the unreleased changes to the changelog as a release between markers, with a compare link, through Mustache templates that you can adjust or replace.
* `wlz release` adds a release, commits it, and tags the commit through semverkzeug or another tag helper.
* `wlz latest`, `wlz next` and `wlz show` print the latest release, the version that a bump yields, and the notes of a release.
* Replacements keep version numbers in other files, such as `package.json`, in step with each release.
* `wlz --version` prints the installed version.

<!-- wlz:data date=2026-11-17 hash=h1:UAxOg0Sxvm8H/rtQ2CMAdA
Added:
  - body: "* `wlz init` sets up `.changes/config.yaml` and a changelog in the Keep a Changelog format, and onboards an existing changelog with a baseline version."
  - body: "* `wlz new` records a change as a Markdown file with YAML front matter, from options, from questions in the terminal, or in your editor. `wlz new --resume` recovers a draft that had problems."
  - body: "* Extra fields add typed front matter entries, such as a pull request number, that `wlz new` asks for and `wlz check` validates."
  - body: "* `wlz check` validates the change files and the changelog markers. With `--since`, it also requires a change file on the current branch."
  - body: "* `wlz batch` adds the unreleased changes to the changelog as a release between markers, with a compare link, through Mustache templates that you can adjust or replace."
  - body: "* `wlz release` adds a release, commits it, and tags the commit through semverkzeug or another tag helper."
  - body: "* `wlz latest`, `wlz next` and `wlz show` print the latest release, the version that a bump yields, and the notes of a release."
  - body: "* Replacements keep version numbers in other files, such as `package.json`, in step with each release."
  - body: "* `wlz --version` prints the installed version."
-->
<!-- END wlz:release 0.1.0 -->

<!-- BEGIN wlz:links -->
[`0.4.0`]: https://github.com/pkgshed/wandelzeug/compare/v0.3.0...v0.4.0
[`0.3.0`]: https://github.com/pkgshed/wandelzeug/compare/v0.2.1...v0.3.0
[`0.2.1`]: https://github.com/pkgshed/wandelzeug/compare/v0.2.0...v0.2.1
[`0.2.0`]: https://github.com/pkgshed/wandelzeug/compare/v0.1.0...v0.2.0
[`0.1.0`]: https://github.com/pkgshed/wandelzeug/releases/tag/v0.1.0
<!-- END wlz:links -->
