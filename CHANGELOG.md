# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- wlz:releases -->

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

<!-- wlz:data
date: 2026-11-17
hash: h1:UAxOg0Sxvm8H/rtQ2CMAdA==
changes:
  - kind: Added
    body: "* `wlz init` sets up `.changes/config.yaml` and a changelog in the Keep a Changelog format, and onboards an existing changelog with a baseline version."
  - kind: Added
    body: "* `wlz new` records a change as a Markdown file with YAML front matter, from options, from questions in the terminal, or in your editor. `wlz new --resume` recovers a draft that had problems."
  - kind: Added
    body: "* Extra fields add typed front matter entries, such as a pull request number, that `wlz new` asks for and `wlz check` validates."
  - kind: Added
    body: "* `wlz check` validates the change files and the changelog markers. With `--since`, it also requires a change file on the current branch."
  - kind: Added
    body: "* `wlz batch` adds the unreleased changes to the changelog as a release between markers, with a compare link, through Mustache templates that you can adjust or replace."
  - kind: Added
    body: "* `wlz release` adds a release, commits it, and tags the commit through semverkzeug or another tag helper."
  - kind: Added
    body: "* `wlz latest`, `wlz next` and `wlz show` print the latest release, the version that a bump yields, and the notes of a release."
  - kind: Added
    body: "* Replacements keep version numbers in other files, such as `package.json`, in step with each release."
  - kind: Added
    body: "* `wlz --version` prints the installed version."
-->
<!-- END wlz:release 0.1.0 -->

<!-- BEGIN wlz:links -->
[`0.1.0`]: https://github.com/pkgshed/wandelzeug/releases/tag/v0.1.0
<!-- END wlz:links -->
