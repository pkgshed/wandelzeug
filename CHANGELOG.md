# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- wlz:releases -->

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

<!-- wlz:data date=2026-11-18 hash=h1:RaXhxDqvHNbgRQZZQ5dv8A==
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

<!-- wlz:data date=2026-11-17 hash=h1:UAxOg0Sxvm8H/rtQ2CMAdA==
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
[`0.2.0`]: https://github.com/pkgshed/wandelzeug/compare/v0.1.0...v0.2.0
[`0.1.0`]: https://github.com/pkgshed/wandelzeug/releases/tag/v0.1.0
<!-- END wlz:links -->
