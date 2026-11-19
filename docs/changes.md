# Change files

This guide covers the format of change files, how `wlz new` records them, breaking changes, extra fields, links to issues and pull requests, how `wlz check` validates them in CI, and empty changes for branches without anything notable.

## The file format

Each change is a Markdown file with YAML front matter. The `kind` key is required and must match a configured kind, ignoring case. The `breaking` key says whether the change breaks compatibility, see [Breaking changes](#breaking-changes). Any other key, such as `pr` or `mr`, is metadata that templates can use. The body is the Markdown that appears in the changelog:

```md
---
kind: Added
pr: 42
---
* Support for TOML config
```

Change files live in `.changes/unreleased/nnn-ID-NAME.md`, such as `001-k7m2q-added-support-for-toml-config.md`. The number `nnn` orders the changes in the changelog: `new` takes the highest existing number plus one, padded to three digits, so the numbering starts again at `001` after a release. `ID` is five random characters, so two branches that pick the same number still create different files and merge without a conflict. The characters come from [Crockford's base32](https://www.crockford.com/base32.html) alphabet in lower case, which works on file systems that ignore case and leaves out `i`, `l`, `o` and `u`, so an ID rarely spells a word. `NAME` comes from the `fragmentName` template, see [Templates](changelog.md#templates). File names without an ID, as wandelzeug 0.3.0 and older wrote them, stay valid.

## Record a change

`new` takes the kind, the body, and metadata from its options. When stdin is a terminal, it asks for whatever the options leave out: the kind, a one-line body, whether the change breaks when its kind leaves that open, and each extra field. You pick the kind and the options of `enum` and `enums` fields from a list, and `new` checks each answer before it moves on. The list of kinds ends with "No notable change", which records an [empty change](#record-an-empty-change) instead. A body line without a list marker becomes a `* ` item. To cancel, press Ctrl+C, and nothing gets recorded.

To write a longer change, pass `--edit`. The command writes a draft to `.changes/.draft.md`, filled in from the options, with comments that list the kinds and the open extra fields, and opens it in `$VISUAL` or `$EDITOR`. After the editor closes, `new` checks the draft. When it has problems, the command asks whether to edit it again. An empty body cancels the change.

The draft stays until the change is recorded, so nothing you write in the editor gets lost. After a problem, a declined edit, or a failed editor, run `wlz new --resume` to reopen the draft. `new --edit` refuses to replace a kept draft. `init` adds a `.changes/.gitignore` that keeps the draft out of version control.

## Breaking changes

A breaking change makes users change something to upgrade, and it bumps the major version, see [Versions](releases.md#versions). The `breaking` setting of each kind decides whether its changes break:

| Value | Changes of the kind break | `new` asks |
|---|---|---|
| `no`, the default | never | no |
| `yes` | always | no |
| `ask` | when their front matter says `breaking: true` | yes |

The default kinds ask for `Changed` and `Fixed`, and `Removed` always breaks. A kind with `bump: major` always breaks too. A team that settles the question by the kind alone sets every kind to `yes` or `no`, and `new` never asks:

```yaml
kinds:
  - label: Added
    bump: minor
  - label: Changed
    bump: minor
    breaking: ask
  - label: Removed
    breaking: yes
  - label: Fixed
    bump: patch
    breaking: ask
```

For a kind that asks, the question defaults to no. `--breaking` and `--no-breaking` answer it without a question, and without a terminal, such a kind needs one of them, just as `new` needs `--kind`. A change file written by hand without a `breaking` entry does not break. In a draft, the kinds that ask get a `breaking:` line to fill in. `new` writes `breaking: true` into the file of every breaking change, including those of kinds that always break.

A `breaking` entry must agree with the kind, so `check` reports `breaking: true` for a kind that never breaks, and `breaking: false` for a kind that always breaks.

The data block of a release records `breaking: true` for each breaking change, so a later change to the kinds leaves past releases as they are. The default `changeFormat` labels a breaking change as `* **Breaking:** ...`, see [Templates](changelog.md#templates). A change of a kind that always breaks goes without the label, because the heading of its kind says so already. To label every breaking change, set `changeFormat` to `{{marker}}{{#breaking}}**Breaking:** {{/breaking}}{{text}}`. Releases that `wlz import` converts mark no change as breaking, because their notes stay as they are.

## Extra fields

The `extraFields` setting lists front matter entries besides `kind` that `new` asks for and `check` validates. Their values sit at the top level of the front matter, next to `kind`, and templates use them by key, such as `{{pr}}`. Each entry has a `key`, a `prompt` that defaults to the key, a `type` that defaults to `string`, and a `required` flag that defaults to `false`.

The types and their settings follow changie's custom choices:

| Type | Value | Settings |
|------|-------|----------|
| `string` | One line of text | `minLength`, `maxLength`, `pattern`, `url`, `label` |
| `block` | Several lines of text, written as a literal block | `minLength`, `maxLength` |
| `int` | A whole number. `#42` and `!42` count as `42`, the way GitHub and GitLab write pull and merge request numbers. | `minInt`, `maxInt`, `url`, `label` |
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

A `pattern` is a JavaScript regular expression that the whole value must match, such as `'FOO-\d{1,9}'` for a ticket of a Jira project. Write it in single quotes, because YAML reads a backslash in double quotes as an escape.

`new` checks the values after the questions or after the editor closes, and `check` checks them again. Without a terminal, `new` fails when a required field is missing. To leave an optional field empty without a question, pass the key with an empty value, such as `--meta area=`.

## Link issues and pull requests

An extra field with a `url` turns references to its values into links. A reference is a label in square brackets, such as `[FOO-1234]` or `[#42]`, and wandelzeug finds it in the rendered notes. The reference can come from the front matter, placed by `changeFormat`, or from the text of a change, as in "Fixes [FOO-1] and [FOO-2]". The following configuration links Jira tickets and GitHub pull requests:

```yaml
extraFields:
  - key: issue
    pattern: 'FOO-\d{1,9}'
    url: "https://jira.corp.com/browse/{{issue}}"
  - key: pr
    type: int
    label: "#{{pr}}"
    url: "{{repositoryUrl}}/pull/{{pr}}"
changeFormat: "{{marker}}{{#issue}}[{{issue}}] {{/issue}}{{text}}{{#pr}} ([#{{pr}}]){{/pr}}"
```

With this configuration, the following change renders as `* [FOO-1234] Added the thing. ([#42])`:

```md
---
kind: Added
issue: FOO-1234
pr: 42
---
* Added the thing.
```

The settings work together:

- `url` is a Mustache template for the web address of a value. It can use the value and `repositoryUrl`, so a GitLab merge request can link to `{{repositoryUrl}}/-/merge_requests/{{mr}}`.
- `label` is a Mustache template for the text in brackets, which places the value once between fixed text, such as `#{{pr}}` or `!{{mr}}`. It defaults to the value itself. A label with fixed text keeps ordinary brackets, such as `[1]`, from passing for references.
- A `string` field with a `url` needs a `pattern`, which tells wandelzeug which labels belong to the field. An `int` field matches digits.

`batch` adds a definition for each new reference between the `wlz:links` markers, and `render` rebuilds them. `wlz show` ends with every link definition that its notes use, so the links work outside the changelog too. The tag message of `wlz release` gets them through `tagTemplate`, see [Tag messages](releases.md#tag-messages). Brackets in code, escaped brackets, and links that have a target already don't count as references.

## Check changes in CI

`check` validates every unreleased change against the configured kinds and extra fields, and the markers and data blocks in the changelog. It reports each problem with its file, and for the changelog with its line. With `--since REF`, it also fails when the commits since the current branch forked from `REF` add or modify no change file. Uncommitted files don't count.

To require a changelog entry in every pull request, run the following command in CI:

```sh
wlz check --since origin/main
```

The check needs the history of `REF`. With `actions/checkout`, set `fetch-depth: 0`.

## Record an empty change

A branch without anything notable for the changelog, such as a refactoring or a change to CI, records an empty change, so `check --since` passes:

```sh
wlz new --empty --reason "Refactoring only"
```

The command writes `.changes/unreleased/nnn-ID-empty.md`, which holds `empty: true` in its front matter and the reason, if any, as its body:

```md
---
empty: true
---
Refactoring only
```

Reviewers see the empty change in the pull request, so the decision gets a review like any other change. The reason never shows in the changelog. An empty change takes no kind, body, or extra fields, and `check` reports a file that holds `empty: true` together with anything else.

`batch` and `release` delete the empty changes along with the changes that they release. Empty changes alone are nothing to release, so they wait for the next release with a notable change. `offboard` deletes them without asking for `--force`, because they hold no recorded work.
