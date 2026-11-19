<div align="center">

# wandelzeug

**Changelog entries without merge conflicts.**

[![CI](https://img.shields.io/github/actions/workflow/status/pkgshed/wandelzeug/ci.yaml?branch=main&label=CI)](https://github.com/pkgshed/wandelzeug/actions/workflows/ci.yaml) [![Version](https://img.shields.io/github/v/tag/pkgshed/wandelzeug?sort=semver&label=version)](CHANGELOG.md) [![Licence: 0BSD](https://img.shields.io/badge/licence-0BSD-blue)](LICENSE) [![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-black?logo=bun)](https://bun.sh)

[Features](#features) · [Install](#install) · [Get started](#get-started) · [Documentation](#documentation)

</div>

wandelzeug records each change as its own small Markdown file and turns the collected files into a release in your `CHANGELOG.md` when you ship. It runs on Bun and installs as the `wlz` command.

## Features

- **No conflicts in `CHANGELOG.md`:** every branch adds its own change file, and the changelog only changes when you release.
- **Record changes your way:** pass everything as options in a script, answer a few questions in the terminal, or write the change in your editor.
- **Keep a Changelog and Semantic Versioning out of the box:** releases come newest first, grouped by kind, with headings that link to the comparison with the previous release.
- **Changelog entries enforced in CI:** `wlz check --since origin/main` fails a pull request without a change file and validates every entry.
- **Extra fields:** a pull request number, an area, or any other field that `wlz new` asks for and `wlz check` validates.
- **Links to issues and pull requests:** references such as `[FOO-1234]` or `[#42]` become links, whether they come from the front matter or the text of a change.
- **Release in one step:** `wlz release auto` picks the next version from the kinds of the changes, writes the changelog, commits it, and tags the commit with git, or with a tool of your choice such as [semverkzeug](https://github.com/0x5a17ed/semverkzeug).
- **Version numbers in step:** the version in files such as `package.json` follows each release.
- **Your layout:** Mustache templates shape the file names, the headings, the entries, and the whole release, and `wlz render` applies a changed template to past releases too.
- **Your history:** `wlz init` adopts an existing changelog and leaves everything that is already there in place. With `--import`, its releases get data blocks, so they render with your templates too.
- **Monorepos:** each project keeps its own `.changes` directory.
- **Shell completion:** Tab completes commands, options, and bumps in bash, zsh, fish, PowerShell, and Nushell.

## Install

wandelzeug needs Bun 1.3 or later. To install the `wlz` command globally, run the following command:

```sh
bun add -g git+https://github.com/pkgshed/wandelzeug.git
```

Bun links `wlz` into `~/.bun/bin`, which must be on your `PATH`.

- To see the installed version, run `wlz --version`.
- To update to the newest commit, run `bun update -g wandelzeug`.
- To uninstall, run `bun remove -g wandelzeug`.
- To complete commands and options with Tab, install the completion script for your shell, see [Shell completion](docs/completion.md).

To install a specific release, add its tag, as in `bun add -g git+https://github.com/pkgshed/wandelzeug.git#v0.1.0`.

To keep wandelzeug inside another repository instead, download the single executable file `wlz.js` from a [release](https://github.com/pkgshed/wandelzeug/releases). To check that the release workflow built it from the tagged commit, run `gh attestation verify wlz.js --repo pkgshed/wandelzeug`.

## Get started

1. In your project root, set up wandelzeug:

   ```sh
   wlz init
   ```

   The command creates the `.changes` directory with a commented configuration, and a `CHANGELOG.md`, or it adopts the changelog you have. Apart from these two, wandelzeug adds nothing to your project.

2. On your branch, record a change:

   ```sh
   wlz new --kind Added --body "* Support for TOML config"
   ```

   The change lands in a file such as `.changes/unreleased/001-k7m2q-added-support-for-toml-config.md`. Without options, `wlz new` asks for the kind and the body.

3. When you ship, add the collected changes to the changelog as the next release:

   ```sh
   wlz batch auto
   ```

   To also commit the release and tag it, run `wlz release auto` instead.

## Documentation

- `wlz --help` lists the commands, and `wlz COMMAND --help` explains one of them. Set `NO_COLOR` to turn off the colours of the help.
- The `.changes/config.yaml` that `wlz init` writes explains every setting.
- [Change files](docs/changes.md) covers the file format, recording changes, extra fields, and checks in CI.
- [The changelog](docs/changelog.md) covers the markers, links, templates, and adopting an existing changelog.
- [Releases](docs/releases.md) covers versions, releasing and tagging, version numbers in other files, and monorepos.
- [Shell completion](docs/completion.md) covers installing the completion script for each shell.

## Prior art

wandelzeug builds on ideas from other changelog tools:

- [changie](https://changie.dev) inspired wandelzeug in the first place, with a file per change in an unreleased directory, kinds, and custom choices, which a release turns into a section of the changelog.
- [git-cliff](https://git-cliff.org) generates a changelog from the commit history, through conventional commits and templates. wandelzeug takes the other road and records changes in files that people write.
- [towncrier](https://towncrier.readthedocs.io) collects news fragments in a directory and assembles them into the changelog at release time.
- [Changesets](https://github.com/changesets/changesets) keeps a Markdown file with front matter for each change and turns these files into version bumps and changelogs, with a focus on monorepos.

## Contributing

To install the development tools and run every check, run the following commands:

```sh
bun install
just ci
```

wandelzeug keeps its own changelog with wandelzeug, so record each change that users notice with `bun src/cli.ts new`. For the layout of the source, see [Development](docs/development.md).

## Licence

wandelzeug is available under the [0BSD licence](LICENSE).
