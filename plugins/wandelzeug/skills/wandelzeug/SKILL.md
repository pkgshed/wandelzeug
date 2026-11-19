---
name: wandelzeug
description: Records user-facing changes as change files with wandelzeug, the wlz command, and words their changelog entries. Use in a repository with a .changes/config.yaml whenever a task changes something that users of the software notice, when a change needs a changelog entry, when a CI check asks for a change file, and when the user asks for a release with wlz.
---

# Record changes with wandelzeug

wandelzeug keeps each change in its own Markdown file in `.changes/unreleased/` and turns the collected files into a release in the changelog when the project ships. Your part is the change files. The changelog is wandelzeug's to write.

## Learn the rules of the project

1. Find `.changes/config.yaml` in the project that you work on. In a monorepo, each project has its own `.changes` directory, and `-C DIR` runs a command for the project in `DIR`, as in `wlz new -C packages/api ...`.
2. Read these settings in the configuration:
   - `kinds`: the labels that you can use, the `bump` of each, and its `breaking` policy, which is `yes`, `no`, or `ask`.
   - `extraFields`: front matter entries such as a pull request number. A field with `required: true` needs a value.
   - `changeFormat`: how an entry renders, which shows whether issue or pull request references come from fields.
3. Read the newest release in the changelog, which `changelogPath` names and which defaults to `CHANGELOG.md`, and match its wording and style.
4. Run `wlz new --help` for the options of the installed version. If `wlz` isn't on the `PATH`, ask the user how they run it instead of installing it. In the wandelzeug repository itself, the command is `bun src/cli.ts`.

## Rules

- Never edit the changelog between its `wlz` markers by hand. The notes of a release come from its change files, `wlz render` replaces hand edits, and `wlz check` reports them.
- Record changes with `wlz new` instead of writing the files yourself, because the file name holds a sequence number and a random ID that `wlz new` picks. You may edit an unreleased change file that you recorded.
- Commit the change file together with the change, on the same branch.
- Don't use `wlz new --edit`, which waits for an editor.
- Run `wlz batch`, `wlz release`, `wlz render`, `wlz import`, or `wlz offboard` only when the user asks. They rewrite the changelog, commit and tag a release, or remove wandelzeug from the project.

## Decide what to record

A change is notable when users of the software notice it: a new feature, option, or command, changed behaviour, output, or defaults, a deprecation or removal, a fixed bug, a fixed vulnerability, or changed requirements such as a minimum runtime version. Refactoring, tests, CI, build scripts, and internal tooling aren't notable. Neither are fixes to something that no release has shipped yet.

Record one change file for each notable change. A task that fixes a bug and adds an option records two files. Parts of one change, such as an option and its documentation, share one file.

When the work holds nothing notable, record an empty change. It tells `wlz check --since` that the branch leaves out a changelog entry on purpose:

```sh
wlz new --empty --reason "Refactoring of the parser, no change in behaviour"
```

The reason never reaches the changelog, but reviewers read it. When you can't tell whether users notice a change, ask the user.

## Record a change

Without a terminal, `wlz new` can't ask its questions, so pass everything as options:

```sh
wlz new --kind Fixed --no-breaking --body "* A crash when the configuration file is empty"
```

- `--kind` takes a label from the configuration, ignoring case.
- For a kind with `breaking: ask`, pass `--breaking` or `--no-breaking`. A kind with `breaking: yes` always breaks and one with `breaking: no` never does, so pass neither.
- Pass each extra field as `--meta KEY=VALUE`, such as `--meta pr=42`. When a required field has a value that you don't know, ask the user.
- `--body` takes Markdown, usually one list item. For several lines, pass `--body -` and the body on stdin:

  ```sh
  wlz new --kind Added --body - <<'EOF'
  * `--json` for `status`, which prints the status as JSON
  * `--quiet` for `status`, which prints only problems
  EOF
  ```

Then run `wlz check`. Many projects run `wlz check --since origin/main` in CI, which fails a branch without a change file, so run that too before you push.

### Choose the kind

Use the labels of the configuration. With the default kinds of [Keep a Changelog](https://keepachangelog.com):

| Kind | For |
| --- | --- |
| Added | Features, options, commands, settings, or platforms that didn't exist before |
| Changed | Different behaviour, output, defaults, or requirements of something that exists |
| Deprecated | Features that still work but are going away |
| Removed | Features that are gone |
| Fixed | Bugs that are fixed |
| Security | Vulnerabilities that are fixed |

### Decide whether it breaks

A change breaks when users must change something to upgrade: their configuration, scripts, command lines, code that calls an API, or stored data. Removed or renamed options, stricter validation that rejects input that used to pass, changed defaults that alter results, and a raised minimum runtime version all break. A breaking change bumps the major version, so when you're unsure, ask the user.

## Word the entry

Readers of the changelog are users who decide whether and how to upgrade. Write the entry for them:

- Describe the change from the side of the user: what they can do now, what behaves differently, or what no longer goes wrong. Leave out how the code changed, internal names, and the history of the work.
- Let the kind heading carry the verb. Under "Added", write `* Support for TOML configuration files`, not `* Added support for TOML`. Under "Fixed", name the problem that's gone, as in `* A crash when the configuration file is empty`.
- Put one change in each list item. A change with several parts that users see gets one item for each part.
- Name what users see in code font: commands, options, settings, file names, and messages, such as `` `--dry-run` `` or `` `repositoryUrl` ``.
- For a breaking change, say what users must do: ``* `--output` takes a directory instead of a file. Pass the directory that holds the file.``
- For a deprecation, name the replacement and, when known, the release that removes the old way.
- Keep it to one to three sentences in the present tense.
- Give references the way the project does. When `changeFormat` renders a field such as `pr`, pass `--meta pr=42` instead of writing the number into the body.
- Match the language, spelling, and punctuation of the existing changelog.

| Weak | Better |
| --- | --- |
| `* Fixed bug in parser (#123)` | `* A crash when a list item holds only a link`, with `--meta pr=123` |
| `* Added --json flag to status command` | ``* `--json` for `status`, which prints the status as JSON`` |
| `* Updated dependencies` | An empty change, or `* Requires Node.js 20 or later` when users notice |
| `* Changed default timeout` | `* The default timeout is 30 seconds instead of 10, so slow servers no longer fail the first request` |
| `* Refactored config loading and fixed empty values` | `* Settings with an empty value fall back to their default`, and nothing for the refactoring |

## Release, when the user asks

```sh
wlz next auto             # the version that the next release gets
wlz batch auto --dry-run  # the release as batch would insert it
wlz release auto          # writes the changelog, commits, and tags
```

`wlz release` also runs the tag helper of the project. Push only when the user says so.
